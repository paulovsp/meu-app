-- A conta de demonstração não pode ser alterada por quem a visita.
--
-- O perfil do consultório fictício (oseusig@gmail.com) vai ter a senha
-- publicada na tela de entrada, para que qualquer pessoa possa conhecer o
-- app antes de se cadastrar. Isso significa que o login dela é, na
-- prática, público.
--
-- Sem trava, o primeiro visitante curioso apaga as 67 sessões, ou escreve
-- qualquer coisa numa ficha, e o próximo encontra a amostra destruída.
-- Não é nem má-fé: quem está explorando um app clica em tudo, inclusive em
-- "excluir".
--
-- ── Por que RLS restritiva, e não checagem no app ─────────────────────
--
-- Esconder os botões no app resolve o acidente e não resolve o resto: a
-- chave publishable e a URL do projeto estão dentro do app, e qualquer
-- pessoa com um terminal escreve direto no PostgREST. Uma política
-- RESTRICTIVE é avaliada junto com as permissivas existentes, em E lógico:
-- a conta continua enxergando tudo (leitura intacta) e não escreve nada,
-- venha a tentativa de onde vier.
--
-- A leitura fica livre de propósito — é justamente o que a demonstração
-- precisa fazer.

alter table public.profiles
  add column if not exists conta_demonstracao boolean not null default false;

comment on column public.profiles.conta_demonstracao is
  'Conta de amostra pública: login divulgado, somente leitura. Ver migration 0097.';

update public.profiles set conta_demonstracao = true where email = 'oseusig@gmail.com';

-- `stable` e não `volatile`: o planejador chama isto uma vez por consulta
-- em vez de uma vez por linha. Numa tabela com centenas de compromissos a
-- diferença aparece.
create or replace function public.eh_conta_demonstracao()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select conta_demonstracao from public.profiles where id = auth.uid()),
    false
  );
$$;

-- Três políticas restritivas por tabela: INSERT, UPDATE e DELETE.
--
-- NÃO se usa `for all` aqui. Política restritiva é avaliada em E com as
-- outras, e uma restritiva `for all` alcançaria também o SELECT — a conta
-- de demonstração ficaria sem conseguir LER, que é a única coisa que ela
-- precisa fazer. E não adianta criar depois uma restritiva de leitura
-- liberando: restritivas se somam, nunca se anulam.
do $$
declare
  t text;
  tabelas text[] := array[
    'patients', 'sessions', 'records', 'appointments', 'appointment_participantes',
    'availability_slots', 'slot_participantes', 'despesas_consultorio', 'pagamentos',
    'cursos', 'afazeres', 'relatorios', 'autorizacoes_transcricao',
    'patient_paralizacoes', 'horarios_liberados', 'integracoes_videochamada',
    'integracoes_whatsapp', 'whatsapp_comprovantes', 'transcript_turns',
    'nucleos_evidencias', 'nucleos_perguntas', 'nucleos_snapshots',
    'nucleos_transicoes', 'objetivo_evidencias', 'profiles'
  ];
begin
  foreach t in array tabelas loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I', 'demo_sem_insert_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'demo_sem_update_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'demo_sem_delete_' || t, t);
    -- Nome antigo, de uma tentativa anterior que bloqueava leitura junto.
    execute format('drop policy if exists %I on public.%I', 'demo_sem_escrita_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'demo_pode_ler_' || t, t);

    execute format($f$
      create policy %I on public.%I as restrictive for insert to authenticated
        with check (not public.eh_conta_demonstracao())
    $f$, 'demo_sem_insert_' || t, t);

    execute format($f$
      create policy %I on public.%I as restrictive for update to authenticated
        using (not public.eh_conta_demonstracao())
        with check (not public.eh_conta_demonstracao())
    $f$, 'demo_sem_update_' || t, t);

    execute format($f$
      create policy %I on public.%I as restrictive for delete to authenticated
        using (not public.eh_conta_demonstracao())
    $f$, 'demo_sem_delete_' || t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
