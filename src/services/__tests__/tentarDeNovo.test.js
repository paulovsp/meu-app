// Repetição da consulta que abre um job de cron.
//
// Testado porque o preço de errar aqui é um dia inteiro sem resumo: em 12
// e 13/09/2026 a leitura de perfis do `enviar-digest-diario` voltou 504
// ("Gateway Timeout") e o e-mail não saiu para ninguém, sem segunda
// chance — o cron só tenta de novo no dia seguinte. As duas metades que
// importam são "repete o que é de rede" e "NÃO repete o que o banco
// respondeu", e é isso que está conferido abaixo.
const { tentarDeNovo, ehTransitorio } = require('../../../supabase/functions/_shared/tentarDeNovo.ts');

// Nada de espera de verdade: o teste confere quantas vezes tentou, não o relógio.
const semEspera = () => Promise.resolve();

describe('ehTransitorio', () => {
  it('trata como transitório o erro sem código (não chegou ao banco)', () => {
    expect(ehTransitorio({ message: 'Gateway Timeout' })).toBe(true);
    expect(ehTransitorio({ code: '', message: 'fetch failed' })).toBe(true);
  });

  it('trata como transitório o PGRST003 (fila de conexões cheia)', () => {
    expect(ehTransitorio({ code: 'PGRST003', message: 'pool timeout' })).toBe(true);
  });

  // O teto de tempo da consulta só serve se a tentativa seguinte acontecer:
  // o supabase-js devolve o abort com o código numérico do DOMException.
  it('trata como transitório o abort do teto de tempo', () => {
    expect(ehTransitorio({ code: '20', message: 'AbortError: signal is aborted' })).toBe(true);
    expect(ehTransitorio({ code: '23', message: 'TimeoutError: signal timed out' })).toBe(true);
  });

  it('não é transitório o que o Postgres respondeu', () => {
    expect(ehTransitorio({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(ehTransitorio({ code: '42703', message: 'column does not exist' })).toBe(false);
  });

  it('sem erro não há o que repetir', () => {
    expect(ehTransitorio(null)).toBe(false);
  });
});

describe('tentarDeNovo', () => {
  it('não repete quando a primeira já deu certo', async () => {
    const consulta = jest.fn().mockResolvedValue({ data: [{ id: 'a' }], error: null });
    const r = await tentarDeNovo(consulta, { dormir: semEspera });
    expect(consulta).toHaveBeenCalledTimes(1);
    expect(r.data).toEqual([{ id: 'a' }]);
    expect(r.error).toBeNull();
  });

  it('repete o 504 do gateway e entrega o resultado da tentativa seguinte', async () => {
    const consulta = jest.fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'Gateway Timeout' } })
      .mockResolvedValueOnce({ data: [{ id: 'a' }], error: null });
    const r = await tentarDeNovo(consulta, { dormir: semEspera });
    expect(consulta).toHaveBeenCalledTimes(2);
    expect(r.error).toBeNull();
    expect(r.data).toEqual([{ id: 'a' }]);
  });

  it('repete a consulta que estourou o teto de tempo', async () => {
    const consulta = jest.fn()
      .mockResolvedValueOnce({ data: null, error: { code: '23', message: 'TimeoutError: signal timed out' } })
      .mockResolvedValueOnce({ data: [{ id: 'a' }], error: null });
    const r = await tentarDeNovo(consulta, { dormir: semEspera });
    expect(consulta).toHaveBeenCalledTimes(2);
    expect(r.data).toEqual([{ id: 'a' }]);
  });

  it('repete também quando o fetch nem completou, virando erro com a mensagem', async () => {
    const consulta = jest.fn()
      .mockRejectedValueOnce(new Error('error sending request'))
      .mockResolvedValueOnce({ data: [], error: null });
    const r = await tentarDeNovo(consulta, { dormir: semEspera });
    expect(consulta).toHaveBeenCalledTimes(2);
    expect(r.error).toBeNull();
  });

  it('devolve o último erro quando todas as tentativas falham', async () => {
    const consulta = jest.fn().mockResolvedValue({ data: null, error: { message: 'Gateway Timeout' } });
    const r = await tentarDeNovo(consulta, { tentativas: 3, dormir: semEspera });
    expect(consulta).toHaveBeenCalledTimes(3);
    expect(r.error).toEqual({ message: 'Gateway Timeout' });
  });

  it('não insiste no erro que o banco respondeu', async () => {
    const consulta = jest.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    const r = await tentarDeNovo(consulta, { dormir: semEspera });
    expect(consulta).toHaveBeenCalledTimes(1);
    expect(r.error.code).toBe('42501');
  });

  it('espera mais a cada tentativa, e não espera depois da última', async () => {
    const esperas = [];
    const consulta = jest.fn().mockResolvedValue({ data: null, error: { message: 'Gateway Timeout' } });
    await tentarDeNovo(consulta, {
      tentativas: 3,
      esperaMs: 500,
      dormir: (ms) => { esperas.push(ms); return Promise.resolve(); },
    });
    expect(esperas).toEqual([500, 1000]);
  });
});
