// ─── Autorização de gravação/transcrição pelo analisante ──────────────
// Pede que a Edge Function `solicitar-autorizacao` envie o e-mail de
// confirmação, e consulta o status mais recente na tabela
// `autorizacoes_transcricao` (Supabase). O analisante confirma pelo link
// que recebe por e-mail (Edge Function `confirmar-autorizacao`), fora do
// app — aqui só lemos o resultado.
import { supabase } from './supabase';

/** paciente: { id, nome, cpf, nascimento (YYYY-MM-DD, já vem assim do Supabase), email } */
export async function solicitarAutorizacao(paciente) {
  const nascimentoISO = paciente?.nascimento || null;
  if (!paciente?.nome || !paciente?.cpf || !nascimentoISO || !paciente?.email) {
    return { ok: false, error: 'Nome, CPF, data de nascimento e e-mail do analisante são obrigatórios para solicitar autorização.' };
  }

  const { data, error } = await supabase.functions.invoke('solicitar-autorizacao', {
    body: {
      patient_local_id: paciente.id,
      nome: paciente.nome,
      cpf: paciente.cpf,
      nascimento: nascimentoISO,
      email: paciente.email,
    },
  });

  if (error) {
    // O supabase-js só bota "Edge Function returned a non-2xx status code"
    // em error.message — o corpo de erro de verdade que a função devolveu
    // (`{ error: '...' }`) fica em error.context, que é a Response bruta.
    let mensagem = error.message;
    try {
      const corpo = await error.context?.json();
      if (corpo?.error) mensagem = corpo.error;
    } catch (_) {}
    return { ok: false, error: mensagem || 'Falha ao solicitar autorização.' };
  }
  if (data?.error) {
    return { ok: false, error: data.error };
  }
  return { ok: true };
}

/** Retorna a solicitação mais recente para o paciente local, ou null se nunca foi solicitada. */
export async function getStatusAutorizacao(patientLocalId) {
  const { data, error } = await supabase
    .from('autorizacoes_transcricao')
    .select('status, criado_em, expira_em, respondido_em, tentativas, motivo_rejeicao')
    .eq('patient_local_id', patientLocalId)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Erro ao buscar status de autorização:', error.message);
    return null;
  }
  return data;
}
