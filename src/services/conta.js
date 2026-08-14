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

/**
 * Troca de senha com o usuário já logado (Perfil → Segurança). Confirma a
 * senha atual reautenticando (supabase.auth.signInWithPassword) antes de
 * trocar — sem isso, qualquer pessoa que pegasse o celular já desbloqueado
 * e logado poderia trocar a senha sem saber a atual.
 */
export async function alterarSenha(email, senhaAtual, novaSenha) {
  const { error: erroVerificacao } = await supabase.auth.signInWithPassword({
    email,
    password: senhaAtual,
  });
  if (erroVerificacao) {
    throw new Error('Senha atual incorreta.');
  }
  const { error } = await supabase.auth.updateUser({ password: novaSenha });
  if (error) throw error;
}

/**
 * Fluxo "esqueci minha senha" — usado na tela de Login. O link do e-mail
 * leva pra uma página web (redefinir-senha.html, mesmo padrão do
 * confirmado.html em docs/) porque o app não tem `scheme` de deep link
 * configurado — a troca de senha em si acontece nessa página, não dentro
 * do app. Precisa que essa URL esteja na lista de Redirect URLs permitidas
 * no painel do Supabase (Authentication → URL Configuration).
 */
export async function solicitarRedefinicaoSenha(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://app.drsig.com.br/redefinir-senha.html',
  });
  if (error) throw error;
}
