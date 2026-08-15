-- BUGFIX: três tabelas criadas em migrations anteriores (0031, 0032) tinham
-- RLS habilitado com policies corretas, mas nunca receberam GRANT pra role
-- `authenticated` — sem o GRANT, o Postgres já barra o acesso à tabela
-- ANTES de avaliar qualquer policy de RLS (lição repetida em várias
-- migrations deste projeto: RLS sozinho não basta). Na prática isso
-- quebrava:
--   • o botão "Paralisação/Retorno" no Detalhe do Analisante (G.20) —
--     todo insert/update em patient_paralizacoes falhava com "permission
--     denied";
--   • editar QUALQUER horário existente na Agenda — updateAvailabilitySlot
--     chama salvarParticipantesSlot incondicionalmente (mesmo pra sessão
--     individual sem participantes), que faz DELETE em slot_participantes;
--   • criar ou carregar um horário/compromisso do tipo "em grupo" —
--     slot_participantes e appointment_participantes (J.23).

grant select, insert, update, delete on public.patient_paralizacoes to authenticated;
-- slot_participantes e appointment_participantes só têm policy de
-- select/insert/delete (sempre substituídas via delete+insert, nunca
-- update em linha) — grant casado com o que a RLS de fato permite.
grant select, insert, delete on public.slot_participantes to authenticated;
grant select, insert, delete on public.appointment_participantes to authenticated;
