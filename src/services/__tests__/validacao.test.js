// Telefone com caixas separadas (DDI / DDD / número): a detecção automática
// de celular-vs-fixo e nacional-vs-internacional num campo de texto livre
// nunca foi confiável, então a pessoa agora escolhe DDI/DDD explicitamente
// e só o número em si é formatado — sempre 4 dígitos após o hífen, com o
// 9 extra (quando presente) destacado por um espaço.
const {
  formatarNumeroLocalTelefone, parseTelefone, montarTelefone,
  validarCPF, dataBRParaISO, dataISOParaBR,
} = require('../validacao');

describe('formatarNumeroLocalTelefone', () => {
  it('9 dígitos (celular, com o 9 extra): separa o primeiro com espaço', () => {
    expect(formatarNumeroLocalTelefone('999998888')).toBe('9 9999-8888');
  });
  it('8 dígitos (fixo, ou celular sem o 9 extra): só o hífen', () => {
    expect(formatarNumeroLocalTelefone('33334444')).toBe('3333-4444');
  });
  it('menos de 5 dígitos: sem hífen ainda', () => {
    expect(formatarNumeroLocalTelefone('333')).toBe('333');
  });
  it('vazio retorna vazio', () => {
    expect(formatarNumeroLocalTelefone('')).toBe('');
    expect(formatarNumeroLocalTelefone(null)).toBe('');
  });
});

describe('parseTelefone', () => {
  it('sem "+": assume DDI 55 (padrão anterior do app)', () => {
    expect(parseTelefone('11999998888')).toEqual({ ddi: '55', ddd: '11', numero: '999998888' });
  });
  it('com "+55" explícito', () => {
    expect(parseTelefone('+5511999998888')).toEqual({ ddi: '55', ddd: '11', numero: '999998888' });
  });
  it('vazio retorna as 3 caixas vazias com DDI 55', () => {
    expect(parseTelefone('')).toEqual({ ddi: '55', ddd: '', numero: '' });
    expect(parseTelefone(null)).toEqual({ ddi: '55', ddd: '', numero: '' });
  });
});

describe('montarTelefone', () => {
  it('celular BR (9 dígitos): 9 extra destacado com espaço', () => {
    expect(montarTelefone('55', '11', '999998888')).toBe('+55 (11) 9 9999-8888');
  });
  it('fixo BR (8 dígitos): sem o 9 extra', () => {
    expect(montarTelefone('55', '11', '33334444')).toBe('+55 (11) 3333-4444');
  });
  it('outro país (DDI diferente de 55) continua com 4 dígitos após o hífen', () => {
    expect(montarTelefone('1', '202', '5551234')).toBe('+1 (202) 555-1234');
  });
  it('DDI vazio cai no padrão 55', () => {
    expect(montarTelefone('', '11', '999998888')).toBe('+55 (11) 9 9999-8888');
  });
  it('sem DDD nem número: string vazia', () => {
    expect(montarTelefone('55', '', '')).toBe('');
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

// ── Datas no fuso local ───────────────────────────────────────────────
//
// Estes testes existem por um erro que só aparecia à noite: o caminho
// óbvio (`toISOString().slice(0,10)`, `new Date('2026-09-06')`) trabalha em
// UTC, e no Brasil (UTC−3) qualquer coisa depois das 21h já cai no dia
// seguinte. Um horário avulso de hoje sumia da lista no fim da tarde; a
// Agenda mandava o dia da semana anterior pra tela de edição.
//
// A hora é fixada às 22h de propósito: é a janela em que UTC e local
// discordam, e onde o bug se manifesta.
describe('datas no fuso de quem usa o app', () => {
  const { dataParaISO, hojeISO, dataISOParaData, diaSemanaDeISO } = require('../validacao');

  it('dataParaISO usa o dia LOCAL, não o de UTC', () => {
    // 06/09/2026, 22h no horário de Brasília. Em UTC já é dia 07.
    const noite = new Date(2026, 8, 6, 22, 30, 0);
    expect(dataParaISO(noite)).toBe('2026-09-06');
  });

  it('dataParaISO devolve zeros à esquerda', () => {
    expect(dataParaISO(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('hojeISO tem o formato AAAA-MM-DD', () => {
    expect(hojeISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('dataISOParaData nasce à meia-noite LOCAL', () => {
    const d = dataISOParaData('2026-09-06');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(6);
    expect(d.getHours()).toBe(0);
  });

  it('diaSemanaDeISO não devolve o dia anterior', () => {
    // 06/09/2026 é um domingo.
    expect(diaSemanaDeISO('2026-09-06')).toBe(0);
    // 07/09/2026, segunda.
    expect(diaSemanaDeISO('2026-09-07')).toBe(1);
  });

  it('dataISOParaData/diaSemanaDeISO aceitam vazio sem estourar', () => {
    expect(dataISOParaData(null)).toBeNull();
    expect(diaSemanaDeISO('')).toBeNull();
  });
});
