// Edge Function: ia-busca
// Motor de geração dos Relatórios por analisante (RelatoriosScreen.js) via
// DeepSeek — antes alimentava o chat livre "Assistente Clínico", removido
// em favor de relatórios pré-definidos, sem pergunta aberta gastando
// crédito à toa. Recebe o array de mensagens já pronto (system prompt +
// prompt de usuário, sempre uma única rodada — não é mais um histórico de
// chat de verdade).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { precosAtuais } from '../_shared/precificacaoDeepSeek.ts';
import { MULTIPLICADOR_COBRANCA_USUARIO } from '../_shared/margemCobranca.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')!;

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

// Tipos de chamador válidos — usados só pra rotular `uso_ia.tipo` corretamente
// (antes hardcoded como 'relatorio' pra qualquer chamador, inclusive a Busca
// Dr.Sig, impossibilitando distinguir a origem real do gasto no log).
const TIPOS_VALIDOS = new Set(['relatorio', 'busca']);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user) return json({ error: 'Sessão inválida.' }, 401);
    const userId = userData.user.id;

    const body = await req.json();
    const { mensagens, maxTokens, tipo } = body || {};
    if (!Array.isArray(mensagens) || mensagens.length === 0) {
      return json({ error: 'Mensagens ausentes.' }, 400);
    }
    const tipoUso = TIPOS_VALIDOS.has(tipo) ? tipo : 'relatorio';
    // Chamador escolhe o teto de saída (chat = resposta curta, relatório
    // elaborado = precisa de bem mais espaço pra não cortar no meio). O
    // limite de segurança aqui só existe pra impedir um valor absurdo por
    // engano/bug do lado do app — não é mais pensado como "teto normal":
    // investigação direta no uso_ia mostrou que tetos baixos (3000, depois
    // 8000/16000) eram consumidos por inteiro até em respostas que
    // voltavam vazias (o modelo "pensa" antes de escrever, e se o teto
    // acaba antes, a resposta visível sai em branco).
    const MAX_TOKENS_TETO = 32000;
    const maxTokensReq = Math.min(Number(maxTokens) || 3000, MAX_TOKENS_TETO);

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from('profiles')
      .select('creditos_ia')
      .eq('id', userId)
      .single();
    if (perfilError || !perfil) return json({ error: 'Perfil não encontrado.' }, 404);

    const { data: assinaturaAtiva } = await supabaseAdmin.rpc('assinatura_ativa', { uid: userId });
    if (!assinaturaAtiva) {
      return json({ error: 'Assinatura inativa.', assinaturaInativa: true }, 403);
    }

    if (Number(perfil.creditos_ia) <= 0) {
      return json({ error: 'Créditos de IA insuficientes.', creditosInsuficientes: true }, 402);
    }

    const resp = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: mensagens,
        temperature: 0.4,
        max_tokens: maxTokensReq,
      }),
    });

    if (!resp.ok) {
      const raw = await resp.text().catch(() => '');
      return json({ error: `Erro da IA (${resp.status}): ${raw}` }, 502);
    }

    const data = await resp.json();
    const resposta = data?.choices?.[0]?.message?.content || '';

    const usage = data?.usage || {};
    const cacheHit = Number(usage.prompt_cache_hit_tokens) || 0;
    const cacheMiss = usage.prompt_cache_miss_tokens != null
      ? Number(usage.prompt_cache_miss_tokens)
      : Math.max((Number(usage.prompt_tokens) || 0) - cacheHit, 0);
    const completionTokens = Number(usage.completion_tokens) || 0;

    // Preço calculado no momento exato desta resposta (não do início da
    // chamada) — a chamada à DeepSeek pode levar segundos, mas a variação
    // entre pico/fora de pico só importa nos poucos segundos de borda do
    // horário, então o efeito prático é desprezível.
    const precos = precosAtuais();
    const custoReal =
      (cacheMiss / 1_000_000) * precos.inputMiss +
      (cacheHit / 1_000_000) * precos.inputHit +
      (completionTokens / 1_000_000) * precos.output;
    // Cobrado do usuário: sempre o dobro do custo real pago à DeepSeek
    // (mesmo multiplicador aplicado à transcrição — ver margemCobranca.ts).
    const custo = custoReal * MULTIPLICADOR_COBRANCA_USUARIO;

    const { data: atualizado } = await supabaseAdmin
      .from('profiles')
      .update({ creditos_ia: Number(perfil.creditos_ia) - custo })
      .eq('id', userId)
      .select('creditos_ia')
      .single();

    await supabaseAdmin.from('uso_ia').insert({
      user_id: userId,
      tipo: tipoUso,
      provedor: 'deepseek',
      modelo: DEEPSEEK_MODEL,
      unidades: cacheHit + cacheMiss + completionTokens,
      custo_estimado: custo,
    });

    return json({ resposta, custo, saldoRestante: atualizado?.creditos_ia ?? null });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
