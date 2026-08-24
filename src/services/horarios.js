// ─── Entrada e cálculo de horários (HH:MM) ───────────────────────────────
// Fonte única da digitação de hora no app — antes cada tela tinha sua
// própria `formatarHorario`/`horarioValido` copiada, e todas cortavam o
// texto pela ESQUERDA ("845" virava "84:5", inutilizável). Aqui a leitura é
// pela DIREITA: os dois últimos dígitos são sempre os minutos, então "845"
// vira "8:45" e, ao normalizar, "08:45" — que é como a pessoa realmente
// digita um horário com pressa.

/** Duração padrão de uma sessão, em minutos — usada pra preencher o horário
 * de término sozinho assim que o de início é digitado. */
export const DURACAO_PADRAO_SESSAO_MIN = 50;

/**
 * Máscara aplicada ENQUANTO a pessoa digita (a cada tecla). Os dois últimos
 * dígitos são os minutos; o resto, a hora. Enquanto os dois últimos dígitos
 * ainda não formarem minutos possíveis (ex: "084" a caminho de "0845", ou o
 * estado intermediário de um apagar), devolve só os dígitos crus em vez de
 * montar um "0:84" sem sentido na tela.
 */
export function mascararHorario(texto) {
  const digitos = String(texto ?? '').replace(/\D/g, '').slice(0, 4);
  if (digitos.length <= 2) return digitos;
  const minutos = digitos.slice(-2);
  if (Number(minutos) > 59) return digitos;
  return `${digitos.slice(0, -2)}:${minutos}`;
}

/** Já está no formato final e é um horário real do relógio? */
export function horarioValido(horario) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(horario ?? '');
}

/**
 * Converte o que a pessoa digitou no horário final `HH:MM`, ou null se não
 * der pra interpretar. Aceita as formas que aparecem na prática:
 *   "8"     -> "08:00"   (só a hora)
 *   "10"    -> "10:00"
 *   "845"   -> "08:45"
 *   "8:45"  -> "08:45"
 *   "0845"  -> "08:45"
 *   "84"    -> null      (não existe hora 84, e "8h4" não é uma leitura segura)
 */
export function normalizarHorario(texto) {
  const digitos = String(texto ?? '').replace(/\D/g, '').slice(0, 4);
  if (digitos.length === 0) return null;

  const horas = digitos.length <= 2 ? Number(digitos) : Number(digitos.slice(0, -2));
  const minutos = digitos.length <= 2 ? 0 : Number(digitos.slice(-2));

  if (!Number.isFinite(horas) || !Number.isFinite(minutos)) return null;
  if (horas > 23 || minutos > 59) return null;

  return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;
}

export function horarioParaMinutos(horario) {
  const [hh, mm] = String(horario ?? '').split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

export function minutosParaHorario(totalMinutos) {
  if (!Number.isFinite(totalMinutos)) return null;
  // Um horário que passaria da meia-noite não faz sentido numa agenda de
  // atendimento — trava em 23:59 em vez de dar a volta pro dia seguinte.
  const limitado = Math.min(Math.max(totalMinutos, 0), 23 * 60 + 59);
  const hh = Math.floor(limitado / 60);
  const mm = limitado % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** `"08:00" + 50` -> `"08:50"`. Devolve null se o horário de partida não
 * puder ser interpretado. */
export function somarMinutos(horario, minutos) {
  const base = horarioParaMinutos(normalizarHorario(horario));
  if (base == null) return null;
  return minutosParaHorario(base + minutos);
}

/** Término sugerido a partir do início digitado — o que preenche o campo
 * "Término" sozinho nas telas de horário. */
export function terminoPadrao(horarioInicio) {
  return somarMinutos(horarioInicio, DURACAO_PADRAO_SESSAO_MIN);
}
