// ─── Toda falha deixa registro em op_eventos ───────────────────────────
//
// Até aqui, o que dava errado numa Edge Function virava `console.error`
// num log que ninguém abre. O envoltório `servir()` troca isso por uma
// linha em `op_eventos` (migration 0105): quem lançou exceção, quem
// respondeu 5xx, com o nome da função e um pedaço do que foi devolvido.
//
// É o que o agente Vigia lê todo dia. Sem isto, ele não tem o que ler.
//
// Uso, em cada função:
//
//     Deno.serve(servir('nome-da-funcao', async (req) => { ... }));
//
// O envoltório nunca derruba a função: se o próprio registro falhar, o
// erro original continua sendo devolvido a quem chamou.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Severidade = 'info' | 'aviso' | 'erro' | 'critico';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

export async function registrarEvento(
  origem: string,
  severidade: Severidade,
  mensagem: string,
  contexto?: Record<string, unknown>,
): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    await admin.from('op_eventos').insert({
      origem,
      severidade,
      mensagem: mensagem.slice(0, 1000),
      contexto: contexto ?? null,
    });
  } catch (err) {
    console.error('registrarEvento: não consegui gravar o evento.', origem, err);
  }
}

type Handler = (req: Request) => Response | Promise<Response>;

/** Envolve o handler de uma Edge Function: exceção e resposta 5xx viram evento. */
export function servir(nome: string, handler: Handler): Handler {
  return async (req: Request) => {
    const inicio = Date.now();
    try {
      const resposta = await handler(req);
      if (resposta.status >= 500) {
        let corpo = '';
        try { corpo = (await resposta.clone().text()).slice(0, 500); } catch (_) { /* sem corpo legível */ }
        await registrarEvento(nome, 'erro', `Respondeu ${resposta.status}`, {
          metodo: req.method,
          corpo,
          duracaoMs: Date.now() - inicio,
        });
      }
      return resposta;
    } catch (err) {
      const mensagem = String((err as Error)?.message || err);
      await registrarEvento(nome, 'critico', `Exceção não tratada: ${mensagem}`, {
        metodo: req.method,
        pilha: String((err as Error)?.stack || '').slice(0, 1500),
        duracaoMs: Date.now() - inicio,
      });
      return new Response(JSON.stringify({ error: 'Erro interno.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}
