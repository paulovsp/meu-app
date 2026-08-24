const {
  mascararHorario, normalizarHorario, horarioValido, horarioParaMinutos,
  minutosParaHorario, somarMinutos, terminoPadrao, DURACAO_PADRAO_SESSAO_MIN,
} = require('../horarios');

describe('mascararHorario (enquanto digita)', () => {
  it('deixa 1 e 2 dígitos crus (ainda pode virar hora ou hora+minuto)', () => {
    expect(mascararHorario('8')).toBe('8');
    expect(mascararHorario('08')).toBe('08');
  });

  it('lê os dois últimos dígitos como minutos — "845" vira "8:45"', () => {
    expect(mascararHorario('845')).toBe('8:45');
  });

  it('formata 4 dígitos como HH:MM', () => {
    expect(mascararHorario('0845')).toBe('08:45');
    expect(mascararHorario('1030')).toBe('10:30');
  });

  it('segura a formatação enquanto os 2 últimos dígitos não são minutos válidos', () => {
    // "084" a caminho de "0845" — sem isso apareceria um "0:84" sem sentido.
    expect(mascararHorario('084')).toBe('084');
  });

  it('ignora o que não for dígito e corta em 4 dígitos', () => {
    expect(mascararHorario('08:45')).toBe('08:45');
    expect(mascararHorario('08453')).toBe('08:45');
  });
});

describe('normalizarHorario (ao sair do campo / salvar)', () => {
  it('completa só a hora com :00', () => {
    expect(normalizarHorario('8')).toBe('08:00');
    expect(normalizarHorario('10')).toBe('10:00');
  });

  it('interpreta 845 como 08:45 (o pedido do usuário)', () => {
    expect(normalizarHorario('845')).toBe('08:45');
    expect(normalizarHorario('8:45')).toBe('08:45');
    expect(normalizarHorario('0845')).toBe('08:45');
  });

  it('recusa hora ou minuto impossíveis', () => {
    expect(normalizarHorario('84')).toBeNull();   // não existe hora 84
    expect(normalizarHorario('2575')).toBeNull(); // hora 25, minuto 75
    expect(normalizarHorario('')).toBeNull();
    expect(normalizarHorario(null)).toBeNull();
  });
});

describe('horarioValido', () => {
  it('aceita só o formato final HH:MM de um relógio real', () => {
    expect(horarioValido('08:45')).toBe(true);
    expect(horarioValido('23:59')).toBe(true);
    expect(horarioValido('8:45')).toBe(false);
    expect(horarioValido('24:00')).toBe(false);
    expect(horarioValido('')).toBe(false);
  });
});

describe('conversões e soma', () => {
  it('converte ida e volta', () => {
    expect(horarioParaMinutos('08:45')).toBe(525);
    expect(minutosParaHorario(525)).toBe('08:45');
  });

  it('soma minutos', () => {
    expect(somarMinutos('08:00', 50)).toBe('08:50');
    expect(somarMinutos('08:45', 50)).toBe('09:35');
  });

  it('soma a partir do que foi digitado sem formatar', () => {
    expect(somarMinutos('845', 50)).toBe('09:35');
  });

  it('trava em 23:59 em vez de virar o dia', () => {
    expect(somarMinutos('23:50', 50)).toBe('23:59');
  });

  it('término padrão é o início + 50 minutos', () => {
    expect(DURACAO_PADRAO_SESSAO_MIN).toBe(50);
    expect(terminoPadrao('08:00')).toBe('08:50');
    expect(terminoPadrao('845')).toBe('09:35');
    expect(terminoPadrao('xx')).toBeNull();
  });
});
