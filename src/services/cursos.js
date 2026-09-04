// Currículo de cursos (Perfil → Cursos) + gravação/transcrição da aula via
// AssemblyAI (curso-transcrever/curso-transcrever-webhook, pipeline próprio
// — ver comentário na migration 0037). Quando o curso tem custo, gera
// automaticamente uma despesa vinculada (categoria "cursos") na tela
// Pagamentos, mantida em sincronia nas edições.
import { supabase } from './supabase';
import { adicionarDespesa, editarDespesa, removerDespesa } from './despesas';
import { normalizarHorario, somarMinutos } from './horarios';

/** Carga horária total (em horas) de `quantidade` aulas de `duracaoMin`
 * minutos cada — o que antes era digitado à mão no campo "Carga horária".
 * Devolve null quando faltar um dos dois, pra não gravar 0 por engano. */
export function calcularCargaHoraria(quantidadeAulas, duracaoAulaMin) {
  const aulas = Number(quantidadeAulas);
  const duracao = Number(duracaoAulaMin);
  if (!Number.isFinite(aulas) || !Number.isFinite(duracao)) return null;
  if (aulas <= 0 || duracao <= 0) return null;
  // Arredonda em 2 casas — 3 aulas de 50 min dão 2,5h, não 2,4999999.
  return Math.round((aulas * duracao / 60) * 100) / 100;
}

/** Horário de término derivado do início + duração de uma aula, quando a
 * pessoa não informa um término próprio. */
export function terminoDerivadoDaAula(horarioInicio, duracaoAulaMin) {
  const duracao = Number(duracaoAulaMin);
  if (!Number.isFinite(duracao) || duracao <= 0) return null;
  return somarMinutos(horarioInicio, duracao);
}

export async function listarCursos() {
  const { data, error } = await supabase
    .from('cursos')
    .select('*')
    .order('data', { ascending: false, nullsFirst: false })
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getCursoById(id) {
  const { data, error } = await supabase.from('cursos').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

/** Acha a despesa já vinculada a este curso (se houver), pra manter em
 * sincronia sem duplicar linha a cada edição. */
async function getDespesaVinculada(cursoId) {
  const { data, error } = await supabase
    .from('despesas_consultorio')
    .select('id, data')
    .eq('curso_id', cursoId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function sincronizarDespesaDoCurso(curso) {
  const despesaExistente = await getDespesaVinculada(curso.id);
  const temCusto = Number(curso.custo) > 0;

  if (temCusto && despesaExistente) {
    // Se o curso não tem data preenchida, mantém a data que a despesa já
    // tinha — sem isso, editar só o custo (sem mexer na data) reatribuía
    // "hoje" a cada edição e a despesa "sumia" do mês em que o usuário
    // estava olhando em Pagamentos (parecia não sincronizar, na real
    // sincronizava pro mês errado).
    await editarDespesa(despesaExistente.id, {
      categoria: 'cursos',
      descricao: curso.titulo,
      valor: Number(curso.custo),
      data: curso.data || despesaExistente.data,
      recorrente: false,
    });
  } else if (temCusto && !despesaExistente) {
    await adicionarDespesa({
      categoria: 'cursos',
      descricao: curso.titulo,
      valor: Number(curso.custo),
      data: curso.data || new Date().toISOString().slice(0, 10),
      recorrente: false,
      cursoId: curso.id,
    });
  } else if (!temCusto && despesaExistente) {
    await removerDespesa(despesaExistente.id);
  }
}

/**
 * Mantém na Agenda um compromisso derivado do curso (tipo "Outros", sem
 * analisante), sempre que o curso tiver data E horário de início. Achado
 * pelo `curso_id` (migration 0050), então editar o curso move/renomeia o
 * mesmo compromisso em vez de criar outro; tirar a data ou o horário
 * remove o compromisso da Agenda.
 *
 * NUNCA derruba o salvamento do curso: se o horário já estiver ocupado por
 * outro compromisso, devolve `{ ok: false, motivo }` pra tela avisar — o
 * curso em si continua salvo normalmente.
 */
async function sincronizarAgendaDoCurso(curso) {
  const { data: existente, error: errBusca } = await supabase
    .from('appointments')
    .select('id')
    .eq('curso_id', curso.id)
    .maybeSingle();
  if (errBusca) return { ok: false, motivo: errBusca.message };

  const inicio = normalizarHorario(curso.horario_inicio);
  const deveExistir = !!(curso.data && inicio);

  if (!deveExistir) {
    if (existente) {
      const { error } = await supabase.from('appointments').delete().eq('id', existente.id);
      if (error) return { ok: false, motivo: error.message };
    }
    return { ok: true };
  }

  const fim = normalizarHorario(curso.horario_fim)
    || terminoDerivadoDaAula(inicio, curso.duracao_aula_min)
    || somarMinutos(inicio, 60);

  const campos = {
    date: curso.data,
    start_time: inicio,
    end_time: fim,
    titulo: `Curso: ${curso.titulo}`,
    tipo: 'outros',
    modality: curso.formato === 'presencial' ? 'presencial' : 'online',
  };

  if (existente) {
    const { error } = await supabase.from('appointments').update(campos).eq('id', existente.id);
    // 23505 = colidiu com outro compromisso no mesmo dia/horário
    // (índice único user_id,date,start_time).
    if (error) return { ok: false, motivo: error.code === '23505' ? 'horario_ocupado' : error.message };
    return { ok: true };
  }

  const { error } = await supabase.from('appointments').insert({
    ...campos,
    user_id: curso.user_id,
    patient_id: null,
    status: 'agendado',
    curso_id: curso.id,
  });
  if (error) return { ok: false, motivo: error.code === '23505' ? 'horario_ocupado' : error.message };
  return { ok: true };
}

/** Campos gravados em `cursos`, iguais na criação e na edição — a carga
 * horária é sempre derivada (aulas × duração), nunca vem digitada. */
function camposDoCurso(dados) {
  return {
    titulo: dados.titulo.trim(),
    professor: dados.professor?.trim() || null,
    instituicao: dados.instituicao?.trim() || null,
    quantidade_aulas: dados.quantidadeAulas || null,
    duracao_aula_min: dados.duracaoAulaMin || null,
    carga_horaria: calcularCargaHoraria(dados.quantidadeAulas, dados.duracaoAulaMin),
    horario_inicio: normalizarHorario(dados.horarioInicio),
    horario_fim: normalizarHorario(dados.horarioFim),
    custo: dados.custo || null,
    formato: dados.formato || null,
    local: dados.local?.trim() || null,
    data: dados.data || null,
    anotacoes: dados.anotacoes?.trim() || null,
  };
}

export async function criarCurso(dados) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase
    .from('cursos')
    .insert({ user_id: session.user.id, ...camposDoCurso(dados) })
    .select()
    .single();
  if (error) throw error;
  await sincronizarDespesaDoCurso(data);
  const agenda = await sincronizarAgendaDoCurso(data);
  return { ...data, _agenda: agenda };
}

export async function editarCurso(id, dados) {
  const { data, error } = await supabase
    .from('cursos')
    .update({ ...camposDoCurso(dados), atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  await sincronizarDespesaDoCurso(data);
  const agenda = await sincronizarAgendaDoCurso(data);
  return { ...data, _agenda: agenda };
}

export async function removerCurso(id) {
  const { error } = await supabase.from('cursos').delete().eq('id', id);
  if (error) throw error;
}

export async function marcarConsentimentoProfessor(cursoId) {
  const { error } = await supabase
    .from('cursos')
    .update({ consentimento_professor: true, consentimento_em: new Date().toISOString() })
    .eq('id', cursoId);
  if (error) throw error;
}

export async function salvarTranscricaoManual(cursoId, texto) {
  const { error } = await supabase
    .from('cursos')
    .update({ transcript: texto, transcricao_status: null })
    .eq('id', cursoId);
  if (error) throw error;
}

