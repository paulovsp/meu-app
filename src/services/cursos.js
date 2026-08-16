// Currículo de cursos (Perfil → Cursos) + gravação/transcrição da aula via
// AssemblyAI (curso-transcrever/curso-transcrever-webhook, pipeline próprio
// — ver comentário na migration 0037). Quando o curso tem custo, gera
// automaticamente uma despesa vinculada (categoria "cursos") na tela
// Pagamentos, mantida em sincronia nas edições.
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { adicionarDespesa, editarDespesa, removerDespesa } from './despesas';
import { MENSAGEM_ASSINATURA_INATIVA } from './assinatura';

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

export async function criarCurso(dados) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase
    .from('cursos')
    .insert({
      user_id: session.user.id,
      titulo: dados.titulo.trim(),
      professor: dados.professor?.trim() || null,
      instituicao: dados.instituicao?.trim() || null,
      carga_horaria: dados.cargaHoraria || null,
      custo: dados.custo || null,
      formato: dados.formato || null,
      local: dados.local?.trim() || null,
      data: dados.data || null,
      anotacoes: dados.anotacoes?.trim() || null,
    })
    .select()
    .single();
  if (error) throw error;
  await sincronizarDespesaDoCurso(data);
  return data;
}

export async function editarCurso(id, dados) {
  const { data, error } = await supabase
    .from('cursos')
    .update({
      titulo: dados.titulo.trim(),
      professor: dados.professor?.trim() || null,
      instituicao: dados.instituicao?.trim() || null,
      carga_horaria: dados.cargaHoraria || null,
      custo: dados.custo || null,
      formato: dados.formato || null,
      local: dados.local?.trim() || null,
      data: dados.data || null,
      anotacoes: dados.anotacoes?.trim() || null,
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  await sincronizarDespesaDoCurso(data);
  return data;
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

/** Dispara a transcrição assíncrona (mesmo padrão de NovaSessaoScreen.js
 * pro áudio de sessão) — sobe o áudio e volta na hora, sem esperar o
 * resultado; a Edge Function chama o webhook quando terminar. */
export async function transcreverAudioCurso(uri, cursoId) {
  const audioBase64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  const { data, error } = await supabase.functions.invoke('curso-transcrever', {
    body: { audioBase64, cursoId },
  });

  if (error) {
    let mensagem = error.message;
    let creditosInsuficientes = false;
    let assinaturaInativa = false;
    try {
      const corpo = await error.context?.json();
      if (corpo?.error) mensagem = corpo.error;
      creditosInsuficientes = !!corpo?.creditosInsuficientes;
      assinaturaInativa = !!corpo?.assinaturaInativa;
    } catch (_) {}
    if (assinaturaInativa) throw new Error(MENSAGEM_ASSINATURA_INATIVA);
    if (creditosInsuficientes) {
      throw new Error('Créditos de IA insuficientes para transcrever. Fale com o administrador da conta.');
    }
    throw new Error(mensagem);
  }
  if (data?.error) throw new Error(data.error);
}
