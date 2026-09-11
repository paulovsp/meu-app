-- Fecha as duas portas que sobraram na auditoria.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 1. O cache de cotação era escrito por qualquer usuário
-- ═══════════════════════════════════════════════════════════════════════
-- `cotacoes_cache` tem uma linha por moeda e é de TODO MUNDO: é dele que
-- saem as conversões de preço de sessão em moeda estrangeira nos cálculos
-- financeiros de todos os usuários. As políticas diziam `with_check:
-- true` — qualquer autenticado podia gravar o valor que quisesse.
--
-- Não dá acesso nem dinheiro a ninguém, e por isso é fácil subestimar: o
-- estrago é no livro-caixa dos OUTROS. Quem usa o app para fechar o mês
-- veria números errados sem nada indicando por quê.
--
-- A escrita passa a ser só do servidor, pela Edge Function
-- `cotacao-atualizar`, que busca o valor no Banco Central. O app continua
-- lendo à vontade e continua podendo pedir atualização — ele só não diz
-- mais QUANTO a moeda vale.
drop policy if exists cotacoes_insert_auth on public.cotacoes_cache;
drop policy if exists cotacoes_update_auth on public.cotacoes_cache;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Dava para perguntar sobre a conta dos outros
-- ═══════════════════════════════════════════════════════════════════════
-- `assinatura_ativa`, `indicados_ativos` e `desconto_por_indicacoes` são
-- SECURITY DEFINER e recebem o `uid` como parâmetro — elas rodam com
-- privilégio total e respondem sobre QUALQUER conta. Com o id de outra
-- pessoa dava pra saber se ela assina o Dr.Sig e quantas indicações tem.
--
-- Na prática era pouco, porque o id alheio não é descobrível pelo app (a
-- leitura de `profiles` é só da própria linha). Mas "difícil de descobrir"
-- não é uma proteção — é a falta de uma.
--
-- A guarda é a mesma nas três: quem está autenticado só pergunta sobre si.
-- O servidor (service_role, onde `auth.uid()` é nulo) continua podendo
-- perguntar sobre qualquer conta — é ele que aplica desconto e libera
-- acesso.

create or replace function public.assinatura_ativa(uid uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() <> uid then
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
  if auth.uid() is not null and auth.uid() <> uid then
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
  if auth.uid() is not null and auth.uid() <> uid then
    raise exception 'Consulta não permitida.' using errcode = '42501';
  end if;
  if not coalesce((select elegivel_indicacao from public.profiles where id = uid), false) then
    return 0;
  end if;
  return least(public.indicados_ativos(uid) * 10, 100);
end;
$$;

notify pgrst, 'reload schema';
