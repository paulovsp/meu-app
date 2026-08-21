// ─── Alerta de recebimento em atraso ────────────────────────────────────
// Cobrança mensal: quando passa o dia de pagamento sem ser marcado como
// recebido, avisa a própria psicanalista (não o analisante). O e-mail saiu
// daqui (item 1, leva pós-v13) — mandar toda vez que a Início ganhava foco
// fazia o horário do aviso parecer aleatório; agora é o digest diário
// (Edge Function enviar-digest-diario, via cron, sempre no mesmo horário).
// Esta função só cuida do push (mais imediato) e da lista pro pop-up da
// tela inicial.
import { getRecebimentosDoMes } from './database';

function diasNoMes(ano, mesIndex) {
  return new Date(ano, mesIndex + 1, 0).getDate();
}

function diasDesdeVencimento(ano, mesIndex, diaPagamento) {
  const vencimento = new Date(ano, mesIndex, Math.min(diaPagamento, diasNoMes(ano, mesIndex)));
  const hoje = new Date();
  const hojeSemHora = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((hojeSemHora - vencimento) / 86400000);
}

function hojeISO() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
}

/** Analisantes de cobrança mensal, não recebidos, com pelo menos 1 dia de
 * atraso no mês corrente — usado tanto pelo e-mail automático quanto pelo
 * pop-up da tela inicial. */
export async function obterRecebimentosAtrasados() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mesIndex = hoje.getMonth();
  const recebimentos = await getRecebimentosDoMes(ano, mesIndex);

  return recebimentos
    .filter((r) => r.tipo_cobranca !== 'por_sessao' && !r.recebido)
    .map((r) => ({ ...r, diasAtraso: diasDesdeVencimento(ano, mesIndex, r.dia_pagamento) }))
    .filter((r) => r.diasAtraso >= 1);
}

/** Catch-up silencioso — chamado ao abrir o app. Manda UM push agregado
 * (não um por paciente) com todos os atrasados ainda não avisados hoje, e
 * marca a data do envio pra não repetir no mesmo dia. Silencioso: falhas só
 * vão pro console, não interrompem o uso do app. */
export async function verificarEEnviarAlertaAtraso() {
  const atrasados = await obterRecebimentosAtrasados();
  if (atrasados.length === 0) return;

  const { supabase } = require('./supabase');
  const { data: { session } } = await supabase.auth.getSession();
  const { data: perfil } = await supabase
    .from('profiles')
    .select('notif_atraso_push')
    .eq('id', session.user.id)
    .single();
  if (perfil?.notif_atraso_push !== true) return;

  const idsAtrasados = atrasados.map((a) => a.patient_id);
  const { data: statusAlertas, error: errStatus } = await supabase
    .from('patients')
    .select('id, alerta_atraso_ultimo_envio')
    .in('id', idsAtrasados);
  if (errStatus) throw errStatus;

  const hoje = hojeISO();
  const jaAvisadosHoje = new Set(
    (statusAlertas || []).filter((p) => p.alerta_atraso_ultimo_envio === hoje).map((p) => p.id)
  );
  const paraAvisar = atrasados.filter((a) => !jaAvisadosHoje.has(a.patient_id));
  if (paraAvisar.length === 0) return;

  const { error } = await supabase.functions.invoke('enviar-alerta-atraso', {
    body: {
      atrasados: paraAvisar.map((a) => ({ nome: a.nome, diasAtraso: a.diasAtraso, valor: a.valorPrevisto })),
    },
  });
  if (error) throw error;

  await supabase
    .from('patients')
    .update({ alerta_atraso_ultimo_envio: hoje })
    .in('id', paraAvisar.map((a) => a.patient_id));
}
