import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('psicanalise.db');

export function initDatabase() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      codinome TEXT,
      nascimento TEXT,
      data_inicio TEXT,
      telefone TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      type TEXT,
      online_platform TEXT,
      date TEXT,
      transcript TEXT,
      audio_uri TEXT,
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
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
  `);

  try { db.execSync(`ALTER TABLE patients ADD COLUMN codinome TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN nascimento TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN data_inicio TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE patients ADD COLUMN telefone TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE sessions ADD COLUMN audio_uri TEXT;`); } catch (_) {}
  try { db.execSync(`ALTER TABLE sessions ADD COLUMN online_platform TEXT;`); } catch (_) {}
}

// ── PACIENTES ──────────────────────────────────────────

export function listarPacientes() {
  return db.getAllSync('SELECT * FROM patients ORDER BY nome ASC');
}

export function inserirPaciente({ nome, codinome, nascimento, data_inicio, telefone }) {
  const result = db.runSync(
    'INSERT INTO patients (nome, codinome, nascimento, data_inicio, telefone) VALUES (?, ?, ?, ?, ?)',
    [nome, codinome || null, nascimento || null, data_inicio || null, telefone || null]
  );
  return result.lastInsertRowId;
}

export function editarPaciente({ id, nome, codinome, nascimento, data_inicio, telefone }) {
  db.runSync(
    'UPDATE patients SET nome = ?, codinome = ?, nascimento = ?, data_inicio = ?, telefone = ? WHERE id = ?',
    [nome, codinome || null, nascimento || null, data_inicio || null, telefone || null, id]
  );
}

export function deletarPaciente(id) {
  db.runSync('DELETE FROM records WHERE patient_id = ?', [id]);
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

// ✅ CORRIGIDO: conta sessões do dia atual
export function getSessionsToday() {
  const hoje = new Date().toISOString().slice(0, 10); // "2026-06-20"
  const result = db.getFirstSync(
    `SELECT COUNT(*) as total FROM sessions WHERE date LIKE ?`,
    [`${hoje}%`]
  );
  return result?.total ?? 0;
}

export function addSession(patientId, type, platform) {
  const result = db.runSync(
    'INSERT INTO sessions (patient_id, type, online_platform, date, transcript, audio_uri) VALUES (?, ?, ?, ?, ?, ?)',
    [patientId, type || null, platform || null, new Date().toISOString(), '', null]
  );
  return result.lastInsertRowId;
}

export function updateSession(id, { transcript, audio_uri }) {
  db.runSync(
    'UPDATE sessions SET transcript = ?, audio_uri = ? WHERE id = ?',
    [transcript || '', audio_uri || null, id]
  );
}

export function deleteSession(id) {
  db.runSync('DELETE FROM records WHERE session_id = ?', [id]);
  db.runSync('DELETE FROM sessions WHERE id = ?', [id]);
}

// ── REGISTROS ──────────────────────────────────────────

export function getRecords(patientId) {
  return db.getAllSync(
    'SELECT * FROM records WHERE patient_id = ? ORDER BY date DESC',
    [patientId]
  );
}

export function addRecord(patientId, type, title, content, fileUri, sessionId) {
  const result = db.runSync(
    'INSERT INTO records (patient_id, session_id, type, title, content, file_uri, date) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [patientId, sessionId || null, type || null, title || '', content || '', fileUri || null, new Date().toISOString()]
  );
  return result.lastInsertRowId;
}

export function deleteRecord(id) {
  db.runSync('DELETE FROM records WHERE id = ?', [id]);
}

// ── BUSCA ──────────────────────────────────────────────

export function searchAll(termo) {
  const like = `%${termo}%`;
  const sessions = db.getAllSync(
    `SELECT s.*, p.nome as patient_nome, p.codinome as patient_codinome
     FROM sessions s
     JOIN patients p ON s.patient_id = p.id
     WHERE s.transcript LIKE ?
     ORDER BY s.date DESC`,
    [like]
  );
  const records = db.getAllSync(
    `SELECT r.*, p.nome as patient_nome, p.codinome as patient_codinome
     FROM records r
     JOIN patients p ON r.patient_id = p.id
     WHERE r.title LIKE ? OR r.content LIKE ?
     ORDER BY r.date DESC`,
    [like, like]
  );
  return { sessions, records };
}

// ── SUBSTITUIÇÃO CODINOME ──────────────────────────────
// ✅ Substitui nome completo E primeiro nome
export function substituirNomePorCodinome(texto, nomeReal, codinome) {
  if (!texto || !nomeReal || !codinome) return texto;

  let resultado = texto;

  // 1. Substitui nome completo (ex: "Constantino Soares")
  const escapedCompleto = nomeReal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  resultado = resultado.replace(new RegExp(escapedCompleto, 'gi'), codinome);

  // 2. Substitui primeiro nome (ex: "Constantino")
  const primeiroNome = nomeReal.trim().split(/\s+/)[0];
  if (primeiroNome && primeiroNome.length >= 3) {
    const escapedPrimeiro = primeiroNome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    resultado = resultado.replace(new RegExp(`\\b${escapedPrimeiro}\\b`, 'gi'), codinome);
  }

  return resultado;
}