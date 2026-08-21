// ── PACIENTES (Supabase — tabela `patients`) ───────────

async function getUserId() {
  const { supabase } = require('./supabase');
  const { data: { session } } = await supabase.auth.getSession();
  return session.user.id;
}

export async function listarPacientes() {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase.from('patients').select('*').order('nome', { ascending: true });
  if (error) throw error;
  return data;
}

export async function inserirPaciente({
  nome, nascimento, data_inicio, data_paralizacao, telefone, email, cpf,
  horario, preco_sessao, preco_moeda, modalidade, endereco,
  contato_emergencia, como_chegou, info_relevantes, dia_pagamento, tipo_cobranca,
  valor_mensal_fixo, eh_analisante, eh_supervisionando,
}) {
  const { supabase } = require('./supabase');
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('patients')
    .insert({
      user_id: userId, nome, nascimento: nascimento || null, data_inicio: data_inicio || null,
      data_paralizacao: data_paralizacao || null,
      telefone: telefone || null, email: email || null, cpf: cpf || null,
      horario: horario || null, preco_sessao: preco_sessao || null, preco_moeda: preco_moeda || 'BRL',
      modalidade: modalidade || null, endereco: endereco || null,
      contato_emergencia: contato_emergencia || null, como_chegou: como_chegou || null,
      info_relevantes: info_relevantes || null, dia_pagamento: dia_pagamento || null,
      tipo_cobranca: tipo_cobranca || 'mensal',
      valor_mensal_fixo: tipo_cobranca === 'mensal_fixo' ? (valor_mensal_fixo || null) : null,
      eh_analisante: eh_analisante !== false,
      eh_supervisionando: eh_supervisionando === true,
    })
    .select()
    .single();
  if (error) throw error;
  return data.id;
}

export async function editarPaciente({
  id, nome, nascimento, data_inicio, data_paralizacao, telefone, email, cpf,
  horario, preco_sessao, preco_moeda, modalidade, endereco,
  contato_emergencia, como_chegou, info_relevantes, dia_pagamento, tipo_cobranca,
  valor_mensal_fixo, eh_analisante, eh_supervisionando,
}) {
  const { supabase } = require('./supabase');
  const { error } = await supabase
    .from('patients')
    .update({
      nome, nascimento: nascimento || null, data_inicio: data_inicio || null,
      data_paralizacao: data_paralizacao || null,
      telefone: telefone || null, email: email || null, cpf: cpf || null,
      horario: horario || null, preco_sessao: preco_sessao || null, preco_moeda: preco_moeda || 'BRL',
      modalidade: modalidade || null, endereco: endereco || null,
      contato_emergencia: contato_emergencia || null, como_chegou: como_chegou || null,
      info_relevantes: info_relevantes || null, dia_pagamento: dia_pagamento || null,
      tipo_cobranca: tipo_cobranca || 'mensal',
      valor_mensal_fixo: tipo_cobranca === 'mensal_fixo' ? (valor_mensal_fixo || null) : null,
      eh_analisante: eh_analisante !== false,
      eh_supervisionando: eh_supervisionando === true,
    })
    .eq('id', id);
  if (error) throw error;
}

// Apaga o paciente e tudo que depende dele (sessions, records,
// transcript_turns, agenda, financeiro, núcleos/objetivo, relatórios) via
// `on delete cascade` nas FKs definidas nas migrations do Supabase.
export async function deletarPaciente(id) {
  const { supabase } = require('./supabase');
  const { error } = await supabase.from('patients').delete().eq('id', id);
  if (error) throw error;
}

// ── SESSÕES ────────────────────────────────────────────

export async function getSessions(patientId) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('patient_id', patientId)
    .order('date', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getSessionById(id) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase.from('sessions').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Resumo da agenda de hoje pro card da tela inicial: quantos horários
 * ocupados (availability_slots com patient_id) existem hoje e quantos já
 * passaram do horário de término, no formato "concluídas/total".
 */
export async function getResumoAgendaHoje() {
  const { supabase } = require('./supabase');
  const hoje = new Date();
  const diaSemana = hoje.getDay();
  const horaAtual = `${String(hoje.getHours()).padStart(2, '0')}:${String(hoje.getMinutes()).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('availability_slots')
    .select('end_time')
    .eq('day_of_week', diaSemana)
    .not('patient_id', 'is', null);
  if (error) throw error;
  const total = data.length;
  const concluidas = data.filter((s) => s.end_time <= horaAtual).length;
  return { total, concluidas };
}

export async function addSession(patientId, type, platform, category, appointmentId = null) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      patient_id: patientId, type: type || null, online_platform: platform || null,
      date: new Date().toISOString(), transcript: '', audio_uri: null, category: category || null,
      appointment_id: appointmentId || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateSession(id, { transcript, audio_uri, category, duration_seconds }) {
  const { supabase } = require('./supabase');
  const { error } = await supabase
    .from('sessions')
    .update({
      transcript: transcript || '', audio_uri: audio_uri || null,
      category: category || null, duration_seconds: duration_seconds || null,
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteSession(id) {
  const { supabase } = require('./supabase');
  const { error } = await supabase.from('sessions').delete().eq('id', id);
  if (error) throw error;
}

/** Fallback de quando a transcrição assíncrona (AssemblyAI) falha —
 * digitação manual do texto completo (introdução + diálogo), voltando o
 * status pra `null` (mesmo tratamento das sessões antigas, transcritas
 * manualmente antes desta função existir). */
export async function salvarTranscricaoManual(sessionId, transcript) {
  const { supabase } = require('./supabase');
  const { error } = await supabase
    .from('sessions')
    .update({ transcript: transcript || '', transcricao_status: null })
    .eq('id', sessionId);
  if (error) throw error;
}

// ── TRANSCRIPT TURNS ───────────────────────────────────

export async function saveTranscriptTurns(sessionId, turns) {
  const { supabase } = require('./supabase');
  const { error: erroDelete } = await supabase.from('transcript_turns').delete().eq('session_id', sessionId);
  if (erroDelete) throw erroDelete;

  if (!turns || turns.length === 0) return;

  const { error } = await supabase.from('transcript_turns').insert(
    turns.map((turn) => ({
      session_id: sessionId,
      turn_index: turn.turn_index,
      speaker: turn.speaker,
      text: turn.text,
      start_time_seconds: turn.start_time_seconds ?? null,
      end_time_seconds: turn.end_time_seconds ?? null,
    }))
  );
  if (error) throw error;
}

export async function getTranscriptTurns(sessionId) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('transcript_turns')
    .select('*')
    .eq('session_id', sessionId)
    .order('turn_index', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getTurnCount(sessionId) {
  const { supabase } = require('./supabase');
  const { count, error } = await supabase
    .from('transcript_turns')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if (error) throw error;
  return count ?? 0;
}

// ── REGISTROS ──────────────────────────────────────────

export async function getRecords(patientId) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('records')
    .select('*')
    .eq('patient_id', patientId)
    .order('date', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getRecordById(id) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase.from('records').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function addRecord(patientId, type, title, content, fileUri, sessionId, category, author) {
  const { supabase } = require('./supabase');
  const authorNorm = normalizarAuthor(author);
  const { data, error } = await supabase
    .from('records')
    .insert({
      patient_id: patientId, session_id: sessionId || null, type: type || null,
      title: title || '', content: content || '', file_uri: fileUri || null,
      date: new Date().toISOString(), category: category || null, author: authorNorm,
    })
    .select()
    .single();
  if (error) throw error;
  return data.id;
}

export async function deleteRecord(id) {
  const { supabase } = require('./supabase');
  const { error } = await supabase.from('records').delete().eq('id', id);
  if (error) throw error;
}

export async function editRecord(id, { type, title, content, category }) {
  const { supabase } = require('./supabase');
  const { error } = await supabase
    .from('records')
    .update({ type: type || null, title: title || '', content: content || '', category: category || null })
    .eq('id', id);
  if (error) throw error;
}

// ⚠️ TEMPORÁRIO — só pra importação de dados de teste, não é função do app final.
export async function importarRegistroComData(patientId, type, title, content, dataISO) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('records')
    .insert({
      patient_id: patientId, session_id: null, type: type || null, title: title || '',
      content: content || '', file_uri: null, date: dataISO, category: null, author: 'analyst',
    })
    .select()
    .single();
  if (error) throw error;
  return data.id;
}

// ── NORMALIZAÇÃO DE AUTOR ──────────────────────────────

export function normalizarAuthor(autor) {
  if (!autor) return 'analyst';
  const v = autor.toLowerCase().trim();
  if (v === 'analyst' || v === 'analista') return 'analyst';
  if (v === 'analysand' || v === 'analisante') return 'analysand';
  if (v === 'alternado') return 'alternado';
  return 'analyst';
}

// ── FORMATAÇÃO DE TEXTO COM AUTOR ──────────────────────

export function formatarTextoComAutor(texto, author) {
  if (!texto || !texto.trim()) return texto;

  const authorNorm = normalizarAuthor(author);
  const JA_TEM_PREFIXO = /^[AP]\s*:/i;
  const linhas = texto.split('\n');

  const resultado = linhas.map(linha => {
    const linhaLimpa = linha.trim();
    if (!linhaLimpa) return '';
    if (JA_TEM_PREFIXO.test(linhaLimpa)) return linhaLimpa;
    if (authorNorm === 'analyst') return `A: ${linhaLimpa}`;
    if (authorNorm === 'analysand') return `P: ${linhaLimpa}`;
    return `A: ${linhaLimpa}`;
  });

  return resultado.join('\n');
}

// ── PARSE DE TRANSCRIÇÃO ───────────────────────────────

export function parseTranscriptToTurns(rawText) {
  if (!rawText || !rawText.trim()) return [];

  const lines = rawText.trim().split('\n');
  const turns = [];
  let currentSpeaker = null;
  let currentText = [];
  let turnIndex = 0;

  const ANALYST_PREFIX   = /^(A|Analista)\s*:\s*/i;
  const ANALYSAND_PREFIX = /^(P|Paciente|Analisante)\s*:\s*/i;

  function flushTurn() {
    if (currentSpeaker && currentText.length > 0) {
      const text = currentText.join('\n').trim();
      if (text) {
        turns.push({ turn_index: turnIndex, speaker: currentSpeaker, text });
        turnIndex++;
      }
    }
    currentText = [];
  }

  for (const line of lines) {
    const analystMatch   = line.match(ANALYST_PREFIX);
    const analysandMatch = line.match(ANALYSAND_PREFIX);

    if (analystMatch) {
      flushTurn();
      currentSpeaker = 'analyst';
      currentText.push(line.substring(analystMatch[0].length));
    } else if (analysandMatch) {
      flushTurn();
      currentSpeaker = 'analysand';
      currentText.push(line.substring(analysandMatch[0].length));
    } else {
      if (!currentSpeaker) currentSpeaker = 'analyst';
      currentText.push(line);
    }
  }

  flushTurn();

  return turns;
}

// ===================== AGENDA: DISPONIBILIDADE =====================
// `availability_slots`/`appointments` vivem no Supabase (ver
// supabase/migrations/0004_child_tables.sql).

// ---------- ANALISANTES (para o seletor da tela de disponibilidade) ----------

export async function getPatients() {
  const rows = await listarPacientes();
  return rows.map((row) => ({ id: row.id, name: row.nome }));
}

export async function addPatient(nome) {
  if (!nome || !nome.trim()) return null;

  const id = await inserirPaciente({ nome: nome.trim() });
  return { id, name: nome.trim() };
}

// ---------- DISPONIBILIDADE (Supabase — tabela `availability_slots`) -----

function achatarSlotComPaciente(row) {
  const { patients, ...resto } = row;
  return {
    ...resto,
    patient_name: patients?.nome ?? null,
    patient_telefone: patients?.telefone ?? null,
    patient_preco: patients?.preco_sessao ?? null,
    patient_preco_moeda: patients?.preco_moeda ?? null,
  };
}

/** Preenche `participantes` (lista {id, nome}) em cada slot de tipo "em
 * grupo" — uma única consulta em lote pra todos os slots, em vez de uma
 * por slot. */
async function anexarParticipantesAosSlots(slots) {
  const { supabase } = require('./supabase');
  const idsGrupo = slots.filter((s) => s.tipo?.endsWith('_grupo')).map((s) => s.id);
  if (idsGrupo.length === 0) return slots.map((s) => ({ ...s, participantes: [] }));

  const { data, error } = await supabase
    .from('slot_participantes')
    .select('slot_id, patient_id, patients(nome)')
    .in('slot_id', idsGrupo);
  if (error) throw error;

  const porSlot = {};
  (data || []).forEach((p) => {
    if (!porSlot[p.slot_id]) porSlot[p.slot_id] = [];
    porSlot[p.slot_id].push({ id: p.patient_id, nome: p.patients?.nome ?? null });
  });

  return slots.map((s) => ({ ...s, participantes: porSlot[s.id] || [] }));
}

export async function getAvailabilitySlots() {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('availability_slots')
    .select('*, patients(nome, telefone, preco_sessao, preco_moeda)')
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) throw error;
  return anexarParticipantesAosSlots(data.map(achatarSlotComPaciente));
}

async function salvarParticipantesSlot(slotId, patientIds) {
  const { supabase } = require('./supabase');
  const userId = await getUserId();
  const { error: errDelete } = await supabase.from('slot_participantes').delete().eq('slot_id', slotId);
  if (errDelete) throw errDelete;
  if (patientIds.length === 0) return;
  const { error: errInsert } = await supabase
    .from('slot_participantes')
    .insert(patientIds.map((patient_id) => ({ slot_id: slotId, patient_id, user_id: userId })));
  if (errInsert) throw errInsert;
}

export async function addAvailabilitySlot(day_of_week, start_time, end_time, modality, patient_id, tipo = 'sessao_individual', titulo = null, participantes = []) {
  const { supabase } = require('./supabase');
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('availability_slots')
    .insert({
      user_id: userId, day_of_week, start_time, end_time, modality,
      patient_id: patient_id || null, tipo, titulo: titulo || null,
    })
    .select()
    .single();
  if (error) throw error;
  if (participantes.length > 0) await salvarParticipantesSlot(data.id, participantes);
  return data.id;
}

export async function updateAvailabilitySlot(id, day_of_week, start_time, end_time, modality, patient_id, tipo = 'sessao_individual', titulo = null, participantes = []) {
  const { supabase } = require('./supabase');
  const { error } = await supabase
    .from('availability_slots')
    .update({
      day_of_week, start_time, end_time, modality,
      patient_id: patient_id || null, tipo, titulo: titulo || null,
    })
    .eq('id', id);
  if (error) throw error;
  await salvarParticipantesSlot(id, participantes);
}

export async function deleteAvailabilitySlot(id) {
  const { supabase } = require('./supabase');
  const { error } = await supabase.from('availability_slots').delete().eq('id', id);
  if (error) throw error;
}

export async function clearAvailabilityByDay(day_of_week) {
  const { supabase } = require('./supabase');
  const { error } = await supabase.from('availability_slots').delete().eq('day_of_week', day_of_week);
  if (error) throw error;
}

export async function clearAllAvailability() {
  const { supabase } = require('./supabase');
  const userId = await getUserId();
  const { error } = await supabase.from('availability_slots').delete().eq('user_id', userId);
  if (error) throw error;
}

export async function getAvailabilitySlotsByPatient(patientId) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('availability_slots')
    .select('*')
    .eq('patient_id', patientId)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) throw error;
  return data;
}

export async function deleteAvailabilitySlotsByPatient(patientId) {
  const { supabase } = require('./supabase');
  const { error } = await supabase.from('availability_slots').delete().eq('patient_id', patientId);
  if (error) throw error;
}

/** Desocupa os horários de um analisante (fica "livre"/verde na Agenda, sem
 * apagar o horário em si) — usado quando a análise é paralisada (item 3).
 * `modalidade` é opcional: se vier 'online'/'presencial', reescreve a
 * modalidade de todos os horários liberados; se vier null/undefined, cada
 * horário mantém a modalidade que já tinha. */
export async function liberarHorariosDoPaciente(patientId, modalidade = null) {
  const { supabase } = require('./supabase');
  const payload = { patient_id: null };
  if (modalidade === 'online' || modalidade === 'presencial') payload.modality = modalidade;
  const { error } = await supabase.from('availability_slots').update(payload).eq('patient_id', patientId);
  if (error) throw error;
}

function agregarModalidades(modalidades) {
  if (modalidades.size === 0) return null;
  return modalidades.size > 1 ? 'hibrido' : [...modalidades][0];
}

/** Modalidade (online/presencial/híbrido) derivada da modalidade de cada
 * horário recorrente do paciente — não é mais um campo que se escolhe na
 * ficha, e sim o reflexo de como os horários já estão configurados. Usada
 * na ficha completa (DetalheAnalisanteScreen). */
export async function getModalidadeDerivada(patientId) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('availability_slots')
    .select('modality')
    .eq('patient_id', patientId);
  if (error) throw error;
  const modalidades = new Set((data || []).map((s) => (s.modality === 'online' ? 'online' : 'presencial')));
  return agregarModalidades(modalidades);
}

/** Mesma derivação de getModalidadeDerivada, mas em lote pra todos os
 * pacientes do usuário de uma vez — usada na lista (AnalisantesScreen),
 * pra não fazer uma consulta por paciente. */
export async function getModalidadesPorPaciente() {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('availability_slots')
    .select('patient_id, modality')
    .not('patient_id', 'is', null);
  if (error) throw error;

  const porPaciente = {};
  (data || []).forEach((s) => {
    if (!porPaciente[s.patient_id]) porPaciente[s.patient_id] = new Set();
    porPaciente[s.patient_id].add(s.modality === 'online' ? 'online' : 'presencial');
  });

  const resultado = {};
  Object.entries(porPaciente).forEach(([patientId, modalidades]) => {
    resultado[patientId] = agregarModalidades(modalidades);
  });
  return resultado;
}

/**
 * Depois de resincronizar os horários recorrentes de um paciente (ex: nova
 * modalidade por horário na ficha), atualiza a modalidade dos compromissos
 * ainda 'agendado' (não realizado/cancelado) que combinam com o dia da
 * semana + horário de início de cada horário atual — sem isso, a Agenda
 * continuaria mostrando a modalidade "congelada" de quando o compromisso
 * daquela data específica foi criado (appointments não é reescrito
 * automaticamente quando o horário recorrente muda). Compromissos já
 * concluídos/cancelados nunca são tocados, pra preservar o histórico real
 * de como a sessão de fato aconteceu.
 */
export async function sincronizarModalidadeCompromissosAgendados(patientId, horarios) {
  const { supabase } = require('./supabase');
  const { data: compromissos, error } = await supabase
    .from('appointments')
    .select('id, date, start_time, modality')
    .eq('patient_id', patientId)
    .eq('status', 'agendado');
  if (error) throw error;

  for (const c of compromissos || []) {
    const [ano, mes, dia] = c.date.split('-').map(Number);
    const dayOfWeek = new Date(ano, mes - 1, dia).getDay();
    const horarioCorrespondente = horarios.find(
      (h) => h.day_of_week === dayOfWeek && h.start_time === c.start_time
    );
    if (horarioCorrespondente && horarioCorrespondente.modality !== c.modality) {
      const { error: errUpdate } = await supabase
        .from('appointments')
        .update({ modality: horarioCorrespondente.modality })
        .eq('id', c.id);
      if (errUpdate) throw errUpdate;
    }
  }
}

// ---------- CONFLITOS DE HORÁRIO (item 6) ----------

// Duas modalidades são compatíveis (competem pelo mesmo horário) quando são
// iguais ou quando uma delas é "ambos" (atende os dois formatos). Modalidades
// exclusivas e diferentes (presencial x online) NÃO conflitam entre si —
// podem coexistir no mesmo horário, pois representam tipos de atendimento
// distintos que o analista não confundiria.
export function modalidadesCompativeis(a, b) {
  const A = a === 'hibrido' ? 'ambos' : (a || 'ambos');
  const B = b === 'hibrido' ? 'ambos' : (b || 'ambos');
  if (A === 'ambos' || B === 'ambos') return true;
  return A === B;
}

function horariosSeSobrepoem(inicioA, fimA, inicioB, fimB) {
  const toMin = (h) => {
    const [hh, mm] = String(h).split(':').map(Number);
    return (hh || 0) * 60 + (mm || 0);
  };
  return toMin(inicioA) < toMin(fimB) && toMin(fimA) > toMin(inicioB);
}

/**
 * Apenas CONFERE conflitos/sobreposições para o horário informado, sem
 * alterar nada no banco. Use isso para decidir se é preciso pedir
 * confirmação ao usuário antes de aplicar (ver `aplicarSlot`).
 *
 * Retorna:
 * - ocupado: o slot ocupado (com patient_id) que sobrepõe e é compatível
 *   (conflito real — não deve ser permitido salvar), ou null.
 * - livres: lista de slots livres que sobrepõem e são compatíveis (serão
 *   substituídos se o usuário confirmar).
 * - modalidadeNormalizada: 'hibrido' convertido para 'ambos'.
 */
export async function verificarConflitoSlot({ id, day_of_week, start_time, end_time, modality }) {
  const { supabase } = require('./supabase');
  const modalidadeNormalizada = modality === 'hibrido' ? 'ambos' : (modality || 'ambos');

  const { data, error } = await supabase
    .from('availability_slots')
    .select('*')
    .eq('day_of_week', day_of_week);
  if (error) throw error;
  const doDia = data.filter((slot) => !id || slot.id !== id);

  const sobrepostosCompativeis = doDia.filter((slot) =>
    horariosSeSobrepoem(start_time, end_time, slot.start_time, slot.end_time) &&
    modalidadesCompativeis(modalidadeNormalizada, slot.modality)
  );

  const ocupado = sobrepostosCompativeis.find((slot) => !!slot.patient_id) || null;
  const livres = sobrepostosCompativeis.filter((slot) => !slot.patient_id);

  return { ocupado, livres, modalidadeNormalizada };
}

/**
 * Aplica de fato a criação/edição do slot, removendo antes os `livres`
 * informados (tipicamente o resultado de `verificarConflitoSlot`, já
 * confirmado pelo usuário).
 */
export async function aplicarSlot({
  id, day_of_week, start_time, end_time, modality, patient_id, livresParaRemover = [],
  tipo = 'sessao_individual', titulo = null, participantes = [],
}) {
  for (const slot of livresParaRemover) {
    await deleteAvailabilitySlot(slot.id);
  }

  let novoId = id;
  if (id) {
    await updateAvailabilitySlot(id, day_of_week, start_time, end_time, modality, patient_id, tipo, titulo, participantes);
  } else {
    novoId = await addAvailabilitySlot(day_of_week, start_time, end_time, modality, patient_id, tipo, titulo, participantes);
  }

  return novoId;
}

/**
 * Versão "tudo em um" (confere e já aplica, sem passo de confirmação) —
 * usada em fluxos de lote, como ao salvar os vários horários de um
 * analisante de uma vez no formulário de cadastro.
 */
export async function resolverConflitoEAdicionarSlot({
  id, day_of_week, start_time, end_time, modality, patient_id
}) {
  const { ocupado, livres, modalidadeNormalizada } = await verificarConflitoSlot({
    id, day_of_week, start_time, end_time, modality
  });

  if (ocupado) {
    return { success: false, conflito: ocupado };
  }

  const novoId = await aplicarSlot({
    id, day_of_week, start_time, end_time,
    modality: modalidadeNormalizada, patient_id,
    livresParaRemover: livres,
  });

  return { success: true, id: novoId, removidos: livres.length };
}

// ---------- COMPROMISSOS (Supabase — tabela `appointments`) --------------

function achatarAppointmentComPaciente(row) {
  const { patients, ...resto } = row;
  return {
    ...resto,
    patient_nome: patients?.nome ?? null,
    patient_telefone: patients?.telefone ?? null,
    patient_nascimento: patients?.nascimento ?? null,
    patient_data_inicio: patients?.data_inicio ?? null,
    patient_preco: patients?.preco_sessao ?? null,
    patient_preco_moeda: patients?.preco_moeda ?? null,
    patient_tipo_cobranca: patients?.tipo_cobranca ?? null,
  };
}

const APPOINTMENT_SELECT_COM_PACIENTE =
  '*, patients(nome, telefone, nascimento, data_inicio, preco_sessao, preco_moeda, tipo_cobranca)';

/** Mesma ideia de `anexarParticipantesAosSlots`, pro lado materializado
 * (appointments) — em lote, só pros de tipo "em grupo". */
async function anexarParticipantesAosAppointments(appointments) {
  const { supabase } = require('./supabase');
  const idsGrupo = appointments.filter((a) => a.tipo?.endsWith('_grupo')).map((a) => a.id);
  if (idsGrupo.length === 0) return appointments.map((a) => ({ ...a, participantes: [] }));

  const { data, error } = await supabase
    .from('appointment_participantes')
    .select('appointment_id, patient_id, patients(nome)')
    .in('appointment_id', idsGrupo);
  if (error) throw error;

  const porAppointment = {};
  (data || []).forEach((p) => {
    if (!porAppointment[p.appointment_id]) porAppointment[p.appointment_id] = [];
    porAppointment[p.appointment_id].push({ id: p.patient_id, nome: p.patients?.nome ?? null });
  });

  return appointments.map((a) => ({ ...a, participantes: porAppointment[a.id] || [] }));
}

export async function getAppointmentsByDateRange(startDate, endDate) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT_COM_PACIENTE)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) throw error;
  return anexarParticipantesAosAppointments(data.map(achatarAppointmentComPaciente));
}

/** Compromissos passados (últimos 90 dias, status já resolvido — não
 * "agendado") cruzados com a sessão vinculada (se houver, via
 * `sessions.appointment_id` — ver migration 0042), pra tela "Sessões sem
 * relato". Sessões criadas antes dessa migration não têm o vínculo e
 * simplesmente não aparecem aqui associadas a um compromisso — a contagem
 * "sem relato" do Perfil (getContagemSessoesSemRelato) não depende disso. */
export async function listarStatusSessoes() {
  const { supabase } = require('./supabase');
  const desde = new Date();
  desde.setDate(desde.getDate() - 90);
  const desdeISO = desde.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('appointments')
    .select('id, date, start_time, status, patient_id, patients(nome), sessions(id, transcript, transcricao_status)')
    .neq('status', 'agendado')
    .gte('date', desdeISO)
    .order('date', { ascending: false })
    .order('start_time', { ascending: false });
  if (error) throw error;
  return (data || []).map((a) => {
    const sessao = Array.isArray(a.sessions) ? a.sessions[0] : a.sessions;
    return {
      appointmentId: a.id,
      date: a.date,
      startTime: a.start_time,
      status: a.status,
      patientId: a.patient_id,
      patientNome: a.patients?.nome ?? null,
      sessionId: sessao?.id ?? null,
      temTranscricao: !!(sessao?.transcript || '').trim(),
      transcricaoStatus: sessao?.transcricao_status ?? null,
    };
  });
}

/** Compromissos com horário já passado mas ainda 'agendado' (ninguém
 * confirmou se aconteceu) — nada no app muda esse status sozinho quando o
 * horário passa, então essa é a lista que alimenta o popup de check-in
 * (item 7, v13) na Início. Mesmo filtro de janela (90 dias) que
 * listarStatusSessoes, pra não trazer compromissos muito antigos que
 * ficaram esquecidos. A checagem fina de "já passou" (que precisa do
 * horário, não só da data) usa horarioJaPassou — mesma função da Agenda/
 * DetalheCompromissoScreen — então quem chama filtra o resultado com ela. */
export async function listarCompromissosAguardandoCheckin() {
  const { supabase } = require('./supabase');
  const desde = new Date();
  desde.setDate(desde.getDate() - 90);
  const desdeISO = desde.toISOString().slice(0, 10);
  const hojeISO = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT_COM_PACIENTE)
    .eq('status', 'agendado')
    .gte('date', desdeISO)
    .lte('date', hojeISO)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) throw error;
  return anexarParticipantesAosAppointments(data.map(achatarAppointmentComPaciente));
}

export async function getAppointmentsByDate(date) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT_COM_PACIENTE)
    .eq('date', date)
    .order('start_time', { ascending: true });
  if (error) throw error;
  return anexarParticipantesAosAppointments(data.map(achatarAppointmentComPaciente));
}

/** Todos os compromissos (qualquer data) de um paciente específico — usado
 * no relatório de presença (sessões marcadas/canceladas/faltas). */
export async function getAppointmentsByPatient(patientId) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('patient_id', patientId)
    .order('date', { ascending: false })
    .order('start_time', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getAppointmentById(appointmentId) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT_COM_PACIENTE)
    .eq('id', appointmentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [comParticipantes] = await anexarParticipantesAosAppointments([achatarAppointmentComPaciente(data)]);
  return comParticipantes;
}

const STATUS_APPOINTMENT_VALIDOS = ['agendado', 'realizado', 'cancelado', 'nao_realizado'];

export async function updateAppointmentStatus(appointmentId, novoStatus) {
  if (!STATUS_APPOINTMENT_VALIDOS.includes(novoStatus)) {
    throw new Error(`Status de compromisso inválido: ${novoStatus}`);
  }
  const { supabase } = require('./supabase');
  const { error } = await supabase.from('appointments').update({ status: novoStatus }).eq('id', appointmentId);
  if (error) throw error;
}

/** Copia os participantes do slot (template) pra ocorrência materializada
 * — chamado sempre que um appointment "em grupo" é criado/reconfirmado,
 * pra manter os dois em sincronia (mesmo padrão do `modality`, ver
 * `sincronizarModalidadeCompromissosAgendados`). */
async function sincronizarParticipantesAppointment(appointmentId, slotId) {
  const { supabase } = require('./supabase');
  const userId = await getUserId();
  const { data: slotParts, error: errSlot } = await supabase
    .from('slot_participantes')
    .select('patient_id')
    .eq('slot_id', slotId);
  if (errSlot) throw errSlot;
  const { error: errDelete } = await supabase
    .from('appointment_participantes')
    .delete()
    .eq('appointment_id', appointmentId);
  if (errDelete) throw errDelete;
  if (!slotParts || slotParts.length === 0) return;
  const { error: errInsert } = await supabase
    .from('appointment_participantes')
    .insert(slotParts.map((p) => ({ appointment_id: appointmentId, patient_id: p.patient_id, user_id: userId })));
  if (errInsert) throw errInsert;
}

async function inserirAppointmentSeNaoExiste(userId, slot, dataISO) {
  const { supabase } = require('./supabase');
  const { error } = await supabase
    .from('appointments')
    .upsert(
      {
        user_id: userId, patient_id: slot.patient_id, date: dataISO,
        start_time: slot.start_time, end_time: slot.end_time,
        modality: slot.modality, status: 'agendado',
        tipo: slot.tipo || 'sessao_individual', titulo: slot.titulo || null,
      },
      { onConflict: 'user_id,date,start_time', ignoreDuplicates: true }
    );
  if (error) throw error;

  if (slot.tipo?.endsWith('_grupo')) {
    const { data: appt, error: errBusca } = await supabase
      .from('appointments')
      .select('id')
      .eq('user_id', userId).eq('date', dataISO).eq('start_time', slot.start_time)
      .maybeSingle();
    if (errBusca) throw errBusca;
    if (appt) await sincronizarParticipantesAppointment(appt.id, slot.id);
  }
}

/**
 * Garante que exista uma linha em `appointments` (ocorrência específica
 * numa data) para cada horário ocupado do template semanal
 * `availability_slots` naquele dia da semana — sem isso não há como
 * rastrear status de comparecimento por data específica, só o template
 * recorrente. Idempotente: seguro chamar toda vez que a Agenda (visão
 * diária) carrega os dados do dia.
 *
 * "Ocupado" agora não é só `patient_id` preenchido (sessão/supervisão
 * individual) — os tipos "em grupo" e "outros" ocupam o horário mesmo sem
 * um paciente único vinculado (item J.23).
 */
export async function ensureAppointmentsForDate(dataISO, dayOfWeek) {
  const { supabase } = require('./supabase');
  const userId = await getUserId();
  const { data: slots, error } = await supabase
    .from('availability_slots')
    .select('*')
    .eq('day_of_week', dayOfWeek)
    .or('patient_id.not.is.null,tipo.in.(sessao_grupo,supervisao_grupo,outros)');
  if (error) throw error;
  for (const slot of slots) {
    await inserirAppointmentSeNaoExiste(userId, slot, dataISO);
  }
}

/**
 * Mesma ideia do `ensureAppointmentsForDate`, mas pra um único slot — usado
 * na visão SEMANAL da Agenda, que (diferente da diária) não pré-cria todos
 * os compromissos do dia ao carregar; cria só o que foi de fato clicado,
 * na hora do clique, e já devolve a linha (com os dados do paciente).
 */
export async function getOrCreateAppointmentForSlot(slot, dataISO) {
  const { supabase } = require('./supabase');
  const userId = await getUserId();
  await inserirAppointmentSeNaoExiste(userId, slot, dataISO);
  const { data, error } = await supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT_COM_PACIENTE)
    .eq('date', dataISO)
    .eq('start_time', slot.start_time)
    .single();
  if (error) throw error;
  const [comParticipantes] = await anexarParticipantesAosAppointments([achatarAppointmentComPaciente(data)]);
  return comParticipantes;
}

/** Compromissos futuros (a partir de hoje, ainda 'agendado') que vieram do
 * mesmo horário recorrente — mesmo paciente, mesmo dia da semana, mesmo
 * horário de início. Usado antes de cancelar/editar "este e todos os
 * futuros" (item 4, v13), pra saber quantos serão afetados e poder avisar
 * antes de confirmar. Só cobre sessão/supervisão individual (que têm
 * patient_id) — evento em grupo/outros não participa da cascata. */
export async function listarCompromissosFuturosDoHorario({ patientId, dayOfWeek, startTime }) {
  if (!patientId) return [];
  const { supabase } = require('./supabase');
  const hojeISO = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('appointments')
    .select('id, date, start_time')
    .eq('patient_id', patientId)
    .eq('start_time', startTime)
    .eq('status', 'agendado')
    .gte('date', hojeISO);
  if (error) throw error;
  return (data || []).filter((a) => {
    const [ano, mes, dia] = a.date.split('-').map(Number);
    return new Date(ano, mes - 1, dia).getDay() === dayOfWeek;
  });
}

/** Cancela em cascata os compromissos futuros do mesmo horário recorrente
 * — chamado junto de deleteAvailabilitySlot ao excluir "este e todos os
 * futuros" (item 4, v13). Retorna quantos foram cancelados. */
export async function cancelarCompromissosFuturosDoHorario({ patientId, dayOfWeek, startTime }) {
  const futuros = await listarCompromissosFuturosDoHorario({ patientId, dayOfWeek, startTime });
  if (futuros.length === 0) return 0;
  const { supabase } = require('./supabase');
  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelado' })
    .in('id', futuros.map((a) => a.id));
  if (error) throw error;
  return futuros.length;
}

/** Atualiza start_time/end_time só desse compromisso específico, sem tocar
 * no horário recorrente em availability_slots — "só este horário" ao
 * editar (item 4, v13). */
export async function atualizarHorarioAppointment(appointmentId, { startTime, endTime }) {
  const { supabase } = require('./supabase');
  const { error } = await supabase
    .from('appointments')
    .update({ start_time: startTime, end_time: endTime })
    .eq('id', appointmentId);
  if (error) throw error;
}

/** Acha o slot do template semanal que originou um compromisso específico
 * (mesmo dia da semana + mesmo horário de início), pra permitir editar o
 * horário recorrente a partir da tela de detalhe do compromisso. */
export async function getAvailabilitySlotByDayAndTime(dayOfWeek, startTime) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('availability_slots')
    .select('*')
    .eq('day_of_week', dayOfWeek)
    .eq('start_time', startTime)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Verifica se existe sessão (com transcrição/relato não vazio) do paciente
 * numa data específica. `sessions.date` é gravado em UTC (`toISOString()`),
 * então a comparação reconstrói a data local de cada sessão em vez de
 * comparar strings diretamente.
 */
export async function temTranscricaoParaData(patientId, dataISO) {
  const sessoes = await getSessions(patientId);
  return sessoes.some((s) => {
    if (!(s.transcript || '').trim()) return false;
    const d = new Date(s.date);
    const dataLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return dataLocal === dataISO;
  });
}

export async function getPatientById(patientId) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase.from('patients').select('*').eq('id', patientId).maybeSingle();
  if (error) throw error;
  return data;
}

// ── Paralisação / retorno da análise (item G.20) ───────
// Alterna a análise entre ativa e parada, guardando cada período (início +
// fim) em vez de só sobrescrever uma data — permite ver o histórico
// completo de paralisações, não só a mais recente.

function hojeISODate() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
}

export async function getHistoricoParalizacoes(patientId) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('patient_paralizacoes')
    .select('*')
    .eq('patient_id', patientId)
    .order('data_inicio', { ascending: false });
  if (error) throw error;
  return data;
}

/** Marca a análise como parada hoje — cria o período em aberto e reflete
 * em `patients.data_paralizacao` (já usado em vários lugares do app como
 * "está parado desde"). */
export async function marcarParalizacao(patientId) {
  const { supabase } = require('./supabase');
  const hoje = hojeISODate();
  const { error: errInsert } = await supabase
    .from('patient_paralizacoes')
    .insert({ patient_id: patientId, data_inicio: hoje });
  if (errInsert) throw errInsert;
  const { error: errUpdate } = await supabase
    .from('patients')
    .update({ data_paralizacao: hoje })
    .eq('id', patientId);
  if (errUpdate) throw errUpdate;
}

/** Fecha o período de paralisação em aberto (data_fim = hoje) e limpa
 * `patients.data_paralizacao`, voltando a análise a ativa. */
export async function marcarRetorno(patientId) {
  const { supabase } = require('./supabase');
  const hoje = hojeISODate();
  const { data: aberto, error: errBusca } = await supabase
    .from('patient_paralizacoes')
    .select('id')
    .eq('patient_id', patientId)
    .is('data_fim', null)
    .order('data_inicio', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (errBusca) throw errBusca;
  if (aberto) {
    const { error: errUpdatePeriodo } = await supabase
      .from('patient_paralizacoes')
      .update({ data_fim: hoje })
      .eq('id', aberto.id);
    if (errUpdatePeriodo) throw errUpdatePeriodo;
  }
  const { error: errUpdatePaciente } = await supabase
    .from('patients')
    .update({ data_paralizacao: null })
    .eq('id', patientId);
  if (errUpdatePaciente) throw errUpdatePaciente;
}

// ===================== FINANCEIRO =====================
//
// A agenda "real" e recorrente do app vive em `availability_slots`
// (template semanal com patient_id vinculado) — é o que a tela Agenda
// de fato usa para exibir quem ocupa cada horário. A tabela `appointments`
// existe no schema mas nenhum fluxo atual grava nela, então o plano
// financeiro é calculado a partir dos slots semanais ocupados + o preço
// de sessão de cada analisante.

export function parsePreco(precoStr) {
  if (!precoStr) return 0;
  const limpo = String(precoStr)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '') // remove separador de milhar
    .replace(',', '.');
  const valor = parseFloat(limpo);
  return Number.isFinite(valor) ? valor : 0;
}

export function formatarMoeda(valor) {
  return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ── COTAÇÃO DE MOEDAS (PTAX/BCB) ────────────────────────
// Cache compartilhado (tabela `cotacoes_cache` no Supabase) da cotação
// oficial mais recente de cada moeda estrangeira, atualizado sob demanda
// (ver src/services/currency.js) e consultado aqui pra converter preços de
// sessão em moeda estrangeira para Reais nos cálculos financeiros.

export async function salvarCotacaoCache(moeda, valorBrl, dataCotacao) {
  const { supabase } = require('./supabase');
  const { error } = await supabase
    .from('cotacoes_cache')
    .upsert({ moeda, valor_brl: valorBrl, data_cotacao: dataCotacao || null, atualizado_em: new Date().toISOString() });
  if (error) throw error;
}

export async function getCotacaoCache(moeda) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase.from('cotacoes_cache').select('*').eq('moeda', moeda).maybeSingle();
  if (error) throw error;
  return data;
}

/** Converte um valor em moeda estrangeira para Reais usando a última cotação
 * conhecida em cache (1:1 se a moeda for BRL ou se ainda não há cotação
 * salva — nesse caso a tela deve chamar atualizarCotacao() antes). */
export async function converterParaBRL(valor, moeda) {
  if (!moeda || moeda === 'BRL') return valor;
  const cache = await getCotacaoCache(moeda);
  const taxa = cache?.valor_brl || 1;
  return valor * taxa;
}

// ── Estatísticas de "Sua atividade" (Meu Perfil) ────────

/** Média do preço de sessão de todos os analisantes que têm preço
 * cadastrado, já convertido pra Reais quando a moeda for estrangeira. */
export async function getPrecoMedioSessao() {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase.from('patients').select('preco_sessao, preco_moeda');
  if (error) throw error;

  const comPreco = (data || [])
    .map((p) => ({ valor: parsePreco(p.preco_sessao), moeda: p.preco_moeda }))
    .filter((p) => p.valor > 0);
  if (comPreco.length === 0) return 0;

  // Busca a cotação de cada moeda estrangeira envolvida UMA vez só (não uma
  // vez por analisante) — antes disparava um round-trip ao Supabase por
  // analisante com preço em moeda estrangeira, em sequência (await dentro
  // de um for), o que sozinho já deixava o Perfil lento pra abrir com uma
  // agenda cheia.
  const moedasEstrangeiras = [...new Set(comPreco.map((p) => p.moeda).filter((m) => m && m !== 'BRL'))];
  const taxas = Object.fromEntries(
    await Promise.all(moedasEstrangeiras.map(async (moeda) => [moeda, await converterParaBRL(1, moeda)]))
  );

  const precosBRL = comPreco.map((p) => (p.moeda && p.moeda !== 'BRL' ? p.valor * (taxas[p.moeda] ?? 1) : p.valor));
  return precosBRL.reduce((soma, v) => soma + v, 0) / precosBRL.length;
}

/** Contagens separadas — um paciente pode contar nas duas ao mesmo tempo
 * (ver migration 0041, `eh_analisante`/`eh_supervisionando` não são exclusivos). */
export async function getContagemAnalisantesESupervisionandos() {
  const { supabase } = require('./supabase');
  const [analisantes, supervisionandos] = await Promise.all([
    supabase.from('patients').select('*', { count: 'exact', head: true }).eq('eh_analisante', true),
    supabase.from('patients').select('*', { count: 'exact', head: true }).eq('eh_supervisionando', true),
  ]);
  if (analisantes.error) throw analisantes.error;
  if (supervisionandos.error) throw supervisionandos.error;
  return { analisantes: analisantes.count || 0, supervisionandos: supervisionandos.count || 0 };
}

/** Sessões (de qualquer analisante) sem transcrição/relato preenchido —
 * mesmo critério já usado em temTranscricaoParaData (nulo ou string vazia
 * conta como "sem relato"). Usa count/head — antes baixava o TEXTO
 * COMPLETO da transcrição de toda sessão já gravada só pra contar quantas
 * estavam vazias, o que sozinho podia ser a maior parte do tempo de
 * carregamento do Perfil numa agenda com muito histórico. */
export async function getContagemSessoesSemRelato() {
  const { supabase } = require('./supabase');
  const { count, error } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .or('transcript.is.null,transcript.eq.');
  if (error) throw error;
  return count || 0;
}

/** Horários recorrentes cadastrados na agenda: quantos estão ocupados
 * (com analisante vinculado) do total configurado. */
export async function getResumoHorariosSemanais() {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase.from('availability_slots').select('patient_id');
  if (error) throw error;
  const total = (data || []).length;
  const ocupados = (data || []).filter((s) => s.patient_id).length;
  return { ocupados, total };
}

export async function getSlotsOcupados() {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('availability_slots')
    .select('*, patients!inner(nome, preco_sessao, preco_moeda, dia_pagamento, data_paralizacao)')
    .not('patient_id', 'is', null)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) throw error;
  // Analisante com análise paralisada não deve contar como ganho previsto em
  // Financeiro/Recebíveis/Fiscal (item 3) — o horário continua existindo,
  // só some do que é "esperado receber" enquanto a paralisação durar.
  return data.filter((row) => !row.patients?.data_paralizacao).map((row) => {
    const { patients, ...resto } = row;
    return {
      ...resto,
      patient_nome: patients?.nome ?? null,
      patient_preco: patients?.preco_sessao ?? null,
      patient_preco_moeda: patients?.preco_moeda ?? null,
      patient_dia_pagamento: patients?.dia_pagamento ?? null,
    };
  });
}

function contarOcorrenciasDiaSemanaNoMes(ano, mesIndex, diaSemana) {
  const diasNoMes = new Date(ano, mesIndex + 1, 0).getDate();
  let total = 0;
  for (let d = 1; d <= diasNoMes; d++) {
    if (new Date(ano, mesIndex, d).getDay() === diaSemana) total++;
  }
  return total;
}

/**
 * Monta o plano financeiro (diário, semanal e mensal) a partir da agenda
 * recorrente de cada analisante e do preço de sessão cadastrado na ficha.
 * `dataRef` define o "hoje"/mês de referência (padrão: data atual).
 */
export async function getPlanoFinanceiro(dataRef = new Date()) {
  const slots = await getSlotsOcupados();
  const diaSemanaHoje = dataRef.getDay();
  const ano = dataRef.getFullYear();
  const mesIndex = dataRef.getMonth();

  // Busca a cotação de cada moeda estrangeira envolvida UMA vez só (não
  // uma vez por horário) — antes rodava um round-trip ao Supabase por slot
  // com preço em moeda estrangeira, em sequência (await dentro do for),
  // somando o tempo de todos. Isso sozinho já deixava Financeiro, Fiscal e
  // Recebíveis lentos pra abrir (os três chamam esta função).
  const moedasEstrangeiras = [...new Set(
    slots.map((s) => s.patient_preco_moeda).filter((m) => m && m !== 'BRL')
  )];
  const taxas = Object.fromEntries(
    await Promise.all(moedasEstrangeiras.map(async (moeda) => [moeda, await converterParaBRL(1, moeda)]))
  );
  const precoEmBRL = (valor, moeda) => (moeda && moeda !== 'BRL' ? valor * (taxas[moeda] ?? 1) : valor);

  let totalDiario = 0;
  let totalSemanal = 0;
  let totalMensal = 0;
  const itensDiario = [];
  const itensSemanal = [];
  const porPaciente = {};

  for (const slot of slots) {
    const preco = precoEmBRL(parsePreco(slot.patient_preco), slot.patient_preco_moeda);

    totalSemanal += preco;
    itensSemanal.push({
      patient_id: slot.patient_id,
      nome: slot.patient_nome,
      day_of_week: slot.day_of_week,
      start_time: slot.start_time,
      end_time: slot.end_time,
      modality: slot.modality,
      preco,
    });

    if (slot.day_of_week === diaSemanaHoje) {
      totalDiario += preco;
      itensDiario.push({
        patient_id: slot.patient_id,
        nome: slot.patient_nome,
        start_time: slot.start_time,
        end_time: slot.end_time,
        modality: slot.modality,
        preco,
      });
    }

    const ocorrencias = contarOcorrenciasDiaSemanaNoMes(ano, mesIndex, slot.day_of_week);
    const subtotalMes = preco * ocorrencias;
    totalMensal += subtotalMes;

    const pid = slot.patient_id;
    if (!porPaciente[pid]) {
      porPaciente[pid] = {
        patient_id: pid,
        nome: slot.patient_nome,
        dia_pagamento: slot.patient_dia_pagamento || null,
        sessoesMes: 0,
        subtotal: 0,
      };
    }
    porPaciente[pid].sessoesMes += ocorrencias;
    porPaciente[pid].subtotal += subtotalMes;
  }

  const itensMensal = Object.values(porPaciente).sort((a, b) => a.nome.localeCompare(b.nome));

  const cronogramaRecebimentos = itensMensal
    .filter((p) => !!p.dia_pagamento)
    .sort((a, b) => a.dia_pagamento - b.dia_pagamento);

  itensDiario.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  itensSemanal.sort((a, b) => {
    if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week;
    return (a.start_time || '').localeCompare(b.start_time || '');
  });

  return {
    diaSemanaHoje,
    totalDiario, itensDiario,
    totalSemanal, itensSemanal,
    totalMensal, itensMensal,
    cronogramaRecebimentos,
  };
}

// ===================== RECEBIMENTOS (Supabase — tabela `pagamentos`) =====
//
// Controla, mês a mês, se o pagamento previsto (dia_pagamento + valor do
// cronograma financeiro) de cada analisante já foi de fato recebido.

async function getStatusPagamentos(ano, mes) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('pagamentos')
    .select('*')
    .eq('ano', ano)
    .eq('mes', mes);
  if (error) throw error;
  const mapa = {};
  data.forEach((r) => { mapa[r.patient_id] = r; });
  return mapa;
}

// `pagamentos` não tem mais uma constraint única incondicional em
// (patient_id, ano, mes) desde a migration 0017 — agora é um índice único
// PARCIAL (só quando appointment_id is null, pra não colidir com as linhas
// de pagamento por sessão). `.upsert(..., {onConflict: '...'})` do
// supabase-js gera um ON CONFLICT sem cláusula WHERE, que não bate com
// índice parcial nenhum — por isso resolvemos manualmente aqui: busca a
// linha mensal existente (appointment_id is null) e decide update/insert.
async function upsertPagamentoMensal(patientId, ano, mes, campos) {
  const { supabase } = require('./supabase');
  const { data: existente, error: errBusca } = await supabase
    .from('pagamentos')
    .select('id')
    .eq('patient_id', patientId).eq('ano', ano).eq('mes', mes)
    .is('appointment_id', null)
    .maybeSingle();
  if (errBusca) throw errBusca;

  const { error } = existente
    ? await supabase.from('pagamentos').update(campos).eq('id', existente.id)
    : await supabase.from('pagamentos').insert({ patient_id: patientId, ano, mes, ...campos });
  if (error) throw error;
}

export async function marcarPagamentoRecebido(patientId, ano, mes, valor) {
  await upsertPagamentoMensal(patientId, ano, mes, {
    recebido: true, data_recebimento: new Date().toISOString(), valor: valor || null,
  });
}

export async function desmarcarPagamentoRecebido(patientId, ano, mes) {
  await upsertPagamentoMensal(patientId, ano, mes, {
    recebido: false, data_recebimento: null,
  });
}

/** Histórico completo de pagamentos de um único paciente — usado no
 * relatório financeiro por analisante. */
export async function getPagamentosPorPaciente(patientId) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('pagamentos')
    .select('*')
    .eq('patient_id', patientId)
    .order('ano', { ascending: false })
    .order('mes', { ascending: false });
  if (error) throw error;
  return data;
}

/** Soma dos pagamentos por sessão (appointment_id preenchido) já
 * confirmados de um paciente num mês — usado por Cobrança, pelo
 * cronograma de Recebimentos e pelo catch-up de envio fiscal semanal.
 * `mes` é 0-11 (mesma convenção do restante da tabela `pagamentos`). */
export async function getPagamentosSessaoDoMes(patientId, ano, mes) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('pagamentos')
    .select('valor')
    .eq('patient_id', patientId)
    .eq('ano', ano)
    .eq('mes', mes)
    .not('appointment_id', 'is', null);
  if (error) throw error;
  return {
    valor: data.reduce((soma, r) => soma + (r.valor || 0), 0),
    sessoes: data.length,
  };
}

/** Soma dos pagamentos por sessão de um paciente num intervalo de datas
 * (inclusive), pela data do compromisso vinculado — usado no catch-up de
 * envio fiscal semanal, que agrega só a semana, não o mês inteiro. */
export async function getPagamentosSessaoPorPeriodo(patientId, inicioISO, fimISO) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('pagamentos')
    .select('valor, appointments!inner(date)')
    .eq('patient_id', patientId)
    .not('appointment_id', 'is', null)
    .gte('appointments.date', inicioISO)
    .lte('appointments.date', fimISO);
  if (error) throw error;
  return data.reduce((soma, r) => soma + (r.valor || 0), 0);
}

/**
 * Junta o cronograma financeiro (dia de pagamento + valor previsto no mês)
 * com o status de recebimento e os contatos do analisante (telefone/email),
 * pronto para a tela de Recebimento (calendário + envio de lembrete).
 * `mesIndex` é 0-11. Analisantes de cobrança "mensal" seguem o cronograma
 * de sempre; analisantes "por sessão" (sem dia_pagamento) entram à parte,
 * com o total já confirmado no mês via pagamentos por sessão.
 */
export async function getRecebimentosDoMes(ano, mesIndex) {
  const { supabase } = require('./supabase');
  // Independentes entre si — rodar em sequência somava o tempo das duas.
  const [plano, statusMap] = await Promise.all([
    getPlanoFinanceiro(new Date(ano, mesIndex, 1)),
    getStatusPagamentos(ano, mesIndex),
  ]);

  const patientIds = plano.cronogramaRecebimentos.map((r) => r.patient_id);
  const contatos = {};
  if (patientIds.length > 0) {
    const { data: rows, error } = await supabase
      .from('patients')
      .select('id, telefone, email, cpf, tipo_emissao_fiscal, fiscal_frequencia_automatica, tipo_cobranca, valor_mensal_fixo')
      .in('id', patientIds);
    if (error) throw error;
    rows.forEach((r) => { contatos[r.id] = r; });
  }

  const recebimentosMensal = plano.cronogramaRecebimentos.map((item) => {
    const status = statusMap[item.patient_id];
    const contato = contatos[item.patient_id] || {};
    const ehMensalFixo = contato.tipo_cobranca === 'mensal_fixo';
    return {
      patient_id: item.patient_id,
      nome: item.nome,
      tipo_cobranca: ehMensalFixo ? 'mensal_fixo' : 'mensal',
      tipo_emissao_fiscal: contato.tipo_emissao_fiscal || 'recibo',
      fiscal_frequencia_automatica: contato.fiscal_frequencia_automatica || null,
      dia_pagamento: item.dia_pagamento,
      valorPrevisto: ehMensalFixo ? Number(contato.valor_mensal_fixo) || 0 : item.subtotal,
      telefone: contato.telefone || null,
      email: contato.email || null,
      cpf: contato.cpf || null,
      recebido: !!(status && status.recebido),
      data_recebimento: status?.data_recebimento || null,
    };
  });

  const { data: porSessaoPacientes, error: errPS } = await supabase
    .from('patients')
    .select('id, nome, telefone, email, cpf, tipo_emissao_fiscal, fiscal_frequencia_automatica')
    .eq('tipo_cobranca', 'por_sessao');
  if (errPS) throw errPS;

  // Uma consulta por analisante de cobrança "por sessão" — antes rodava em
  // sequência (um await por vez dentro de um for), somando o tempo de
  // todas; em paralelo o tempo total vira o da mais lenta, não a soma. Era
  // a principal causa da demora pra abrir Recebíveis com vários
  // analisantes nessa modalidade.
  const recebimentosSessao = await Promise.all(
    (porSessaoPacientes || []).map(async (p) => {
      const { valor, sessoes } = await getPagamentosSessaoDoMes(p.id, ano, mesIndex);
      return {
        patient_id: p.id,
        nome: p.nome,
        tipo_cobranca: 'por_sessao',
        tipo_emissao_fiscal: p.tipo_emissao_fiscal || 'recibo',
        fiscal_frequencia_automatica: p.fiscal_frequencia_automatica || null,
        dia_pagamento: null,
        valorPrevisto: valor,
        sessoesPagas: sessoes,
        telefone: p.telefone || null,
        email: p.email || null,
        cpf: p.cpf || null,
        recebido: valor > 0,
        data_recebimento: null,
      };
    })
  );

  return [...recebimentosMensal, ...recebimentosSessao].sort((a, b) => a.nome.localeCompare(b.nome));
}

/** Só a parte de cobrança mensal/mensal-fixo de `getRecebimentosDoMes` — sem
 * cobrança "por sessão", que não tem dia de vencimento fixo e não deve
 * contar como pendência em aberto (itens 8 e 9). */
export function filtrarRecebimentosMensais(recebimentos) {
  return (recebimentos || []).filter((r) => r.tipo_cobranca !== 'por_sessao');
}

/** Cor-resumo (vermelho/amarelo/verde) pra um card que mostra o total de
 * recebimentos de UM mês contra o que já foi de fato recebido (itens 8 e 9)
 * — pressupõe que `recebimentos` é do mês atual (o card não faz sentido pra
 * meses passados/futuros). Vermelho: algum item já passou do dia de
 * pagamento sem ser recebido. Amarelo: falta receber algo, mas nenhum
 * atrasado ainda. Verde: tudo que era esperado já foi recebido (ou não
 * havia nada previsto). */
export function calcularStatusGeralRecebimentos(recebimentos) {
  const lista = recebimentos || [];
  if (lista.length === 0) return 'verde';
  const hojeDia = new Date().getDate();
  let temPendente = false;
  let temAtraso = false;
  for (const item of lista) {
    if (item.recebido) continue;
    temPendente = true;
    if (item.dia_pagamento && item.dia_pagamento < hojeDia) temAtraso = true;
  }
  if (temAtraso) return 'vermelho';
  if (temPendente) return 'amarelo';
  return 'verde';
}

// ===================== WHATSAPP BUSINESS (item 13, v13 — opcional) =======
//
// Comprovantes que a Edge Function whatsapp-webhook detectou por OCR e
// deixou 'pendente' — nunca marca pagamento como recebido sozinha, só
// sinaliza aqui pra profissional revisar. patients(nome) já vem junto pra
// não precisar de uma consulta extra por item da lista.
export async function listarComprovantesWhatsappPendentes() {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('whatsapp_comprovantes')
    .select('*, patients(nome)')
    .eq('status', 'pendente')
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return (data || []).map((c) => ({ ...c, patient_nome: c.patients?.nome ?? null }));
}

/** Confirma um comprovante: marca o pagamento mensal do paciente como
 * recebido (mesma função usada em Recebíveis) e fecha o item da fila. */
export async function confirmarComprovanteWhatsapp(comprovanteId, { patientId, ano, mes, valor }) {
  const { supabase } = require('./supabase');
  await marcarPagamentoRecebido(patientId, ano, mes, valor);
  const { error } = await supabase
    .from('whatsapp_comprovantes')
    .update({ status: 'confirmado', revisado_em: new Date().toISOString() })
    .eq('id', comprovanteId);
  if (error) throw error;
}

export async function ignorarComprovanteWhatsapp(comprovanteId) {
  const { supabase } = require('./supabase');
  const { error } = await supabase
    .from('whatsapp_comprovantes')
    .update({ status: 'ignorado', revisado_em: new Date().toISOString() })
    .eq('id', comprovanteId);
  if (error) throw error;
}

// ===================== FISCAL (config por analisante + pagamento por sessão) ====

/** Config de emissão fiscal de um paciente — usada por FiscalScreen,
 * ConfiguracaoFiscalAutomaticaScreen e pelo catch-up automático. */
export async function getConfiguracaoFiscal(patientId) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase
    .from('patients')
    .select('id, nome, email, cpf, tipo_cobranca, tipo_emissao_fiscal, fiscal_frequencia_automatica, fiscal_dia_semana, fiscal_dia_mes, dia_pagamento, fiscal_ultimo_envio_semanal, fiscal_ultimo_envio_mensal')
    .eq('id', patientId)
    .single();
  if (error) throw error;
  return data;
}

/** Update parcial — só grava os campos passados em `campos`, pra não
 * arriscar apagar uma config (ex: cadência) ao mexer só no tipo de
 * emissão, ou vice-versa. */
export async function salvarConfiguracaoFiscal(patientId, campos) {
  const { supabase } = require('./supabase');
  const { error } = await supabase.from('patients').update(campos).eq('id', patientId);
  if (error) throw error;
}

export async function marcarEnvioFiscalAutomatico(patientId, cadencia, dataISO) {
  const { supabase } = require('./supabase');
  const coluna = cadencia === 'semanal' ? 'fiscal_ultimo_envio_semanal' : 'fiscal_ultimo_envio_mensal';
  const { error } = await supabase.from('patients').update({ [coluna]: dataISO }).eq('id', patientId);
  if (error) throw error;
}

/** Confirma o pagamento de uma sessão específica (cobrança "por sessão"),
 * gravando uma linha em `pagamentos` vinculada ao compromisso. */
export async function confirmarPagamentoSessao(appointmentId, patientId, dataISO, valor) {
  const { supabase } = require('./supabase');
  const [ano, mes] = dataISO.split('-').map(Number);
  const { error } = await supabase
    .from('pagamentos')
    .insert({
      appointment_id: appointmentId, patient_id: patientId,
      ano, mes: mes - 1, recebido: true,
      data_recebimento: new Date().toISOString(), valor: valor || null,
    });
  if (error) throw error;
}

// ── PUSH NOTIFICATIONS (Supabase — coluna `profiles.expo_push_token`) ──

export async function salvarPushToken(token) {
  const { supabase } = require('./supabase');
  const userId = await getUserId();
  const { error } = await supabase.from('profiles').update({ expo_push_token: token }).eq('id', userId);
  if (error) throw error;
}

