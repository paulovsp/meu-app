-- Mesma lição já registrada nas migrations 0011/0013/0026/0037 ("RLS
-- habilitada não basta, service_role também precisa de GRANT explícito em
-- tabela nova") — só que dessa vez faltou aplicar em 4 tabelas centrais
-- (sessions, patients, appointments, records), criadas antes desse padrão
-- virar rotina no projeto, e em mais duas (pagamentos, whatsapp_comprovantes)
-- que também nunca tinham recebido o grant.
--
-- Sintoma relatado: transcrição de sessão fica "processando" pra sempre.
-- Causa raiz (confirmada consultando a AssemblyAI diretamente pelo
-- transcript_id): a transcrição TERMINA normalmente e a AssemblyAI chama
-- `ia-transcrever-webhook` — que responde 404 porque a query
-- `supabaseAdmin.from('sessions')...` (service_role) esbarra em
-- "permission denied for table sessions" e não acha a sessão, mesmo ela
-- existindo. A AssemblyAI registra isso como falha de entrega do webhook
-- e não tenta de novo pra sempre — a sessão fica travada em "processando"
-- para sempre, embora o áudio já tenha sido transcrito com sucesso.
--
-- Auditoria de toda função que usa o client service_role (`supabaseAdmin`)
-- encontrou mais 2 pontos com o mesmo problema, silenciosos até agora:
--   - enviar-digest-diario: lê `patients`/`pagamentos`/`sessions` pra montar
--     o e-mail de atrasados/sessões sem relato — sem o grant, sempre lia
--     lista vazia e mandava "tudo em dia", mesmo quando não estava.
--   - whatsapp-webhook: lê `patients` (achar quem mandou o comprovante) e
--     grava em `whatsapp_comprovantes` — sem os grants, nunca conseguia
--     achar o paciente nem salvar nada, silenciosamente.
grant select, update on public.sessions to service_role;
grant select on public.patients to service_role;
grant select on public.appointments to service_role;
grant select on public.records to service_role;
grant select on public.pagamentos to service_role;
grant select, insert on public.whatsapp_comprovantes to service_role;
