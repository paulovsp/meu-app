-- Alerta automático de atraso: quando um pagamento mensal passa do dia de
-- vencimento sem ser marcado como recebido, o app avisa a própria
-- psicanalista por e-mail (1x por dia, até ser marcado como pago). Essa
-- coluna guarda a data do último alerta já enviado, pra não mandar de novo
-- se o app for aberto várias vezes no mesmo dia.
alter table public.patients add column if not exists alerta_atraso_ultimo_envio date;
