// A regra de qual dia a prévia da Agenda mostra.
//
// Testada porque depende do relógio, e defeito que só aparece "depois das
// nove da noite de sexta" é defeito que ninguém reproduz de propósito.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), auth: {} } }));

const {
  montarBlocosDoDia, hojeAindaInteressa, momentoDaVirada, rotuloDoDia,
  MINUTOS_APOS_ULTIMO,
} = require('../agendaResumo');

// 04/09/2026 é uma sexta-feira.
const SEXTA = '2026-09-04';
const SABADO = '2026-09-05';

const slot = (extra = {}) => ({
  id: 's1',
  day_of_week: 5, // sexta
  start_time: '14:00',
  end_time: '14:50',
  modality: 'presencial',
  patient_id: 'p1',
  patient_name: 'Clarice Lispector',
  tipo: 'sessao_individual',
  recorrencia_tipo: 'semanal',
  ...extra,
});

describe('montarBlocosDoDia', () => {
  it('monta o bloco do horário recorrente do dia', () => {
    const blocos = montarBlocosDoDia({
      slots: [slot()], compromissos: [], liberados: [], dataISO: SEXTA,
    });
    expect(blocos).toHaveLength(1);
    expect(blocos[0].startTime).toBe('14:00');
    expect(blocos[0].nome).toBe('Clarice');
  });

  it('ignora horário de outro dia da semana', () => {
    const blocos = montarBlocosDoDia({
      slots: [slot()], compromissos: [], liberados: [], dataISO: SABADO,
    });
    expect(blocos).toHaveLength(0);
  });

  // Era o defeito: a Agenda respeitava `horarios_liberados` e a prévia da
  // tela inicial não. Um horário apagado só naquela data — ou esvaziado por
  // uma remarcação — seguia aparecendo como ocupado no widget.
  it('some com o horário liberado naquela data', () => {
    const blocos = montarBlocosDoDia({
      slots: [slot()],
      compromissos: [],
      liberados: [{ date: SEXTA, start_time: '14:00' }],
      dataISO: SEXTA,
    });
    expect(blocos).toHaveLength(0);
  });

  it('a liberação vale só para a data dela, não para as outras semanas', () => {
    const blocos = montarBlocosDoDia({
      slots: [slot()],
      compromissos: [],
      liberados: [{ date: '2026-08-28', start_time: '14:00' }],
      dataISO: SEXTA,
    });
    expect(blocos).toHaveLength(1);
  });

  it('horário liberado que recebeu outro compromisso volta a aparecer', () => {
    const blocos = montarBlocosDoDia({
      slots: [slot()],
      compromissos: [{
        id: 'a1', date: SEXTA, start_time: '14:00', end_time: '14:50',
        status: 'agendado', tipo: 'sessao_individual', patient_nome: 'Rosane Pereira',
      }],
      liberados: [{ date: SEXTA, start_time: '14:00' }],
      dataISO: SEXTA,
    });
    expect(blocos).toHaveLength(1);
    expect(blocos[0].nome).toBe('Rosane');
  });

  it('compromisso cancelado não entra', () => {
    const blocos = montarBlocosDoDia({
      slots: [],
      compromissos: [{
        id: 'a2', date: SEXTA, start_time: '09:00', end_time: '09:50',
        status: 'cancelado', tipo: 'sessao_individual', patient_nome: 'Yanne',
      }],
      liberados: [], dataISO: SEXTA,
    });
    expect(blocos).toHaveLength(0);
  });

  it('compromisso avulso sem horário por trás entra e fica em ordem', () => {
    const blocos = montarBlocosDoDia({
      slots: [slot()],
      compromissos: [{
        id: 'a3', date: SEXTA, start_time: '09:00', end_time: '09:50',
        status: 'agendado', tipo: 'sessao_individual', patient_nome: 'Yanne Souza',
      }],
      liberados: [], dataISO: SEXTA,
    });
    expect(blocos.map((b) => b.startTime)).toEqual(['09:00', '14:00']);
  });
});

describe('até quando o dia de hoje continua em cartaz', () => {
  const blocos = [
    { startTime: '09:00', endTime: '09:50' },
    { startTime: '14:00', endTime: '14:50' },
  ];
  const as = (h, m = 0) => new Date(2026, 8, 4, h, m);

  it('durante o dia, mostra hoje', () => {
    expect(hojeAindaInteressa(blocos, as(10))).toBe(true);
  });

  it('logo depois da última sessão, ainda mostra hoje', () => {
    expect(hojeAindaInteressa(blocos, as(15, 30))).toBe(true);
  });

  it('exatamente uma hora depois, deixa de mostrar', () => {
    expect(hojeAindaInteressa(blocos, as(15, 50))).toBe(false);
  });

  it('de noite, não mostra mais hoje', () => {
    expect(hojeAindaInteressa(blocos, as(21))).toBe(false);
  });

  it('dia sem nada nunca interessa', () => {
    expect(hojeAindaInteressa([], as(8))).toBe(false);
  });

  it('bloco sem hora de término assume os 50 minutos da sessão', () => {
    const semFim = [{ startTime: '14:00', endTime: null }];
    expect(hojeAindaInteressa(semFim, as(15, 40))).toBe(true);
    expect(hojeAindaInteressa(semFim, as(15, 51))).toBe(false);
  });
});

describe('momentoDaVirada', () => {
  it('devolve a hora exata em que o dia deixa de valer', () => {
    const agora = new Date(2026, 8, 4, 10, 0);
    const virada = momentoDaVirada([{ startTime: '14:00', endTime: '14:50' }], agora);
    expect(virada.getHours()).toBe(15);
    expect(virada.getMinutes()).toBe(50);
  });

  it('não devolve momento já passado', () => {
    const agora = new Date(2026, 8, 4, 22, 0);
    expect(momentoDaVirada([{ startTime: '14:00', endTime: '14:50' }], agora)).toBeNull();
  });

  it('a folga é a mesma que a regra usa', () => {
    expect(MINUTOS_APOS_ULTIMO).toBe(60);
  });
});

describe('rotuloDoDia', () => {
  const agora = new Date(2026, 8, 4, 10, 0); // sexta, 04/09/2026

  it('hoje e amanhã são ditos por nome', () => {
    expect(rotuloDoDia('2026-09-04', agora)).toBe('Hoje');
    expect(rotuloDoDia('2026-09-05', agora)).toBe('Amanhã');
  });

  it('depois disso, dia da semana e data', () => {
    expect(rotuloDoDia('2026-09-07', agora)).toBe('Seg, 07/09');
  });
});
