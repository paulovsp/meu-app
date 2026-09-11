-- Funções que respondiam a quem não está logado.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 1. A guarda da 0095 tinha um buraco: o anônimo
-- ═══════════════════════════════════════════════════════════════════════
-- `assinatura_ativa`, `indicados_ativos` e `desconto_por_indicacoes`
-- ganharam na 0095 a guarda "quem está autenticado só pergunta sobre si":
--
--     if auth.uid() is not null and auth.uid() <> uid then raise
--
-- Para o servidor (service_role), `auth.uid()` é nulo e a guarda deixa
-- passar — certo. Mas para a chave anônima `auth.uid()` TAMBÉM é nulo, e
-- a guarda deixava passar do mesmo jeito. Com a chave publishable, que
-- está dentro do app, dava para perguntar sem login se qualquer conta
-- assina o Dr.Sig. Provado na auditoria: `assinatura_ativa(<id>)` como
-- anon respondeu `true`.
--
-- A distinção certa não é "tem uid ou não", é "chegou pela API com que
-- papel". `auth.role()` diz isso: `anon` e `authenticated` são a API
-- pública; `service_role` é o servidor; nulo é acesso direto ao banco
-- (migrations, painel). Só os dois primeiros são de fora.
--
-- E, além da guarda, o EXECUTE some do anon: função que não faz sentido
-- sem login não deveria nem ser chamável sem login.

create or replace function public.assinatura_ativa(uid uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.role() in ('anon', 'authenticated') and auth.uid() is distinct from uid then
    raise exception 'Consulta não permitida.' using errcode = '42501';
  end if;
  return exists (
    select 1 from public.profiles
    where id = uid
      and (
        (assinatura_status in ('ativa', 'cortesia', 'cancelada', 'inadimplente')
          and assinatura_expira_em > now())
        or assinatura_status = 'gratuita_indicacao'
      )
  );
end;
$$;

create or replace function public.indicados_ativos(uid uuid)
returns integer
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.role() in ('anon', 'authenticated') and auth.uid() is distinct from uid then
    raise exception 'Consulta não permitida.' using errcode = '42501';
  end if;
  return (
    select count(*)::int
    from public.profiles
    where indicado_por = uid
      and assinatura_status in ('ativa', 'cortesia')
      and assinatura_expira_em > now()
  );
end;
$$;

create or replace function public.desconto_por_indicacoes(uid uuid)
returns integer
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.role() in ('anon', 'authenticated') and auth.uid() is distinct from uid then
    raise exception 'Consulta não permitida.' using errcode = '42501';
  end if;
  if not coalesce((select elegivel_indicacao from public.profiles where id = uid), false) then
    return 0;
  end if;
  return least(public.indicados_ativos(uid) * 10, 100);
end;
$$;

revoke execute on function public.assinatura_ativa(uuid) from anon;
revoke execute on function public.indicados_ativos(uuid) from anon;
revoke execute on function public.desconto_por_indicacoes(uuid) from anon;
-- Estas duas só existem para o banco e o servidor. O app nunca as chama.
revoke execute on function public.gerar_codigo_indicacao() from anon, authenticated;
revoke execute on function public.eh_conta_demonstracao() from anon;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. `cpf_disponivel` era um oráculo de CPF sem login
-- ═══════════════════════════════════════════════════════════════════════
-- A tela de cadastro perguntava "este CPF já tem conta?" antes de criar a
-- conta — e a função respondia a qualquer um, sem login, sem limite de
-- tentativas. Num app de psicanálise, "este CPF é cliente do Dr.Sig" é
-- informação sobre a pessoa, e estava disponível a quem tivesse a chave
-- publishable (que está dentro do app).
--
-- Não existe versão segura dessa pergunta feita por um anônimo. O que
-- garante o CPF único continua sendo o índice `profiles_cpf_unique_idx`
-- (0020), que falha dentro do trigger de criação da conta; a tela passa a
-- tratar essa falha com uma mensagem que não confirma nem nega nada sobre
-- o CPF.
drop function if exists public.cpf_disponivel(text);

notify pgrst, 'reload schema';
