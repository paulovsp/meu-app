-- Ordem manual dos afazeres (arrastar pra organizar).
--
-- Até aqui a lista era ordenada pelo app: concluídos no fim, e dentro
-- disso o mais recente primeiro. Nenhuma das duas é a ordem que a pessoa
-- quer — numa lista de afazeres, prioridade é decisão de quem escreveu,
-- não do carimbo de criação.
--
-- `ordem` passa a ser a única ordenação. Isso tira o agrupamento
-- automático por `concluido` de propósito: as duas coisas não convivem —
-- marcar um item como feito e ver ele pular de lugar desfaz justamente a
-- organização que a pessoa acabou de montar. Item concluído fica onde
-- está, riscado.
alter table public.afazeres
  add column if not exists ordem integer;

-- Backfill preservando exatamente o que a tela mostra hoje, pra que
-- ninguém abra o app depois da atualização e encontre a lista embaralhada.
with atual as (
  select id,
         row_number() over (
           partition by user_id
           order by concluido asc, criado_em desc
         ) as pos
  from public.afazeres
)
update public.afazeres a
set ordem = atual.pos
from atual
where a.id = atual.id and a.ordem is null;

create index if not exists afazeres_user_ordem_idx on public.afazeres(user_id, ordem);

-- Gravar a lista inteira de uma vez, numa transação só.
--
-- Deliberadamente uma função e não um upsert do PostgREST: upsert em massa
-- foi exatamente o que custou seis migrations no WhatsApp (0067-0073) antes
-- de virar RPC. Aqui já nasce assim.
--
-- `security invoker`: roda como a própria usuária, então a RLS de
-- `afazeres` continua valendo. O `user_id = auth.uid()` no where é
-- redundante com a policy — e fica, porque uma função que reordena a
-- lista de outra pessoa é o tipo de erro que não se quer depender de uma
-- camada só pra evitar.
create or replace function public.reordenar_afazeres(p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.afazeres a
  set ordem = pos.i
  from unnest(p_ids) with ordinality as pos(id, i)
  where a.id = pos.id
    and a.user_id = auth.uid();
end;
$$;

grant execute on function public.reordenar_afazeres(uuid[]) to authenticated;

notify pgrst, 'reload schema';
