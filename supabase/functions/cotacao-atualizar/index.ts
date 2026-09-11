// Edge Function: cotacao-atualizar
//
// Busca a cotação oficial (PTAX/BCB) de uma moeda e grava no cache
// compartilhado `cotacoes_cache`.
//
// Por que saiu do app: o cache é de TODO MUNDO — uma linha por moeda,
// usada por todos os usuários para converter preços de sessão em moeda
// estrangeira nos cálculos financeiros. A política permitia que qualquer
// autenticado escrevesse nele (`with_check: true`), e escrever ali não
// afeta só quem escreve: uma cotação falsa corrompe o livro-caixa de todos
// os outros. Para quem usa o app como contabilidade do consultório, isso é
// dado errado no lugar mais sensível.
//
// Agora o valor não vem mais do cliente: vem do Banco Central, buscado
// aqui. O app só diz QUAL moeda quer — nunca quanto ela vale.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { servir } from '../_shared/registrarEvento.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// Só moedas que o app oferece. Uma lista fechada impede que alguém encha a
// tabela de linhas inventadas só porque o campo aceita texto.
const MOEDAS = ['USD', 'EUR', 'GBP', 'ARS', 'CHF', 'CAD', 'AUD', 'JPY'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ddmmaaaa(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}-${d.getFullYear()}`;
}

Deno.serve(servir('cotacao-atualizar', async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user) return json({ error: 'Sessão inválida ou expirada.' }, 401);

    const body = await req.json().catch(() => ({}));
    const moeda = String(body?.moeda || '').toUpperCase();
    if (!MOEDAS.includes(moeda)) return json({ error: 'Moeda não suportada.' }, 400);

    // Janela de dez dias pra trás: o boletim do PTAX não sai em fim de
    // semana nem em feriado, e pedir só "hoje" devolveria vazio com
    // frequência — o que a tela leria como "não há cotação".
    const hoje = new Date();
    const inicio = new Date(hoje.getTime() - 10 * 86400000);
    const url =
      'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(' +
      `moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
      `?@moeda='${moeda}'&@dataInicial='${ddmmaaaa(inicio)}'&@dataFinalCotacao='${ddmmaaaa(hoje)}'` +
      `&$top=1&$orderby=dataHoraCotacao desc&$format=json`;

    const resp = await fetch(url);
    if (!resp.ok) return json({ error: `Banco Central respondeu ${resp.status}.` }, 502);
    const dados = await resp.json();
    const item = dados?.value?.[0];
    if (!item) return json({ error: 'O Banco Central não tem cotação recente para esta moeda.' }, 404);

    const compra = Number(item.cotacaoCompra);
    const venda = Number(item.cotacaoVenda);
    const media = (compra + venda) / 2;
    if (!Number.isFinite(media) || media <= 0) {
      return json({ error: 'Cotação inválida recebida do Banco Central.' }, 502);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error } = await admin.from('cotacoes_cache').upsert({
      moeda,
      valor_brl: media,
      data_cotacao: item.dataHoraCotacao ?? null,
      atualizado_em: new Date().toISOString(),
    });
    if (error) return json({ error: error.message }, 500);

    return json({ moeda, valor_brl: media, data_cotacao: item.dataHoraCotacao ?? null });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
}));
