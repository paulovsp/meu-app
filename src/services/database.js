import * as SQLite from 'expo-sqlite';
import {
  pseudonimizar, reverterPseudonimizacao, segmentarRegistro, montarPromptAnalise,
  chamarGroqEstruturado, validarEvidencia, detectarTransicoes, evidenciasParaManter,
} from './nucleos';
import { carregarRubricaAtiva } from './rubricas';
import { analisarTextoObjetivo } from './perfilObjetivo';
import {
  calcularDensidadePorNucleo, calcularDefesasPorAsa, calcularIndiceRetorno,
  calcularMobilidade, rankearGatilhos, detectarAusencias,
} from './metricas';

const db = SQLite.openDatabaseSync('psicanalise.db');

export function initDatabase() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      nascimento TEXT,
      data_inicio TEXT,
      telefone TEXT,
      email TEXT,
      horario TEXT,
      preco_sessao TEXT,
      preco_moeda TEXT DEFAULT 'BRL',
      modalidade TEXT,
      endereco TEXT,
      contato_emergencia TEXT,
      como_chegou TEXT,
      info_relevantes TEXT,
      dia_pagamento INTEGER,
      consentimento_perfil INTEGER DEFAULT 0,
      consentimento_perfil_em TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      type TEXT,
      online_platform TEXT,
      date TEXT,
      transcript TEXT,
      audio_uri TEXT,
      category TEXT,
      duration_seconds INTEGER,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    );
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      session_id INTEGER,
      type TEXT,
      title TEXT,
      content TEXT,
      file_uri TEXT,
      date TEXT,
      category TEXT,
      author TEXT CHECK(author IN ('analyst', 'analysand', 'alternado')),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE TABLE IF NOT EXISTS transcript_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      turn_index INTEGER NOT NULL,
      speaker TEXT NOT NULL CHECK(speaker IN ('analyst', 'analysand')),
      text TEXT NOT NULL,
      start_time_seconds REAL,
      end_time_seconds REAL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      crp TEXT,
      email TEXT,
      especialidade TEXT,
      created_at TEXT,
      cpf TEXT,
      cidade TEXT,
      contador_nome TEXT,
      contador_email TEXT,
      contador_telefone TEXT
    );
  `);

  // Migrações
  try { db.execSync(`ALTER TABLE patients ADD COLUMN nascimento TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN data_inicio TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN telefone TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN horario TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN preco_sessao TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN modalidade TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN endereco TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN contato_emergencia TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN como_chegou TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN info_relevantes TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN dia_pagamento INTEGER;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN email TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN cpf TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN preco_moeda TEXT DEFAULT 'BRL';`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN consentimento_perfil INTEGER DEFAULT 0;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN consentimento_perfil_em TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE user ADD COLUMN cpf TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE user ADD COLUMN cidade TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE user ADD COLUMN contador_nome TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE user ADD COLUMN contador_email TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE user ADD COLUMN contador_telefone TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE sessions ADD COLUMN audio_uri TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE sessions ADD COLUMN online_platform TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE sessions ADD COLUMN category TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE sessions ADD COLUMN duration_seconds INTEGER;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE records ADD COLUMN category TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE records ADD COLUMN author TEXT;`); } catch (_) {}
  try {
    db.execSync(`INSERT INTO user (nome, crp, email, especialidade, created_at) SELECT nome, crp, email, especialidade, created_at FROM therapist`);
    db.execSync(`DROP TABLE therapist`);
  } catch (_) {}
}

// ── USUÁRIO ────────────────────────────────────────────

export function getUser() {
  return db.getFirstSync('SELECT * FROM user LIMIT 1');
}

export function createUser({ nome, crp, email, especialidade }) {
  const result = db.runSync(
    'INSERT INTO user (nome, crp, email, especialidade, created_at) VALUES (?, ?, ?, ?, ?)',
    [nome, crp || null, email || null, especialidade || null, new Date().toISOString()]
  );
  return result.lastInsertRowId;
}

export function updateUser({
  id, nome, crp, email, especialidade,
  cpf, cidade, contador_nome, contador_email, contador_telefone
}) {
  db.runSync(
    `UPDATE user SET
      nome = ?, crp = ?, email = ?, especialidade = ?,
      cpf = ?, cidade = ?, contador_nome = ?, contador_email = ?, contador_telefone = ?
    WHERE id = ?`,
    [
      nome, crp || null, email || null, especialidade || null,
      cpf || null, cidade || null, contador_nome || null,
      contador_email || null, contador_telefone || null, id
    ]
  );
}

// ── ESTATÍSTICAS DO USUÁRIO ────────────────────────────

export function getUserStats() {
  const totalSessoes = db.getFirstSync('SELECT COUNT(*) as total FROM sessions');
  const totalPacientes = db.getFirstSync('SELECT COUNT(*) as total FROM patients');
  const totalRegistros = db.getFirstSync('SELECT COUNT(*) as total FROM records');
  const sessoesMes = db.getFirstSync(
    `SELECT COUNT(*) as total FROM sessions WHERE date LIKE ?`,
    [`${new Date().toISOString().slice(0, 7)}%`]
  );
  const duracaoTotal = db.getFirstSync(
    'SELECT COALESCE(SUM(duration_seconds), 0) as total FROM sessions'
  );
  const totalTurns = db.getFirstSync(
    'SELECT COUNT(*) as total FROM transcript_turns'
  );

  return {
    totalSessoes: totalSessoes?.total ?? 0,
    totalPacientes: totalPacientes?.total ?? 0,
    totalRegistros: totalRegistros?.total ?? 0,
    sessoesMes: sessoesMes?.total ?? 0,
    duracaoTotalSegundos: duracaoTotal?.total ?? 0,
    totalTurns: totalTurns?.total ?? 0,
  };
}

// ── PACIENTES ──────────────────────────────────────────

export function listarPacientes() {
  return db.getAllSync('SELECT * FROM patients ORDER BY nome ASC');
}

export function inserirPaciente({
  nome, nascimento, data_inicio, telefone, email, cpf,
  horario, preco_sessao, preco_moeda, modalidade, endereco,
  contato_emergencia, como_chegou, info_relevantes, dia_pagamento
}) {
  const result = db.runSync(
    `INSERT INTO patients (
      nome, nascimento, data_inicio, telefone, email, cpf,
      horario, preco_sessao, preco_moeda, modalidade, endereco,
      contato_emergencia, como_chegou, info_relevantes, dia_pagamento
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nome, nascimento || null, data_inicio || null, telefone || null, email || null, cpf || null,
      horario || null, preco_sessao || null, preco_moeda || 'BRL', modalidade || null, endereco || null,
      contato_emergencia || null, como_chegou || null, info_relevantes || null,
      dia_pagamento || null
    ]
  );
  return result.lastInsertRowId;
}

export function editarPaciente({
  id, nome, nascimento, data_inicio, telefone, email, cpf,
  horario, preco_sessao, preco_moeda, modalidade, endereco,
  contato_emergencia, como_chegou, info_relevantes, dia_pagamento
}) {
  db.runSync(
    `UPDATE patients SET
      nome = ?, nascimento = ?, data_inicio = ?, telefone = ?, email = ?, cpf = ?,
      horario = ?, preco_sessao = ?, preco_moeda = ?, modalidade = ?, endereco = ?,
      contato_emergencia = ?, como_chegou = ?, info_relevantes = ?, dia_pagamento = ?
    WHERE id = ?`,
    [
      nome, nascimento || null, data_inicio || null, telefone || null, email || null, cpf || null,
      horario || null, preco_sessao || null, preco_moeda || 'BRL', modalidade || null, endereco || null,
      contato_emergencia || null, como_chegou || null, info_relevantes || null,
      dia_pagamento || null, id
    ]
  );
}

export function deletarPaciente(id) {
  db.runSync('DELETE FROM records WHERE patient_id = ?', [id]);
  db.runSync('DELETE FROM transcript_turns WHERE session_id IN (SELECT id FROM sessions WHERE patient_id = ?)', [id]);
  db.runSync('DELETE FROM sessions WHERE patient_id = ?', [id]);
  db.runSync('DELETE FROM patients WHERE id = ?', [id]);
}

// ── SESSÕES ────────────────────────────────────────────

export function getSessions(patientId) {
  return db.getAllSync(
    'SELECT * FROM sessions WHERE patient_id = ? ORDER BY date DESC',
    [patientId]
  );
}

export function getSessionById(id) {
  return db.getFirstSync('SELECT * FROM sessions WHERE id = ?', [id]);
}

export function getSessionsToday() {
  const hoje = new Date().toISOString().slice(0, 10);
  const result = db.getFirstSync(
    `SELECT COUNT(*) as total FROM sessions WHERE date LIKE ?`,
    [`${hoje}%`]
  );
  return result?.total ?? 0;
}

export function addSession(patientId, type, platform, category) {
  const result = db.runSync(
    'INSERT INTO sessions (patient_id, type, online_platform, date, transcript, audio_uri, category) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [patientId, type || null, platform || null, new Date().toISOString(), '', null, category || null]
  );
  return result.lastInsertRowId;
}

export function updateSession(id, { transcript, audio_uri, category, duration_seconds }) {
  db.runSync(
    'UPDATE sessions SET transcript = ?, audio_uri = ?, category = ?, duration_seconds = ? WHERE id = ?',
    [transcript || '', audio_uri || null, category || null, duration_seconds || null, id]
  );
}

export function deleteSession(id) {
  db.runSync('DELETE FROM transcript_turns WHERE session_id = ?', [id]);
  db.runSync('DELETE FROM records WHERE session_id = ?', [id]);
  db.runSync('DELETE FROM sessions WHERE id = ?', [id]);
}

// ── TRANSCRIPT TURNS ───────────────────────────────────

export function saveTranscriptTurns(sessionId, turns) {
  db.runSync('DELETE FROM transcript_turns WHERE session_id = ?', [sessionId]);

  if (!turns || turns.length === 0) return;

  const stmt = db.prepareSync(
    'INSERT INTO transcript_turns (session_id, turn_index, speaker, text, start_time_seconds, end_time_seconds) VALUES (?, ?, ?, ?, ?, ?)'
  );

  try {
    for (const turn of turns) {
      stmt.executeSync([
        sessionId,
        turn.turn_index,
        turn.speaker,
        turn.text,
        turn.start_time_seconds ?? null,
        turn.end_time_seconds ?? null,
      ]);
    }
  } finally {
    stmt.finalizeSync();
  }
}

export function getTranscriptTurns(sessionId) {
  return db.getAllSync(
    'SELECT * FROM transcript_turns WHERE session_id = ? ORDER BY turn_index ASC',
    [sessionId]
  );
}

export function getTurnCount(sessionId) {
  const result = db.getFirstSync(
    'SELECT COUNT(*) as total FROM transcript_turns WHERE session_id = ?',
    [sessionId]
  );
  return result?.total ?? 0;
}

// ── REGISTROS ──────────────────────────────────────────

export function getRecords(patientId) {
  return db.getAllSync(
    'SELECT * FROM records WHERE patient_id = ? ORDER BY date DESC',
    [patientId]
  );
}

export function getRecordById(id) {
  return db.getFirstSync('SELECT * FROM records WHERE id = ?', [id]);
}

export function addRecord(patientId, type, title, content, fileUri, sessionId, category, author) {
  const authorNorm = normalizarAuthor(author);
  const result = db.runSync(
    'INSERT INTO records (patient_id, session_id, type, title, content, file_uri, date, category, author) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [patientId, sessionId || null, type || null, title || '', content || '', fileUri || null, new Date().toISOString(), category || null, authorNorm]
  );
  return result.lastInsertRowId;
}

export function deleteRecord(id) {
  db.runSync('DELETE FROM records WHERE id = ?', [id]);
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
db.execSync(`
  CREATE TABLE IF NOT EXISTS availability_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_of_week INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    modality TEXT NOT NULL,
    patient_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    modality TEXT NOT NULL,
    status TEXT DEFAULT 'agendado',
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );
`);

try {
  db.execSync(`ALTER TABLE availability_slots ADD COLUMN patient_id INTEGER;`);
} catch (_) {}

// ---------- ANALISANTES (para o seletor da tela de disponibilidade) ----------

export function getPatients() {
  const rows = db.getAllSync('SELECT id, nome FROM patients ORDER BY nome ASC');
  return rows.map((row) => ({ id: row.id, name: row.nome }));
}

export function addPatient(nome) {
  if (!nome || !nome.trim()) return null;

  const id = inserirPaciente({ nome: nome.trim() });
  return { id, name: nome.trim() };
}

// ---------- DISPONIBILIDADE ----------

export function getAvailabilitySlots() {
  return db.getAllSync(
    `SELECT s.*, p.nome as patient_name, p.telefone as patient_telefone,
            p.preco_sessao as patient_preco, p.preco_moeda as patient_preco_moeda
     FROM availability_slots s
     LEFT JOIN patients p ON p.id = s.patient_id
     ORDER BY s.day_of_week, s.start_time;`
  );
}

export function addAvailabilitySlot(day_of_week, start_time, end_time, modality, patient_id) {
  const result = db.runSync(
    `INSERT INTO availability_slots (day_of_week, start_time, end_time, modality, patient_id)
     VALUES (?, ?, ?, ?, ?);`,
    [day_of_week, start_time, end_time, modality, patient_id || null]
  );
  return result.lastInsertRowId;
}

export function updateAvailabilitySlot(id, day_of_week, start_time, end_time, modality, patient_id) {
  db.runSync(
    `UPDATE availability_slots
     SET day_of_week = ?, start_time = ?, end_time = ?, modality = ?, patient_id = ?
     WHERE id = ?;`,
    [day_of_week, start_time, end_time, modality, patient_id || null, id]
  );
}

export function deleteAvailabilitySlot(id) {
  db.runSync(`DELETE FROM availability_slots WHERE id = ?;`, [id]);
}

export function clearAvailabilityByDay(day_of_week) {
  db.runSync(`DELETE FROM availability_slots WHERE day_of_week = ?;`, [day_of_week]);
}

export function clearAllAvailability() {
  db.execSync(`DELETE FROM availability_slots;`);
}

export function getAvailabilitySlotsByPatient(patientId) {
  return db.getAllSync(
    `SELECT * FROM availability_slots WHERE patient_id = ? ORDER BY day_of_week, start_time;`,
    [patientId]
  );
}

export function deleteAvailabilitySlotsByPatient(patientId) {
  db.runSync(`DELETE FROM availability_slots WHERE patient_id = ?;`, [patientId]);
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
export function verificarConflitoSlot({ id, day_of_week, start_time, end_time, modality }) {
  const modalidadeNormalizada = modality === 'hibrido' ? 'ambos' : (modality || 'ambos');

  const doDia = db
    .getAllSync('SELECT * FROM availability_slots WHERE day_of_week = ?', [day_of_week])
    .filter((slot) => !id || slot.id !== id);

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
export function aplicarSlot({
  id, day_of_week, start_time, end_time, modality, patient_id, livresParaRemover = []
}) {
  livresParaRemover.forEach((slot) => {
    db.runSync('DELETE FROM availability_slots WHERE id = ?', [slot.id]);
  });

  let novoId = id;
  if (id) {
    updateAvailabilitySlot(id, day_of_week, start_time, end_time, modality, patient_id);
  } else {
    novoId = addAvailabilitySlot(day_of_week, start_time, end_time, modality, patient_id);
  }

  return novoId;
}

/**
 * Versão "tudo em um" (confere e já aplica, sem passo de confirmação) —
 * usada em fluxos de lote, como ao salvar os vários horários de um
 * analisante de uma vez no formulário de cadastro.
 */
export function resolverConflitoEAdicionarSlot({
  id, day_of_week, start_time, end_time, modality, patient_id
}) {
  const { ocupado, livres, modalidadeNormalizada } = verificarConflitoSlot({
    id, day_of_week, start_time, end_time, modality
  });

  if (ocupado) {
    return { success: false, conflito: ocupado };
  }

  const novoId = aplicarSlot({
    id, day_of_week, start_time, end_time,
    modality: modalidadeNormalizada, patient_id,
    livresParaRemover: livres,
  });

  return { success: true, id: novoId, removidos: livres.length };
}

// ---------- COMPROMISSOS (AGENDA) ----------

export function getAppointmentsByDateRange(startDate, endDate) {
  return db.getAllSync(
    `SELECT a.*, p.nome as patient_nome, p.telefone as patient_telefone,
            p.nascimento as patient_nascimento, p.data_inicio as patient_data_inicio,
            p.preco_sessao as patient_preco, p.preco_moeda as patient_preco_moeda
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     WHERE a.date BETWEEN ? AND ?
     ORDER BY a.date, a.start_time;`,
    [startDate, endDate]
  );
}

export function getAppointmentsByDate(date) {
  return db.getAllSync(
    `SELECT a.*, p.nome as patient_nome, p.telefone as patient_telefone,
            p.nascimento as patient_nascimento, p.data_inicio as patient_data_inicio,
            p.preco_sessao as patient_preco, p.preco_moeda as patient_preco_moeda
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     WHERE a.date = ?
     ORDER BY a.start_time;`,
    [date]
  );
}

export function getPatientById(patientId) {
  const row = db.getFirstSync('SELECT * FROM patients WHERE id = ?', [patientId]);
  return row || null;
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
// Cache local da cotação oficial mais recente de cada moeda estrangeira,
// atualizado sob demanda (ver src/services/currency.js) e consultado aqui
// de forma síncrona para converter preços de sessão em moeda estrangeira
// para Reais nos cálculos financeiros.

db.execSync(`
  CREATE TABLE IF NOT EXISTS cotacoes_cache (
    moeda TEXT PRIMARY KEY,
    valor_brl REAL NOT NULL,
    data_cotacao TEXT,
    atualizado_em TEXT
  );
`);

export function salvarCotacaoCache(moeda, valorBrl, dataCotacao) {
  db.runSync(
    `INSERT INTO cotacoes_cache (moeda, valor_brl, data_cotacao, atualizado_em)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(moeda) DO UPDATE SET
       valor_brl = excluded.valor_brl, data_cotacao = excluded.data_cotacao, atualizado_em = excluded.atualizado_em`,
    [moeda, valorBrl, dataCotacao || null, new Date().toISOString()]
  );
}

export function getCotacaoCache(moeda) {
  return db.getFirstSync('SELECT * FROM cotacoes_cache WHERE moeda = ?', [moeda]);
}

/** Converte um valor em moeda estrangeira para Reais usando a última cotação
 * conhecida em cache (1:1 se a moeda for BRL ou se ainda não há cotação
 * salva — nesse caso a tela deve chamar atualizarCotacao() antes). */
export function converterParaBRL(valor, moeda) {
  if (!moeda || moeda === 'BRL') return valor;
  const cache = getCotacaoCache(moeda);
  const taxa = cache?.valor_brl || 1;
  return valor * taxa;
}

export function getSlotsOcupados() {
  return db.getAllSync(
    `SELECT s.*, p.nome as patient_nome, p.preco_sessao as patient_preco,
            p.preco_moeda as patient_preco_moeda,
            p.dia_pagamento as patient_dia_pagamento
     FROM availability_slots s
     JOIN patients p ON p.id = s.patient_id
     WHERE s.patient_id IS NOT NULL
     ORDER BY s.day_of_week, s.start_time;`
  );
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
export function getPlanoFinanceiro(dataRef = new Date()) {
  const slots = getSlotsOcupados();
  const diaSemanaHoje = dataRef.getDay();
  const ano = dataRef.getFullYear();
  const mesIndex = dataRef.getMonth();

  let totalDiario = 0;
  let totalSemanal = 0;
  let totalMensal = 0;
  const itensDiario = [];
  const itensSemanal = [];
  const porPaciente = {};

  for (const slot of slots) {
    const preco = converterParaBRL(parsePreco(slot.patient_preco), slot.patient_preco_moeda);

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

// ===================== RECEBIMENTOS =====================
//
// Controla, mês a mês, se o pagamento previsto (dia_pagamento + valor do
// cronograma financeiro) de cada analisante já foi de fato recebido.

db.execSync(`
  CREATE TABLE IF NOT EXISTS pagamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    ano INTEGER NOT NULL,
    mes INTEGER NOT NULL,
    recebido INTEGER NOT NULL DEFAULT 0,
    data_recebimento TEXT,
    valor REAL,
    UNIQUE(patient_id, ano, mes),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );
`);

function getStatusPagamentos(ano, mes) {
  const rows = db.getAllSync(
    'SELECT * FROM pagamentos WHERE ano = ? AND mes = ?',
    [ano, mes]
  );
  const mapa = {};
  rows.forEach((r) => { mapa[r.patient_id] = r; });
  return mapa;
}

export function marcarPagamentoRecebido(patientId, ano, mes, valor) {
  db.runSync(
    `INSERT INTO pagamentos (patient_id, ano, mes, recebido, data_recebimento, valor)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(patient_id, ano, mes) DO UPDATE SET
       recebido = 1, data_recebimento = excluded.data_recebimento, valor = excluded.valor`,
    [patientId, ano, mes, new Date().toISOString(), valor || null]
  );
}

export function desmarcarPagamentoRecebido(patientId, ano, mes) {
  db.runSync(
    `INSERT INTO pagamentos (patient_id, ano, mes, recebido, data_recebimento, valor)
     VALUES (?, ?, ?, 0, NULL, NULL)
     ON CONFLICT(patient_id, ano, mes) DO UPDATE SET
       recebido = 0, data_recebimento = NULL`,
    [patientId, ano, mes]
  );
}

/**
 * Junta o cronograma financeiro (dia de pagamento + valor previsto no mês)
 * com o status de recebimento e os contatos do analisante (telefone/email),
 * pronto para a tela de Recebimento (calendário + envio de lembrete).
 * `mesIndex` é 0-11.
 */
export function getRecebimentosDoMes(ano, mesIndex) {
  const plano = getPlanoFinanceiro(new Date(ano, mesIndex, 1));
  const statusMap = getStatusPagamentos(ano, mesIndex);

  const patientIds = plano.cronogramaRecebimentos.map((r) => r.patient_id);
  const contatos = {};
  if (patientIds.length > 0) {
    const placeholders = patientIds.map(() => '?').join(',');
    const rows = db.getAllSync(
      `SELECT id, telefone, email FROM patients WHERE id IN (${placeholders})`,
      patientIds
    );
    rows.forEach((r) => { contatos[r.id] = r; });
  }

  return plano.cronogramaRecebimentos.map((item) => {
    const status = statusMap[item.patient_id];
    const contato = contatos[item.patient_id] || {};
    return {
      patient_id: item.patient_id,
      nome: item.nome,
      dia_pagamento: item.dia_pagamento,
      valorPrevisto: item.subtotal,
      telefone: contato.telefone || null,
      email: contato.email || null,
      recebido: !!(status && status.recebido),
      data_recebimento: status?.data_recebimento || null,
    };
  });
}

// ===================== PERFIL PSICOSSOMÁTICO =====================
//
// Duas funções na ficha do analisante: Objetivo (sono/alimentação/movimento/
// medicina, agrupados a partir de registros e transcrições) e Subjetivo
// (Perfil por Núcleos Psíquicos — instrumento de apoio à hipótese
// diagnóstica baseado em modelo teórico próprio; NUNCA um diagnóstico).
// A rubrica clínica mora fora do código (rubricas_config, semeada a partir
// de config/nucleos/rubricas.v1.json) para poder ser editada sem rebuild.

db.execSync(`
  CREATE TABLE IF NOT EXISTS rubricas_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    versao TEXT NOT NULL,
    conteudo TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    ativa INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS nucleos_evidencias (
    id TEXT PRIMARY KEY,
    patient_id INTEGER NOT NULL,
    registro_id INTEGER,
    origem_tipo TEXT NOT NULL,
    tipo_registro TEXT,
    data_sessao TEXT,
    trecho_literal TEXT NOT NULL,
    posicao_inicio INTEGER,
    posicao_fim INTEGER,
    nucleo TEXT NOT NULL,
    indicador TEXT,
    via TEXT,
    intensidade INTEGER,
    confianca REAL,
    justificativa TEXT,
    diferenciais_considerados TEXT,
    fonte TEXT NOT NULL DEFAULT 'ia',
    status_validacao TEXT NOT NULL DEFAULT 'pendente',
    validado_por TEXT,
    validado_em TEXT,
    rubrica_versao TEXT,
    criado_em TEXT NOT NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );

  CREATE TABLE IF NOT EXISTS nucleos_transicoes (
    id TEXT PRIMARY KEY,
    patient_id INTEGER NOT NULL,
    registro_id INTEGER,
    de_nucleo TEXT,
    para_nucleo TEXT,
    evidencia_origem_id TEXT,
    evidencia_destino_id TEXT,
    gatilho_trecho TEXT,
    gatilho_tipo TEXT,
    asa_mediadora TEXT,
    diagonal_direta INTEGER DEFAULT 0,
    status_validacao TEXT DEFAULT 'pendente',
    criado_em TEXT NOT NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );

  CREATE TABLE IF NOT EXISTS nucleos_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    criado_em TEXT NOT NULL,
    sessoes_incluidas INTEGER,
    metricas TEXT NOT NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );

  CREATE TABLE IF NOT EXISTS nucleos_perguntas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    pergunta TEXT NOT NULL,
    opcoes TEXT,
    contexto_registro_id INTEGER,
    tipo TEXT,
    status TEXT DEFAULT 'pendente',
    resposta TEXT,
    evidencia_gerada_id TEXT,
    criado_em TEXT NOT NULL,
    respondido_em TEXT,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );

  CREATE TABLE IF NOT EXISTS nucleos_eventos_linha_tempo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    tipo TEXT,
    descricao TEXT,
    criado_em TEXT NOT NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );

  CREATE TABLE IF NOT EXISTS objetivo_evidencias (
    id TEXT PRIMARY KEY,
    patient_id INTEGER NOT NULL,
    registro_id INTEGER,
    origem_tipo TEXT NOT NULL,
    tipo_registro TEXT,
    categoria TEXT NOT NULL,
    trecho_literal TEXT NOT NULL,
    data_registro TEXT,
    status_validacao TEXT NOT NULL DEFAULT 'pendente',
    criado_em TEXT NOT NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );
`);

// ── RUBRICAS (config clínica editável sem rebuild) ─────
export function getRubricaConfigAtiva() {
  return db.getFirstSync('SELECT * FROM rubricas_config WHERE ativa = 1 ORDER BY id DESC LIMIT 1');
}

export function salvarRubricaConfig(versao, conteudoJson) {
  db.runSync('UPDATE rubricas_config SET ativa = 0 WHERE ativa = 1');
  db.runSync(
    'INSERT INTO rubricas_config (versao, conteudo, atualizado_em, ativa) VALUES (?, ?, ?, 1)',
    [versao, conteudoJson, new Date().toISOString()]
  );
}

// ── CONSENTIMENTO (Perfil Psicossomático) ──────────────
export function getConsentimentoPerfil(patientId) {
  const row = db.getFirstSync(
    'SELECT consentimento_perfil, consentimento_perfil_em FROM patients WHERE id = ?',
    [patientId]
  );
  return { concedido: !!row?.consentimento_perfil, em: row?.consentimento_perfil_em || null };
}

export function setConsentimentoPerfil(patientId, concedido) {
  db.runSync(
    'UPDATE patients SET consentimento_perfil = ?, consentimento_perfil_em = ? WHERE id = ?',
    [concedido ? 1 : 0, concedido ? new Date().toISOString() : null, patientId]
  );
}

function gerarId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// ── EVIDÊNCIAS · NÚCLEOS PSÍQUICOS ─────────────────────
export function getEvidenciasNucleos(patientId, { apenasValidadas = false } = {}) {
  const sql = apenasValidadas
    ? 'SELECT * FROM nucleos_evidencias WHERE patient_id = ? AND status_validacao = ? ORDER BY data_sessao, posicao_inicio'
    : 'SELECT * FROM nucleos_evidencias WHERE patient_id = ? ORDER BY data_sessao, posicao_inicio';
  const params = apenasValidadas ? [patientId, 'confirmada'] : [patientId];
  return db.getAllSync(sql, params);
}

export function getEvidenciasNucleosDoRegistro(registroId, origemTipo) {
  return db.getAllSync(
    'SELECT * FROM nucleos_evidencias WHERE registro_id = ? AND origem_tipo = ? ORDER BY posicao_inicio',
    [registroId, origemTipo]
  );
}

function inserirEvidenciaNucleo(patientId, registroId, origemTipo, tipoRegistro, dataSessao, rubricaVersao, evidencia) {
  const id = gerarId();
  db.runSync(
    `INSERT INTO nucleos_evidencias (
      id, patient_id, registro_id, origem_tipo, tipo_registro, data_sessao,
      trecho_literal, posicao_inicio, posicao_fim, nucleo, indicador, via,
      intensidade, confianca, justificativa, diferenciais_considerados,
      fonte, status_validacao, rubrica_versao, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ia', 'pendente', ?, ?)`,
    [
      id, patientId, registroId, origemTipo, tipoRegistro, dataSessao || null,
      evidencia.trecho_literal, evidencia.posicao_inicio, evidencia.posicao_fim,
      evidencia.nucleo, evidencia.indicador, evidencia.via,
      evidencia.intensidade, evidencia.confianca, evidencia.justificativa,
      evidencia.diferenciais_considerados, rubricaVersao, new Date().toISOString(),
    ]
  );
  return { ...evidencia, id, patient_id: patientId, registro_id: registroId };
}

export function validarStatusEvidenciaNucleo(id, statusValidacao, validadoPor = 'terapeuta') {
  db.runSync(
    'UPDATE nucleos_evidencias SET status_validacao = ?, validado_por = ?, validado_em = ? WHERE id = ?',
    [statusValidacao, validadoPor, new Date().toISOString(), id]
  );
}

export function reclassificarEvidenciaNucleo(id, novoNucleo, novoIndicador) {
  db.runSync(
    `UPDATE nucleos_evidencias SET
      nucleo = ?, indicador = ?, status_validacao = 'reclassificada',
      validado_por = 'terapeuta', validado_em = ? WHERE id = ?`,
    [novoNucleo, novoIndicador || null, new Date().toISOString(), id]
  );
}

// ── TRANSIÇÕES · NÚCLEOS PSÍQUICOS ─────────────────────
export function getTransicoesNucleos(patientId) {
  return db.getAllSync(
    'SELECT * FROM nucleos_transicoes WHERE patient_id = ? ORDER BY criado_em',
    [patientId]
  );
}

function inserirTransicaoNucleo(patientId, registroId, transicao) {
  const id = gerarId();
  db.runSync(
    `INSERT INTO nucleos_transicoes (
      id, patient_id, registro_id, de_nucleo, para_nucleo,
      evidencia_origem_id, evidencia_destino_id, gatilho_trecho, gatilho_tipo,
      asa_mediadora, diagonal_direta, status_validacao, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?)`,
    [
      id, patientId, registroId, transicao.de_nucleo, transicao.para_nucleo,
      transicao.evidencia_origem_id, transicao.evidencia_destino_id,
      transicao.gatilho_trecho, transicao.gatilho_tipo, transicao.asa_mediadora,
      transicao.diagonal_direta ? 1 : 0, new Date().toISOString(),
    ]
  );
}

/**
 * Roda o motor de análise dos núcleos psíquicos sobre um registro (sessão
 * ou registro escrito) de um analisante que já deu consentimento. Idempotente:
 * evidências já validadas pelo terapeuta são preservadas; só as pendentes de
 * uma análise anterior são substituídas.
 */
export async function analisarRegistroNucleos(paciente, registro) {
  const consentimento = getConsentimentoPerfil(paciente.id);
  if (!consentimento.concedido) {
    throw new Error('Este analisante ainda não deu consentimento para o Perfil Psicossomático.');
  }

  const conteudoOriginal = registro.conteudo || '';
  const rubrica = carregarRubricaAtiva();
  const conteudoPseudonimizado = pseudonimizar(conteudoOriginal, paciente);
  const unidades = segmentarRegistro({ tipoRegistro: registro.tipoRegistro, conteudo: conteudoPseudonimizado });

  if (unidades.length === 0) {
    return { evidencias: [], transicoes: [] };
  }

  const { promptSistema, promptUsuario } = montarPromptAnalise(unidades, rubrica);
  const resposta = await chamarGroqEstruturado(promptSistema, promptUsuario);
  const evidenciasBrutas = Array.isArray(resposta?.evidencias) ? resposta.evidencias : [];

  const evidenciasValidadas = evidenciasBrutas
    .map((bruta) => {
      const trechoRevertido = reverterPseudonimizacao(bruta.trecho_literal || '', paciente);
      return validarEvidencia({ ...bruta, trecho_literal: trechoRevertido }, conteudoOriginal);
    })
    .filter(Boolean);

  // Idempotência: mantém evidências já validadas, remove só as pendentes.
  const existentes = getEvidenciasNucleosDoRegistro(registro.id, registro.origemTipo);
  const mantidas = evidenciasParaManter(existentes);
  db.runSync(
    "DELETE FROM nucleos_evidencias WHERE registro_id = ? AND origem_tipo = ? AND status_validacao = 'pendente'",
    [registro.id, registro.origemTipo]
  );

  const inseridas = evidenciasValidadas.map((ev) =>
    inserirEvidenciaNucleo(
      paciente.id, registro.id, registro.origemTipo, registro.tipoRegistro,
      registro.data || null, rubrica.versao, ev
    )
  );

  // Transições: sequência ordenada por posição, combinando evidências
  // mantidas (já validadas) com as recém-inseridas deste registro.
  const todasDoRegistro = [...mantidas, ...inseridas].sort(
    (a, b) => (a.posicao_inicio ?? 0) - (b.posicao_inicio ?? 0)
  );
  const transicoes = detectarTransicoes(todasDoRegistro, rubrica);

  db.runSync(
    "DELETE FROM nucleos_transicoes WHERE registro_id = ? AND status_validacao = 'pendente'",
    [registro.id]
  );
  transicoes.forEach((t) => inserirTransicaoNucleo(paciente.id, registro.id, t));

  return { evidencias: inseridas, transicoes };
}

// ── EVIDÊNCIAS · PERFIL OBJETIVO (sono/alimentação/movimento/medicina) ─
export function getEvidenciasObjetivo(patientId) {
  return db.getAllSync(
    'SELECT * FROM objetivo_evidencias WHERE patient_id = ? ORDER BY categoria, data_registro',
    [patientId]
  );
}

export function getEvidenciasObjetivoDoRegistro(registroId, origemTipo) {
  return db.getAllSync(
    'SELECT * FROM objetivo_evidencias WHERE registro_id = ? AND origem_tipo = ?',
    [registroId, origemTipo]
  );
}

function inserirEvidenciaObjetivo(patientId, registroId, origemTipo, tipoRegistro, dataRegistro, item) {
  const id = gerarId();
  db.runSync(
    `INSERT INTO objetivo_evidencias (
      id, patient_id, registro_id, origem_tipo, tipo_registro, categoria,
      trecho_literal, data_registro, status_validacao, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?)`,
    [
      id, patientId, registroId, origemTipo, tipoRegistro, item.categoria,
      item.trecho_literal, dataRegistro || null, new Date().toISOString(),
    ]
  );
  return { ...item, id, patient_id: patientId, registro_id: registroId };
}

export function validarStatusEvidenciaObjetivo(id, statusValidacao) {
  db.runSync('UPDATE objetivo_evidencias SET status_validacao = ? WHERE id = ?', [statusValidacao, id]);
}

/**
 * Roda o motor do Perfil Objetivo sobre um registro. Idempotente: só
 * processa registros que ainda não têm nenhum item gravado.
 */
export async function analisarRegistroObjetivo(paciente, registro) {
  const consentimento = getConsentimentoPerfil(paciente.id);
  if (!consentimento.concedido) {
    throw new Error('Este analisante ainda não deu consentimento para o Perfil Psicossomático.');
  }

  const conteudoOriginal = registro.conteudo || '';
  if (!conteudoOriginal.trim()) return [];

  const itensValidados = await analisarTextoObjetivo(conteudoOriginal, paciente);

  return itensValidados.map((item) =>
    inserirEvidenciaObjetivo(
      paciente.id, registro.id, registro.origemTipo, registro.tipoRegistro,
      registro.data || null, item
    )
  );
}

/**
 * Lista os registros (sessões + registros escritos) de um analisante ainda
 * não processados por um dos motores (núcleos ou objetivo), no formato
 * comum usado pelos orquestradores acima ({ id, origemTipo, tipoRegistro,
 * conteudo, data }).
 */
export function getRegistrosNaoAnalisados(patientId, motor) {
  const sessoes = getSessions(patientId).filter((s) => (s.transcript || '').trim());
  const registros = getRecords(patientId).filter((r) => (r.content || '').trim());

  const jaTemEvidencia = (registroId, origemTipo) => {
    const existentes = motor === 'nucleos'
      ? getEvidenciasNucleosDoRegistro(registroId, origemTipo)
      : getEvidenciasObjetivoDoRegistro(registroId, origemTipo);
    return existentes.length > 0;
  };

  const doSessoes = sessoes
    .filter((s) => !jaTemEvidencia(s.id, 'session'))
    .map((s) => ({
      id: s.id,
      origemTipo: 'session',
      tipoRegistro: 'transcricao',
      conteudo: s.transcript,
      data: s.date,
    }));

  const doRegistros = registros
    .filter((r) => !jaTemEvidencia(r.id, 'record'))
    .map((r) => ({
      id: r.id,
      origemTipo: 'record',
      tipoRegistro: r.type === 'sessao' ? 'anotacao_sessao' : r.type === 'estudo' ? 'estudo_caso' : 'outro',
      conteudo: r.content,
      data: r.date,
    }));

  return [...doSessoes, ...doRegistros];
}

// ── SNAPSHOTS · NÚCLEOS PSÍQUICOS ──────────────────────
export function getSnapshots(patientId) {
  return db.getAllSync(
    'SELECT * FROM nucleos_snapshots WHERE patient_id = ? ORDER BY criado_em',
    [patientId]
  ).map((row) => ({ ...row, metricas: JSON.parse(row.metricas) }));
}

/**
 * Calcula todas as métricas atuais do analisante e grava como um novo
 * snapshot (instantâneo). Nesta fase é sempre manual — o gatilho
 * automático a cada N sessões fica pra depois.
 */
export function criarSnapshot(patientId) {
  const evidencias = getEvidenciasNucleos(patientId, { apenasValidadas: false });
  const transicoes = getTransicoesNucleos(patientId);
  const sessoes = getSessions(patientId);

  const metricas = {
    densidade: calcularDensidadePorNucleo(evidencias),
    asas: calcularDefesasPorAsa(transicoes),
    indiceRetorno: calcularIndiceRetorno(transicoes),
    mobilidade: calcularMobilidade(transicoes.length, sessoes.length),
    gatilhos: rankearGatilhos(transicoes).slice(0, 10),
    totalEvidencias: evidencias.length,
    totalIndizíveis: evidencias.filter((e) => e.nucleo === 'eu_nuclear').length,
  };

  db.runSync(
    'INSERT INTO nucleos_snapshots (patient_id, criado_em, sessoes_incluidas, metricas) VALUES (?, ?, ?, ?)',
    [patientId, new Date().toISOString(), sessoes.length, JSON.stringify(metricas)]
  );

  return metricas;
}

// ── PERGUNTAS DO APP · NÚCLEOS PSÍQUICOS ───────────────
export function getPerguntasPendentes(patientId) {
  return db.getAllSync(
    "SELECT * FROM nucleos_perguntas WHERE patient_id = ? AND status = 'pendente' ORDER BY criado_em DESC",
    [patientId]
  );
}

/**
 * Gera perguntas "por ausência": núcleo sem nenhuma evidência nas K
 * sessões mais recentes. Regra local, sem custo de IA. Evita duplicar
 * pergunta pendente já existente para o mesmo núcleo.
 */
export function gerarPerguntasPorAusencia(patientId, k = 5) {
  const sessoes = getSessions(patientId).slice(0, k);
  const datasRecentes = sessoes.map((s) => s.date);
  if (datasRecentes.length < k) return []; // histórico curto demais pra concluir ausência

  const evidencias = getEvidenciasNucleos(patientId, { apenasValidadas: false });
  const ausencias = detectarAusencias(evidencias, datasRecentes);
  if (ausencias.length === 0) return [];

  const rubrica = carregarRubricaAtiva();
  const jaPendentes = getPerguntasPendentes(patientId);

  const criadas = [];
  ausencias.forEach((nucleo) => {
    const nomeNucleo = rubrica.nucleos[nucleo]?.nome || nucleo;
    const jaExiste = jaPendentes.some((p) => p.tipo === 'ausencia' && p.pergunta.includes(nomeNucleo));
    if (jaExiste) return;

    const pergunta =
      `Não há nenhuma referência ao núcleo ${nomeNucleo} nas últimas ${k} sessões. ` +
      'Isso confere com sua escuta, ou pode ser um ponto cego do registro?';
    const opcoes = JSON.stringify(['Confere com minha escuta', 'Pode ser ponto cego do registro']);

    db.runSync(
      `INSERT INTO nucleos_perguntas (patient_id, pergunta, opcoes, tipo, status, criado_em)
       VALUES (?, ?, ?, 'ausencia', 'pendente', ?)`,
      [patientId, pergunta, opcoes, new Date().toISOString()]
    );
    criadas.push(pergunta);
  });

  return criadas;
}

/**
 * Registra a resposta do terapeuta a uma pergunta do app. Perguntas por
 * ausência não têm um trecho literal associado (não há "citação" — é uma
 * lacuna), então a resposta fica só como anotação, sem gerar uma
 * evidência fabricada (regra: nenhuma marcação sem trecho literal real).
 */
export function responderPergunta(perguntaId, resposta) {
  db.runSync(
    "UPDATE nucleos_perguntas SET resposta = ?, status = 'respondida', respondido_em = ? WHERE id = ?",
    [resposta, new Date().toISOString(), perguntaId]
  );
}

export function descartarPergunta(perguntaId) {
  db.runSync("UPDATE nucleos_perguntas SET status = 'descartada' WHERE id = ?", [perguntaId]);
}