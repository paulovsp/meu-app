-- F.16: chave Pix do profissional.
-- F.17: templates de mensagem editáveis (cobrança, recibo pro analisante,
-- recibo/nota pro contador) — null/vazio = usa o texto padrão do Dr.Sig.
-- F.18: terceiro tipo de cobrança "mensal fixo" (valor único, não
-- calculado por sessão).
alter table public.profiles add column if not exists pix_key text;
alter table public.profiles add column if not exists template_cobranca text;
alter table public.profiles add column if not exists template_recibo_paciente text;
alter table public.profiles add column if not exists template_recibo_contador text;

alter table public.patients add column if not exists valor_mensal_fixo numeric;

alter table public.patients drop constraint if exists patients_tipo_cobranca_check;
alter table public.patients add constraint patients_tipo_cobranca_check
  check (tipo_cobranca in ('mensal', 'mensal_fixo', 'por_sessao'));
