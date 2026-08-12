-- Novo modelo de preços: Mensal (R$89/mês, cartão, assinatura/preapproval
-- recorrente) e Semestral (R$414 a cada 6 meses) / Anual (R$588 a cada 12
-- meses), os dois via Pix como pagamento ÚNICO (a API de assinatura do
-- Mercado Pago só documenta cartão pra cobrança recorrente — Pix não
-- entra ali, ver comentário no início de mercadopago-webhook/index.ts).
-- Quando o ciclo do semestral/anual termina, o sistema deve migrar a
-- conta pra uma assinatura MENSAL recorrente no cartão, mas cobrando o
-- valor equivalente com desconto (R$69 pra quem veio do semestral, R$49
-- pra quem veio do anual) — nunca o R$89 cheio. Essas colunas guardam o
-- necessário pra isso: qual plano está valendo, quando o ciclo atual
-- começou, e qual o valor mensal equivalente (usado tanto pra criar a
-- nova preapproval mensal quanto pra mostrar em cobrança/relatórios).
alter table public.profiles
  add column if not exists assinatura_plano text
    check (assinatura_plano is null or assinatura_plano in ('mensal', 'semestral', 'anual')),
  add column if not exists assinatura_ciclo_inicio timestamptz,
  add column if not exists assinatura_valor_mensal_equivalente numeric,
  -- Marca quando a Edge Function `assinatura-processar-ciclo` avisou a
  -- profissional que precisa confirmar a nova assinatura mensal (porque
  -- não deu pra reaproveitar o pagamento automaticamente). Evita reenviar
  -- o aviso todo dia durante os 5 dias de carência, e é a partir dela que
  -- se calcula o fim da carência.
  add column if not exists assinatura_renovacao_notificada_em timestamptz;

-- Mesmas colunas em pagamentos_pendentes (migration 0026) — quem paga o
-- semestral/anual ANTES de criar a conta no app não pode perder essa
-- informação; o gatilho abaixo as copia pro profiles na hora do cadastro,
-- igual já faz com assinatura_status/assinatura_expira_em.
alter table public.pagamentos_pendentes
  add column if not exists assinatura_plano text
    check (assinatura_plano is null or assinatura_plano in ('mensal', 'semestral', 'anual')),
  add column if not exists assinatura_ciclo_inicio timestamptz,
  add column if not exists assinatura_valor_mensal_equivalente numeric;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  pendente record;
begin
  insert into public.profiles (
    id, nome, crp, email, cpf, data_nascimento,
    cep, logradouro, numero, complemento, bairro, cidade, uf
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.raw_user_meta_data->>'crp',
    new.email,
    new.raw_user_meta_data->>'cpf',
    nullif(new.raw_user_meta_data->>'data_nascimento', '')::date,
    new.raw_user_meta_data->>'cep',
    new.raw_user_meta_data->>'logradouro',
    new.raw_user_meta_data->>'numero',
    new.raw_user_meta_data->>'complemento',
    new.raw_user_meta_data->>'bairro',
    new.raw_user_meta_data->>'cidade',
    new.raw_user_meta_data->>'uf'
  );

  select * into pendente
  from public.pagamentos_pendentes
  where email = new.email and not processado
  order by criado_em desc
  limit 1;

  if found then
    update public.profiles
    set
      assinatura_status = pendente.assinatura_status,
      assinatura_expira_em = pendente.assinatura_expira_em,
      mp_preapproval_id = pendente.mp_preapproval_id,
      assinatura_plano = pendente.assinatura_plano,
      assinatura_ciclo_inicio = pendente.assinatura_ciclo_inicio,
      assinatura_valor_mensal_equivalente = pendente.assinatura_valor_mensal_equivalente,
      creditos_ia = creditos_ia + coalesce(pendente.valor, 0) / 5.08
    where id = new.id;

    update public.pagamentos_pendentes
    set processado = true
    where email = new.email and not processado;
  end if;

  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- Infraestrutura de cron (pg_cron + pg_net) — não existe nenhum job
-- agendado neste projeto ainda. Necessário porque o fim do ciclo
-- semestral/anual não gera webhook nenhum do Mercado Pago por si só (a
-- preapproval já cobrou sua única repetição meses atrás); alguém precisa
-- checar todo dia quem está chegando no fim do ciclo pago.
-- ═══════════════════════════════════════════════════════════════════════
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- IMPORTANTE — passo manual único, fora desta migration: antes desse job
-- rodar de verdade, alguém precisa criar o segredo compartilhado no Vault
-- (só uma vez, direto no SQL Editor do painel — não vai pro git):
--   select vault.create_secret('<um-valor-aleatorio-qualquer>', 'assinatura_cron_secret');
-- E configurar o MESMO valor como secret da Edge Function:
--   npx supabase secrets set ASSINATURA_CRON_SECRET=<o-mesmo-valor-aleatorio>
select cron.schedule(
  'assinatura-processar-ciclo-diario',
  '0 9 * * *', -- todo dia às 9h UTC (6h em Brasília)
  $$
  select net.http_post(
    url := 'https://iahtyvqjgukdgrftpyxm.supabase.co/functions/v1/assinatura-processar-ciclo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'assinatura_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
