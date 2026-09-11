// ─── Conta de demonstração ──────────────────────────────────────────────
//
// Um consultório fictício completo — o do Sigmund Freud, com analisantes,
// supervisionandos, agenda, registros de sessão e transcrições — que
// qualquer pessoa pode abrir antes de criar conta.
//
// A senha é pública de propósito: a ideia é justamente que quem está
// avaliando o app entre e mexa. Por isso a conta é SOMENTE LEITURA no
// banco (migration 0097): políticas restritivas de INSERT, UPDATE e DELETE
// impedem qualquer alteração, venha ela do app ou de uma requisição
// direta. Esconder botão resolveria o acidente e não resolveria o resto.
//
// Divulgar a senha aqui não é descuido: ela dá acesso a dados fictícios
// que não podem ser alterados, e é a mesma senha impressa na tela de
// entrada.
export const CONTA_DEMONSTRACAO = {
  email: 'oseusig@gmail.com',
  senha: 'conhecer2026',
};

/** Esta sessão é a da conta de demonstração? */
export function ehSessaoDeDemonstracao(perfil) {
  if (!perfil) return false;
  // `conta_demonstracao` é a fonte de verdade (é ela que a RLS consulta);
  // o e-mail entra como rede para o instante em que o perfil ainda não
  // carregou.
  return perfil.conta_demonstracao === true
    || perfil.email === CONTA_DEMONSTRACAO.email;
}

export const AVISO_DEMONSTRACAO =
  'Você está no consultório de demonstração — um consultório fictício, com ' +
  'analisantes, agenda e sessões de exemplo. Dá para navegar por tudo e abrir ' +
  'qualquer tela, mas nada pode ser alterado ou apagado: é a mesma amostra para ' +
  'todas as pessoas que vêm conhecer o app.';
