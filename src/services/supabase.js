// ─── Client do Supabase ────────────────────────────────────────────────
// Backend real (Postgres + Auth + RLS). `persistSession: false` de
// propósito — dado clínico sensível, o app deve sempre pedir login de novo
// quando reaberto depois de fechado de verdade (não persiste a sessão em
// disco). Continua ativa normalmente enquanto o app só vai pra segundo
// plano sem ser encerrado pelo sistema/usuário.
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
// Exportada porque o envio de áudio pra transcrição não passa pelo client do
// Supabase: sobe o arquivo direto por FileSystem.uploadAsync (streaming), e
// aí os cabeçalhos de autenticação precisam ser montados na mão. Ver
// src/services/gravacaoEmBlocos.js.
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

const clientReal = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

// ─── Modo somente leitura (conta de demonstração) ──────────────────────
//
// O banco já recusa toda escrita da conta de demonstração — políticas RLS
// restritivas, migration 0097. O problema é o que a pessoa VÊ quando isso
// acontece: o PostgREST responde 204 ou uma lista vazia, sem erro, e o app
// conclui que deu certo. Resultado observado no teste: dava pra "editar" um
// afazer e "apagar" um curso, a tela obedecia, e nada era salvo.
//
// Falha silenciosa é pior que erro. Quem está conhecendo o app conclui que
// ele perde dados — exatamente a impressão contrária à que a demonstração
// existe para causar.
//
// Interceptar aqui, e não em cada tela, é o que torna isso confiável: são
// dezenas de telas que escrevem, e qualquer uma esquecida voltaria a
// mentir. Toda escrita passa por `from()`, então é aqui que se resolve, de
// uma vez, inclusive para telas que ainda nem existem.
let somenteLeitura = false;

export function definirModoSomenteLeitura(ativo) {
  somenteLeitura = !!ativo;
}

export function estaEmModoSomenteLeitura() {
  return somenteLeitura;
}

export const MENSAGEM_SOMENTE_LEITURA =
  'Este é o consultório de demonstração: dá para navegar por tudo, mas nada pode '
  + 'ser criado, alterado ou apagado. É a mesma amostra para todas as pessoas que '
  + 'vêm conhecer o app.\n\nPara ter um consultório seu, crie sua conta.';

/**
 * Um "builder" falso que aceita toda a cadeia do supabase-js e termina em
 * erro.
 *
 * Precisa aceitar `.eq().select().single()` e o que mais vier, porque as
 * telas encadeiam de formas diferentes e nenhuma delas pode quebrar: o
 * objetivo é a pessoa ver a mensagem, não um crash.
 */
function recusa() {
  const erro = { message: MENSAGEM_SOMENTE_LEITURA, code: 'DEMONSTRACAO' };
  const resultado = { data: null, error: erro, count: null, status: 403, statusText: 'Forbidden' };

  const alvo = {
    then: (aoResolver, aoRejeitar) => Promise.resolve(resultado).then(aoResolver, aoRejeitar),
    catch: (aoRejeitar) => Promise.resolve(resultado).catch(aoRejeitar),
    finally: (aoFim) => Promise.resolve(resultado).finally(aoFim),
  };

  // Qualquer método encadeado devolve o próprio objeto; qualquer `await`
  // resolve no erro. É o que mantém `.eq(...).select(...)` funcionando sem
  // que este arquivo precise conhecer a lista de métodos do supabase-js.
  return new Proxy(alvo, {
    get(destino, prop) {
      if (prop in destino) return destino[prop];
      return () => recusa();
    },
  });
}

const ESCRITAS = ['insert', 'update', 'upsert', 'delete'];

export const supabase = new Proxy(clientReal, {
  get(destino, prop) {
    if (prop !== 'from') {
      const valor = destino[prop];
      return typeof valor === 'function' ? valor.bind(destino) : valor;
    }
    return (tabela) => {
      const consulta = destino.from(tabela);
      if (!somenteLeitura) return consulta;
      return new Proxy(consulta, {
        get(alvoConsulta, metodo) {
          if (ESCRITAS.includes(metodo)) return () => recusa();
          const valor = alvoConsulta[metodo];
          return typeof valor === 'function' ? valor.bind(alvoConsulta) : valor;
        },
      });
    };
  },
});
