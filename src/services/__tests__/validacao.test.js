// Telefone internacional (item 2, v13): garante que o formato brasileiro
// escrito à mão bate a regra pedida (9 extra destacado com espaço, sempre 4
// dígitos após o hífen) e que país estrangeiro delega pro libphonenumber-js
// sem quebrar.
const { formatarTelefone, validarCPF, dataBRParaISO, dataISOParaBR } = require('../validacao');

describe('formatarTelefone (item 2 — telefone internacional)', () => {
  it('celular BR sem DDI: destaca o 9 extra com espaço, 4 dígitos após o hífen', () => {
    expect(formatarTelefone('11999998888')).toBe('(11) 9 9999-8888');
  });

  it('fixo BR sem DDI (8 dígitos locais): sem o 9 extra', () => {
    expect(formatarTelefone('1133334444')).toBe('(11) 3333-4444');
  });

  it('celular BR com +55 explícito', () => {
    expect(formatarTelefone('+5511999998888')).toBe('+55 (11) 9 9999-8888');
  });

  it('formata progressivamente enquanto o DDD ainda não fechou', () => {
    expect(formatarTelefone('1')).toBe('(1');
    expect(formatarTelefone('11')).toBe('(11');
  });

  it('país estrangeiro (+1) delega pro libphonenumber-js sem travar', () => {
    const resultado = formatarTelefone('+12025551234');
    expect(resultado.startsWith('+1')).toBe(true);
    expect(resultado).not.toMatch(/[a-zA-Z]/);
  });

  it('string vazia retorna vazio', () => {
    expect(formatarTelefone('')).toBe('');
    expect(formatarTelefone(null)).toBe('');
  });

  it('nunca inclui letras nem caracteres fora de dígitos/+/espaço/parênteses/hífen', () => {
    const resultado = formatarTelefone('11999998888abc');
    expect(resultado).toMatch(/^[\d+()\- ]*$/);
  });
});

describe('validacao.js — regressão (funções já existentes, não tocadas)', () => {
  it('validarCPF continua funcionando', () => {
    expect(validarCPF('111.111.111-11')).toBe(false);
  });
  it('dataBRParaISO/dataISOParaBR continuam funcionando', () => {
    expect(dataBRParaISO('25/07/2026')).toBe('2026-07-25');
    expect(dataISOParaBR('2026-07-25')).toBe('25/07/2026');
  });
});
