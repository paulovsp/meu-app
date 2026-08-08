// ─── Envio fiscal automático (Nota/Recibo) ──────────────────────────────
// Duas origens de disparo:
//  - `dispararFiscalPorSessao`: na hora, logo após confirmar o pagamento
//    de uma sessão (só quando a cadência configurada é 'sessao').
//  - `processarEnviosFiscaisAutomaticos`: catch-up silencioso chamado ao
//    abrir o app (InicioScreen), cobrindo as cadências 'mensal' (cobrança
//    mensal, no dia do mês configurado) e 'semanal' (cobrança por sessão,
//    1x por mês na primeira ocorrência do dia da semana configurado,
//    agregando as sessões pagas naquela semana).
// Fire-and-forget: falhas de um paciente nunca travam os demais nem
// aparecem em Alert — só no console, já que isso roda em segundo plano.
import { supabase } from './supabase';
import {
  emitirParaPaciente, composePeriodoMensal, composePeriodoSemana, composePeriodoSessao,
  MESES_LABEL, capitalizar,
} from './fiscalEmissao';
import {
  getConfiguracaoFiscal, marcarEnvioFiscalAutomatico,
  getPlanoFinanceiro, getPagamentosSessaoPorPeriodo,
} from './database';

async function getProfissional() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
  return data || null;
}

function diasNoMes(ano, mesIndex) {
  return new Date(ano, mesIndex + 1, 0).getDate();
}

function toISO(ano, mesIndex, dia) {
  return `${ano}-${String(mesIndex + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function primeiraOcorrenciaDiaSemanaNoMes(ano, mesIndex, diaSemana) {
  for (let d = 1; d <= 7; d++) {
    if (new Date(ano, mesIndex, d).getDay() === diaSemana) return d;
  }
  return 1;
}

function mesmoMesDoEnvio(dataISO, ano, mesIndex) {
  if (!dataISO) return false;
  const [y, m] = dataISO.split('-').map(Number);
  return y === ano && (m - 1) === mesIndex;
}

async function pagamentoMensalRecebido(patientId, ano, mesIndex) {
  const { data } = await supabase
    .from('pagamentos')
    .select('recebido')
    .eq('patient_id', patientId)
    .eq('ano', ano)
    .eq('mes', mesIndex)
    .is('appointment_id', null)
    .maybeSingle();
  return !!data?.recebido;
}

/** Disparo imediato ao confirmar pagamento de uma sessão — só age se a
 * config automática do paciente for 'sessao'. Nunca lança: falhas só vão
 * pro console, pra não travar quem chamou (ex: DetalheCompromissoScreen
 * navegando de volta pra Agenda). */
export async function dispararFiscalPorSessao(patientId, dataSessaoISO, valor) {
  try {
    const config = await getConfiguracaoFiscal(patientId);
    if (config?.fiscal_frequencia_automatica !== 'sessao') return;

    const profissional = await getProfissional();
    if (!profissional) return;

    const periodo = composePeriodoSessao(dataSessaoISO);
    await emitirParaPaciente(config.tipo_emissao_fiscal, {
      profissional, paciente: config, valor, periodo,
    });
  } catch (e) {
    console.error('Falha no envio fiscal automático (por sessão):', e?.message || e);
  }
}

async function processarMensal(paciente, profissional, ano, mesIndex, diaHoje, valor) {
  if (!valor) return;
  const diaConfigurado = Math.min(paciente.fiscal_dia_mes || paciente.dia_pagamento || 1, diasNoMes(ano, mesIndex));
  if (diaHoje < diaConfigurado) return;
  if (mesmoMesDoEnvio(paciente.fiscal_ultimo_envio_mensal, ano, mesIndex)) return;
  if (!(await pagamentoMensalRecebido(paciente.id, ano, mesIndex))) return;

  const periodo = composePeriodoMensal(MESES_LABEL[mesIndex], ano);
  await emitirParaPaciente(paciente.tipo_emissao_fiscal, { profissional, paciente, valor, periodo });
  await marcarEnvioFiscalAutomatico(paciente.id, 'mensal', toISO(ano, mesIndex, diaHoje));
}

async function processarSemanal(paciente, profissional, ano, mesIndex, diaHoje) {
  if (paciente.fiscal_dia_semana === null || paciente.fiscal_dia_semana === undefined) return;
  const diaAlvo = primeiraOcorrenciaDiaSemanaNoMes(ano, mesIndex, paciente.fiscal_dia_semana);
  if (diaHoje < diaAlvo) return;
  if (mesmoMesDoEnvio(paciente.fiscal_ultimo_envio_semanal, ano, mesIndex)) return;

  const inicioSemana = Math.max(1, diaAlvo - 6);
  const inicioISO = toISO(ano, mesIndex, inicioSemana);
  const fimISO = toISO(ano, mesIndex, diaAlvo);
  const valor = await getPagamentosSessaoPorPeriodo(paciente.id, inicioISO, fimISO);
  if (!valor) return;

  const periodo = composePeriodoSemana(inicioISO, fimISO);
  await emitirParaPaciente(paciente.tipo_emissao_fiscal, { profissional, paciente, valor, periodo });
  await marcarEnvioFiscalAutomatico(paciente.id, 'semanal', toISO(ano, mesIndex, diaHoje));
}

/** Catch-up silencioso — chamado toda vez que a tela inicial ganha foco.
 * Idempotente: cada paciente só é processado uma vez por mês por
 * cadência (controlado por fiscal_ultimo_envio_mensal/_semanal). */
export async function processarEnviosFiscaisAutomaticos() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mesIndex = hoje.getMonth();
  const diaHoje = hoje.getDate();

  const profissional = await getProfissional();
  if (!profissional) return;

  const { data: pacientes, error } = await supabase
    .from('patients')
    .select('id, nome, email, cpf, tipo_cobranca, valor_mensal_fixo, tipo_emissao_fiscal, fiscal_frequencia_automatica, fiscal_dia_semana, fiscal_dia_mes, dia_pagamento, fiscal_ultimo_envio_semanal, fiscal_ultimo_envio_mensal')
    .not('fiscal_frequencia_automatica', 'is', null);
  if (error || !pacientes || pacientes.length === 0) return;

  const precisaPlano = pacientes.some((p) => p.tipo_cobranca === 'mensal' && p.fiscal_frequencia_automatica === 'mensal');
  const subtotalPorPaciente = {};
  if (precisaPlano) {
    const plano = await getPlanoFinanceiro(new Date(ano, mesIndex, 1));
    plano.itensMensal.forEach((item) => { subtotalPorPaciente[item.patient_id] = item.subtotal; });
  }

  for (const paciente of pacientes) {
    try {
      if (paciente.tipo_cobranca === 'mensal_fixo' && paciente.fiscal_frequencia_automatica === 'mensal') {
        await processarMensal(paciente, profissional, ano, mesIndex, diaHoje, Number(paciente.valor_mensal_fixo) || 0);
      } else if (paciente.tipo_cobranca === 'mensal' && paciente.fiscal_frequencia_automatica === 'mensal') {
        await processarMensal(paciente, profissional, ano, mesIndex, diaHoje, subtotalPorPaciente[paciente.id] || 0);
      } else if (paciente.tipo_cobranca === 'por_sessao' && paciente.fiscal_frequencia_automatica === 'semanal') {
        await processarSemanal(paciente, profissional, ano, mesIndex, diaHoje);
      }
    } catch (e) {
      console.error(`Falha no envio fiscal automático (${paciente.nome}):`, e?.message || e);
    }
  }
}
