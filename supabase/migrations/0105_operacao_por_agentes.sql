-- Fundação da operação por agentes: as tabelas que eles leem e escrevem.
--
-- Até aqui, uma falha numa Edge Function virava `console.error` num log
-- que ninguém abre; um pagamento sem dono ia para uma tabela que ninguém
-- consulta; um feedback de usuária ficava na caixa de e-mail. Nada disso
-- é visível de um lugar só. As tabelas `op_*` são esse lugar: código
-- comum grava, agentes leem e propõem, o dono decide.
--
-- Só o servidor lê e escreve: nenhuma delas diz respeito ao app.

-- Tudo que deu errado, com origem e contexto. Escrito pelo envoltório
-- `servir()` de _shared/registrarEvento.ts em toda Edge Function, e pelo
-- webhook da Resend.
create table if not exists public.op_eventos (
  id bigint generated always as identity primary key,
  origem text not null,                 -- nome da função ou do coletor
  severidade text not null check (severidade in ('info', 'aviso', 'erro', 'critico')),
  mensagem text not null,
  contexto jsonb,
  criado_em timestamptz not null default now(),
  tratado_em timestamptz               -- quando um agente o incorporou a um incidente ou descartou
);
create index if not exists op_eventos_criado_em_idx on public.op_eventos (criado_em desc);
create index if not exists op_eventos_pendentes_idx on public.op_eventos (criado_em desc) where tratado_em is null;

-- Um problema reconhecido, do início ao fim.
create table if not exists public.op_incidentes (
  id bigint generated always as identity primary key,
  titulo text not null,
  severidade text not null check (severidade in ('aviso', 'erro', 'critico')),
  status text not null default 'aberto' check (status in ('aberto', 'em_correcao', 'aguardando_dono', 'fechado')),
  origem text,
  resumo text,                          -- o que se sabe, escrito pelo agente
  evento_ids bigint[] default '{}',
  pr_url text,
  aberto_por text not null,             -- 'vigia', 'zelador', 'dono'…
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  fechado_em timestamptz
);

-- Sugestões e melhorias, com quem pediu.
create table if not exists public.op_backlog (
  id bigint generated always as identity primary key,
  titulo text not null,
  descricao text,
  origem text not null,                 -- 'feedback', 'avaliacao_play', 'agente', 'dono'
  autora_email text,
  status text not null default 'novo' check (status in ('novo', 'aceito', 'em_andamento', 'feito', 'descartado')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- O que as usuárias dizem: e-mails recebidos e avaliações da loja.
create table if not exists public.op_feedbacks (
  id bigint generated always as identity primary key,
  canal text not null check (canal in ('email', 'play', 'manual')),
  de_email text,
  de_nome text,
  assunto text,
  corpo text not null,
  recebido_em timestamptz not null default now(),
  classificacao text check (classificacao in ('bug', 'sugestao', 'duvida', 'elogio', 'outro')),
  resposta_rascunho text,               -- o que o agente propõe responder; o dono envia
  incidente_id bigint references public.op_incidentes(id) on delete set null,
  backlog_id bigint references public.op_backlog(id) on delete set null,
  tratado_em timestamptz
);

-- O funil, um dia por linha e por origem — alimentado pela contagem
-- diária (cadastros, assinaturas) e, quando a API do Play estiver ligada,
-- pelas instalações.
create table if not exists public.op_funil (
  dia date not null,
  origem text not null default 'desconhecida',
  instalacoes integer,
  cadastros integer not null default 0,
  assinaturas integer not null default 0,
  cancelamentos integer not null default 0,
  primary key (dia, origem)
);

-- Cada rodada de agente deixa uma linha: o que rodou, quando, o que achou.
create table if not exists public.op_rodadas (
  id bigint generated always as identity primary key,
  agente text not null,
  iniciada_em timestamptz not null default now(),
  concluida_em timestamptz,
  resultado text,                       -- 'verde', 'amarelo', 'vermelho', 'erro'
  relatorio_path text,                  -- caminho do Markdown no repositório
  resumo text
);

do $$
declare t text;
begin
  foreach t in array array['op_eventos', 'op_incidentes', 'op_backlog', 'op_feedbacks', 'op_funil', 'op_rodadas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ── De onde a pessoa veio ─────────────────────────────────────────────
-- Sem isto, a divulgação não tem como saber o que funcionou. A tela de
-- cadastro passa a perguntar (opcional), e o trigger grava.
alter table public.profiles add column if not exists origem_cadastro text;
comment on column public.profiles.origem_cadastro is
  'Resposta à pergunta "como você conheceu o Dr.Sig?" no cadastro: instagram, google, indicacao, instituto, outro. Ver migration 0105.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  codigo_informado text;
  quem_indicou uuid;
  contas_existentes int;
  convite public.convites_cortesia%rowtype;
begin
  codigo_informado := upper(regexp_replace(
    coalesce(new.raw_user_meta_data->>'codigo_indicacao', ''), '[^A-Za-z0-9]', '', 'g'));

  if codigo_informado <> '' then
    select id into quem_indicou
    from public.profiles
    where codigo_indicacao = codigo_informado
    limit 1;
  end if;

  select count(*) into contas_existentes from public.profiles;

  insert into public.profiles (
    id, nome, crp, email, cpf, telefone, data_nascimento,
    cep, logradouro, numero, complemento, bairro, cidade, uf,
    codigo_indicacao, indicado_por, elegivel_indicacao, origem_cadastro
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.raw_user_meta_data->>'crp',
    new.email,
    new.raw_user_meta_data->>'cpf',
    new.raw_user_meta_data->>'telefone',
    nullif(new.raw_user_meta_data->>'data_nascimento', '')::date,
    new.raw_user_meta_data->>'cep',
    new.raw_user_meta_data->>'logradouro',
    new.raw_user_meta_data->>'numero',
    new.raw_user_meta_data->>'complemento',
    new.raw_user_meta_data->>'bairro',
    new.raw_user_meta_data->>'cidade',
    new.raw_user_meta_data->>'uf',
    public.gerar_codigo_indicacao(),
    quem_indicou,
    contas_existentes < 100,
    nullif(new.raw_user_meta_data->>'origem_cadastro', '')
  );

  -- Convite de cortesia (0103): a conta já nasce liberada.
  select * into convite
  from public.convites_cortesia
  where lower(email) = lower(new.email)
    and usado_em is null
    and valido_ate > now()
  limit 1;

  if found then
    update public.profiles
    set assinatura_status = 'cortesia',
        assinatura_expira_em = convite.valido_ate,
        assinatura_plano = 'anual',
        assinatura_ciclo_inicio = now(),
        assinatura_valor_mensal_equivalente = 0,
        creditos_ia = coalesce(creditos_ia, 0) + convite.creditos_brl / 5.08,
        proxima_renovacao_credito = (current_date + interval '1 month')::date
    where id = new.id;

    update public.convites_cortesia
    set usado_em = now(), usado_por = new.id
    where email = convite.email;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
