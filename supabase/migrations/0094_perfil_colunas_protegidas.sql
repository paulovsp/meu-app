-- Um usuário comum podia se dar acesso vitalício e crédito infinito.
--
-- A política de RLS `profiles_update_own` diz só `id = auth.uid()`: você
-- pode alterar a sua linha. O que faltava era dizer QUAIS COLUNAS — e o
-- papel `authenticated` tinha UPDATE nas 55, incluindo as que decidem se a
-- conta está paga e quanto crédito de IA ela tem.
--
-- Isso é explorável com o próprio login da pessoa, sem nenhuma ferramenta
-- especial: a chave publishable e a URL do projeto estão dentro do app e
-- das páginas, como têm que estar. Uma requisição basta:
--
--   PATCH /rest/v1/profiles?id=eq.<meu-id>
--   {"assinatura_status":"cortesia","assinatura_expira_em":"2099-12-31",
--    "creditos_ia":999}
--
-- Verificado nesta base, com um token de usuário real: a resposta voltou
-- 'cortesia | 2099-12-31 | creditos: 999'. Acesso vitalício de graça, e
-- ~R$ 5.000 em transcrição e IA — que sairiam da conta da AssemblyAI e da
-- DeepSeek, em dinheiro de verdade.
--
-- Não é um defeito do programa de indicações; ele só acrescentou mais
-- quatro colunas à lista do que dava pra forjar. O buraco é anterior e
-- valia para qualquer conta desde o primeiro dia de assinatura paga.
--
-- ── Por que REVOKE e não um trigger ──
--
-- Um trigger que barra certas colunas é código que alguém precisa lembrar
-- de atualizar a cada coluna nova. Privilégio por coluna é declarativo: o
-- Postgres recusa antes de qualquer lógica rodar, e coluna nova nasce
-- FECHADA — o inverso do que acontecia aqui, onde toda coluna nova nascia
-- aberta.
--
-- No Postgres não dá pra revogar uma coluna de um privilégio concedido no
-- nível da tabela: revoga-se a tabela e concede-se coluna a coluna.
--
-- O service_role (webhook, conferência diária, funções de pagamento) não é
-- afetado: ele passa por cima da RLS e dos grants, e continua sendo o
-- único caminho para essas colunas mudarem.

revoke update on public.profiles from authenticated;

-- O que a pessoa realmente edita no app: dados dela, preferências dela,
-- textos dela. Se um campo novo tiver que ser editável, ele entra aqui de
-- propósito — e não por esquecimento.
grant update (
  -- Identificação e contato
  nome, crp, especialidade, cpf, data_nascimento, telefone,
  -- Endereço
  cep, logradouro, numero, complemento, bairro, cidade, uf,
  -- Contador
  contador_nome, contador_email, contador_telefone,
  -- Imagens e identidade visual do perfil
  avatar_url, capa_url, assinatura,
  -- Cobrança dos analisantes DELA (chave Pix própria e modelos de texto)
  pix_key, template_cobranca, template_recibo_paciente, template_recibo_contador,
  -- Preferências de notificação e token do aparelho
  expo_push_token,
  notif_transcricao_app, notif_transcricao_email, notif_transcricao_push,
  notif_atraso_app, notif_atraso_email, notif_atraso_push,
  notif_registro_app, notif_registro_email, notif_registro_push,
  notif_sessao_email, notif_sessao_push,
  -- Carimbo de atualização
  updated_at
) on public.profiles to authenticated;

-- Ficam de fora, e só o servidor escreve:
--
--   id, email, created_at, origem          — identidade da conta
--   assinatura_status, assinatura_expira_em, assinatura_plano,
--   assinatura_ciclo_inicio, assinatura_valor_mensal_equivalente,
--   assinatura_renovacao_notificada_em, mp_preapproval_id
--                                          — quem decide isso é o Mercado
--                                            Pago, pelo webhook
--   creditos_ia, proxima_renovacao_credito, plano_ia
--                                          — dinheiro: só entra por
--                                            pagamento confirmado
--   codigo_indicacao, indicado_por, indicacao_desconto_percentual,
--   elegivel_indicacao, aviso_fim_acesso_dias
--                                          — o programa de indicações não
--                                            se autodeclara
