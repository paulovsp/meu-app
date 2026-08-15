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
    .select('assinatura_plano, assinatura_valor_mensal_equivalente, assinatura_ciclo_inicio, assinatura_expira_em')
    .eq('id', userId)
    .single();
  if (erroPerfil) throw erroPerfil;

  const inicio = new Date(ano, mes - 1, 1);
  const fim = new Date(ano, mes, 1);
  const { data: usos, error: erroUsos } = await supabase
    .from('uso_ia')
    .select('custo_estimado')
    .eq('user_id', userId)
    .gte('criado_em', inicio.toISOString())
    .lt('criado_em', fim.toISOString())
    .gt('custo_estimado', 0);
  if (erroUsos) throw erroUsos;

  const creditosGastosUsd = (usos || []).reduce((soma, u) => soma + Number(u.custo_estimado || 0), 0);

  // `assinatura_valor_mensal_equivalente` é um snapshot do plano ATUAL do
  // profile, não um histórico por mês — sem esta checagem, a linha
  // "Assinatura" aparecia igual em qualquer mês navegado (inclusive
  // passado/futuro fora do ciclo pago), mesmo quando não havia assinatura
  // ativa naquele período. Só mostra o valor se o mês consultado tiver
  // sobreposição com o ciclo pago [ciclo_inicio, expira_em).
  const cicloInicio = perfil?.assinatura_ciclo_inicio ? new Date(perfil.assinatura_ciclo_inicio) : null;
  const expiraEm = perfil?.assinatura_expira_em ? new Date(perfil.assinatura_expira_em) : null;
  const assinaturaAtivaNoMes = !!(cicloInicio && expiraEm && cicloInicio < fim && expiraEm > inicio);

  return {
    plano: perfil?.assinatura_plano || null,
    assinaturaValorBRL: assinaturaAtivaNoMes ? Number(perfil?.assinatura_valor_mensal_equivalente || 0) : 0,
    creditosGastosBRL: usdParaBRL(creditosGastosUsd),
  };
}
