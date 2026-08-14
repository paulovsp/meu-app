// Despesas do consultório (aluguel, contas, assinaturas, análise pessoal,
// supervisão, cursos, outros) — tela Pagamentos (Administrativo). Não
// confundir com a tabela `pagamentos` (recebimento de analisante, base do
// Recebíveis) — conceito totalmente diferente, daqui pra frente sempre
// "despesa" no código pra não colidir os dois nomes.
import { supabase } from './supabase';
import { usdParaBRL } from './creditosIA';

export const CATEGORIAS_DESPESA = [
  { valor: 'aluguel', label: 'Aluguel' },
  { valor: 'contas', label: 'Contas' },
  { valor: 'assinaturas', label: 'Assinaturas' },
  { valor: 'analise_pessoal', label: 'Análise pessoal' },
  { valor: 'supervisao', label: 'Supervisão' },
  { valor: 'cursos', label: 'Cursos' },
  { valor: 'outros', label: 'Outros' },
];

export function labelCategoria(valor) {
  return CATEGORIAS_DESPESA.find((c) => c.valor === valor)?.label || valor;
}

/** Despesas de um mês específico (1-12), mais recentes primeiro. */
export async function listarDespesas(ano, mes) {
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const fimData = new Date(ano, mes, 0).getDate();
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${String(fimData).padStart(2, '0')}`;
  const { data, error } = await supabase
    .from('despesas_consultorio')
    .select('*')
    .gte('data', inicio)
    .lte('data', fim)
    .order('data', { ascending: false });
  if (error) throw error;
  return data;
}

export async function adicionarDespesa({ categoria, descricao, valor, data, recorrente, cursoId }) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data: linha, error } = await supabase
    .from('despesas_consultorio')
    .insert({
      user_id: session.user.id,
      categoria,
      descricao: descricao.trim(),
      valor,
      data,
      recorrente: !!recorrente,
      curso_id: cursoId || null,
    })
    .select()
    .single();
  if (error) throw error;
  return linha;
}

export async function editarDespesa(id, { categoria, descricao, valor, data, recorrente }) {
  const { error } = await supabase
    .from('despesas_consultorio')
    .update({ categoria, descricao: descricao.trim(), valor, data, recorrente: !!recorrente })
    .eq('id', id);
  if (error) throw error;
}

export async function removerDespesa(id) {
  const { error } = await supabase.from('despesas_consultorio').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Assinatura do app + créditos de IA usados no mês, pra aparecer como um
 * resumo automático no topo da tela Pagamentos — não vira linha manual na
 * tabela `despesas_consultorio` (evitaria duplicar/dessincronizar com o
 * que o mercadopago-webhook e as Edge Functions de IA já gravam sozinhos).
 */
export async function getResumoAssinaturaECreditosDoMes(ano, mes) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session.user.id;

  const { data: perfil, error: erroPerfil } = await supabase
    .from('profiles')
    .select('assinatura_plano, assinatura_valor_mensal_equivalente')
    .eq('id', userId)
    .single();
  if (erroPerfil) throw erroPerfil;

  const inicio = new Date(ano, mes - 1, 1).toISOString();
  const fim = new Date(ano, mes, 1).toISOString();
  const { data: usos, error: erroUsos } = await supabase
    .from('uso_ia')
    .select('custo_estimado')
    .eq('user_id', userId)
    .gte('criado_em', inicio)
    .lt('criado_em', fim)
    .gt('custo_estimado', 0);
  if (erroUsos) throw erroUsos;

  const creditosGastosUsd = (usos || []).reduce((soma, u) => soma + Number(u.custo_estimado || 0), 0);

  return {
    plano: perfil?.assinatura_plano || null,
    assinaturaValorBRL: Number(perfil?.assinatura_valor_mensal_equivalente || 0),
    creditosGastosBRL: usdParaBRL(creditosGastosUsd),
  };
}
