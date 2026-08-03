// Edge Function: ia-busca
// Motor de geração dos Relatórios por analisante (RelatoriosScreen.js) via
// DeepSeek — antes alimentava o chat livre "Assistente Clínico", removido
// em favor de relatórios pré-definidos, sem pergunta aberta gastando
// crédito à toa. Recebe o array de mensagens já pronto (system prompt +
// prompt de usuário, sempre uma única rodada — não é mais um histórico de
// chat de verdade).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')!;

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

// Preços DeepSeek V4-Flash (jul/2026 — ajustar aqui se mudar), por 1M tokens.
const PRECO_INPUT_MISS_POR_1M = 0.14;
const PRECO_INPUT_HIT_POR_1M = 0.0028;
const PRECO_OUTPUT_POR_1M = 0.28;

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
    const { mensagens } = body || {};
    if (!Array.isArray(mensagens) || mensagens.length === 0) {
      return json({ error: 'Mensagens ausentes.' }, 400);
    }

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
        max_tokens: 3000,
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

    const custo =
      (cacheMiss / 1_000_000) * PRECO_INPUT_MISS_POR_1M +
      (cacheHit / 1_000_000) * PRECO_INPUT_HIT_POR_1M +
      (completionTokens / 1_000_000) * PRECO_OUTPUT_POR_1M;

    const { data: atualizado } = await supabaseAdmin
      .from('profiles')
      .update({ creditos_ia: Number(perfil.creditos_ia) - custo })
      .eq('id', userId)
      .select('creditos_ia')
      .single();

    await supabaseAdmin.from('uso_ia').insert({
      user_id: userId,
      tipo: 'relatorio',
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
