// Blocos de transcrição — lógica única usada pelas quatro functions de
// transcrição (ia-transcrever / ia-transcrever-webhook, para sessões, e
// curso-transcrever / curso-transcrever-webhook, para aulas).
//
// Por que blocos: um .m4a só é finalizado quando a gravação para, então uma
// aula de 4h num arquivo único vira lixo irrecuperável se o app for morto no
// minuto 200. Gravações acima de 1h são gravadas em blocos de até 1h, cada
// um enviado assim que fecha — perde-se no máximo o bloco corrente.
// Gravação curta é só o caso particular de um bloco só (total = 1), pelo
// mesmo caminho de código. Ver migration 0054.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type ColunaDono = 'session_id' | 'curso_id';

export type Bloco = {
  id: string;
  session_id: string | null;
  curso_id: string | null;
  indice: number;
  total: number;
};

/** A gravação a que um bloco pertence, no formato que as queries pedem. */
function donoDoBloco(bloco: Bloco): { coluna: ColunaDono; id: string } {
  return bloco.session_id
    ? { coluna: 'session_id', id: bloco.session_id }
    : { coluna: 'curso_id', id: bloco.curso_id as string };
}

/**
 * Registra um bloco recém-enviado pra AssemblyAI.
 *
 * `total` chega 0 enquanto a gravação está em andamento (o app só sabe
 * quantos blocos são quando ela termina) e com o número real junto do
 * último bloco — que então é gravado em todos os blocos da gravação.
 *
 * Apaga antes de inserir em vez de usar upsert de propósito: o índice único
 * é parcial (`where session_id is not null`), e o ON CONFLICT do PostgREST
 * não consegue inferir índice parcial. Isso também deixa o reenvio de um
 * bloco que falhou ser idempotente.
 */
export async function registrarBloco(
  admin: SupabaseClient,
  coluna: ColunaDono,
  donoId: string,
  indice: number,
  total: number,
  transcriptId: string,
) {
  await admin.from('transcript_segments').delete().eq(coluna, donoId).eq('indice', indice);

  const { error } = await admin.from('transcript_segments').insert({
    [coluna]: donoId,
    indice,
    total,
    assemblyai_transcript_id: transcriptId,
    status: 'processando',
  });
  if (error) throw new Error(`Erro ao registrar o bloco de transcrição: ${error.message}`);

  if (total > 0) {
    await admin.from('transcript_segments').update({ total }).eq(coluna, donoId);
  }
}

/** Acha a qual bloco (e a qual gravação) pertence um transcript_id da
 * AssemblyAI — é a única coisa que o webhook recebe. */
export async function acharBloco(
  admin: SupabaseClient,
  transcriptId: string,
): Promise<Bloco | null> {
  const { data } = await admin
    .from('transcript_segments')
    .select('id, session_id, curso_id, indice, total')
    .eq('assemblyai_transcript_id', transcriptId)
    .maybeSingle();
  return (data as Bloco) ?? null;
}

export async function marcarBlocoComErro(admin: SupabaseClient, bloco: Bloco) {
  await admin.from('transcript_segments').update({ status: 'erro' }).eq('id', bloco.id);
}

/**
 * Guarda o texto de um bloco e devolve o texto INTEIRO da gravação se este
 * era o último que faltava — ou `null` se ainda falta bloco (aí a gravação
 * segue "processando" e ninguém é notificado: o aviso só faz sentido com o
 * texto completo).
 */
export async function salvarBlocoEMontarTexto(
  admin: SupabaseClient,
  bloco: Bloco,
  texto: string,
): Promise<string | null> {
  await admin
    .from('transcript_segments')
    .update({ texto, status: 'concluida' })
    .eq('id', bloco.id);

  const dono = donoDoBloco(bloco);
  const { data } = await admin
    .from('transcript_segments')
    .select('indice, texto, status, total')
    .eq(dono.coluna, dono.id)
    .order('indice', { ascending: true });
  const blocos = data || [];

  // `total` vale 0 em todo bloco enviado antes do último. Pegar o maior
  // cobre a janela em que o total definitivo já foi gravado em algumas
  // linhas e ainda não em outras.
  const total = Math.max(0, ...blocos.map((b: any) => Number(b.total) || 0));
  const concluidos = blocos.filter((b: any) => b.status === 'concluida');
  if (total <= 0 || concluidos.length < total) return null;

  // Ordem dos blocos (`indice`), nunca a ordem de chegada dos webhooks —
  // a AssemblyAI não garante nenhuma ordem entre transcrições paralelas.
  return concluidos
    .map((b: any) => String(b.texto || '').trim())
    .filter(Boolean)
    .join('\n');
}
