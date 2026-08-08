import { supabase } from './supabase';

/**
 * Apaga permanentemente a conta autenticada e todo o dado clínico ligado a
 * ela (analisantes, sessões, registros, agenda, financeiro, núcleos/perfil
 * objetivo, relatórios) — via Edge Function, já que apagar de `auth.users`
 * exige `service_role`, nunca exposto ao cliente. Sem volta.
 */
export async function excluirConta() {
  const { error } = await supabase.functions.invoke('excluir-conta', { body: {} });
  if (error) {
    let mensagem = error.message;
    try {
      const corpo = await error.context?.json();
      if (corpo?.error) mensagem = corpo.error;
    } catch (_) {}
    throw new Error(mensagem);
  }
}

/**
 * Troca do e-mail de LOGIN (auth.users) — item A.1/A.3. Diferente de
 * simplesmente atualizar `profiles.email` (que não muda com o que se usa
 * pra entrar no app), isso dispara o fluxo nativo do Supabase Auth: manda
 * um link de confirmação pro endereço novo (e pro atual, se "secure email
 * change" estiver ativo no projeto) — o e-mail de login só muda de fato
 * depois que o link é confirmado. `profiles.email` é sincronizado
 * automaticamente nesse momento por um trigger no banco (migration 0033),
 * não aqui — evita os dois campos ficarem inconsistentes enquanto a troca
 * está pendente de confirmação.
 */
export async function alterarEmailLogin(novoEmail) {
  const { error } = await supabase.auth.updateUser({ email: novoEmail });
  if (error) throw error;
}
