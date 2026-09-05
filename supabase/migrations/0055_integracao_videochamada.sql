-- Integração com Google Meet (e, depois, Zoom): a sessão online passa a
-- poder ser transcrita pelo próprio provedor da chamada, em vez de gravada
-- pelo microfone do aparelho.
--
-- Motivo: a causa raiz das gravações que voltavam mudas é que o Android
-- entrega o microfone pro app que está em chamada e SILENCIA o nosso — não
-- tem conserto do lado do app. Puxando o texto direto do Meet, não existe
-- gravação nossa, então o conflito deixa de existir. De quebra a
-- transcrição sai sem custo de AssemblyAI, porque quem transcreve é o
-- Google.
--
-- Só funciona em sala criada pelo próprio app: o escopo meetings.space.created
-- dá acesso apenas às salas que o app criou. Por isso a sessão online passa
-- a nascer no Dr.Sig, que gera o link.

-- ─── Contas de videochamada conectadas ──────────────────────────────────
create table if not exists public.integracoes_videochamada (
  user_id uuid not null references auth.users(id) on delete cascade,
  provedor text not null check (provedor in ('google_meet', 'zoom')),
  -- Conta que autorizou, só pra mostrar na tela ("conectado como ...").
  conta_email text,
  -- Segredo. NUNCA é concedido select disto pro app (ver grants abaixo):
  -- quem usa é só a Edge Function, com service_role.
  refresh_token text,
  -- Resultado do teste de capacidade feito no momento da conexão: nem todo
  -- plano do Google gera transcrição automática (precisa de Business Plus,
  -- Enterprise Standard/Plus, Education Plus ou Enterprise Essentials).
  -- Guardado pra tela poder avisar ANTES de a pessoa tentar usar, em vez de
  -- falhar depois da sessão — que é quando o prejuízo já aconteceu.
  transcricao_automatica_disponivel boolean,
  capacidade_verificada_em timestamptz,
  conectado_em timestamptz not null default now(),
  -- Preenchido quando o acesso para de funcionar (token revogado, ou
  -- expirado — enquanto o app OAuth está em "Testing" no Google, o refresh
  -- token dura só 7 dias). A tela usa isto pra pedir reconexão em vez de
  -- deixar a pessoa achar que está tudo certo.
  invalidado_em timestamptz,
  invalidado_motivo text,
  primary key (user_id, provedor)
);

alter table public.integracoes_videochamada enable row level security;

drop policy if exists "integracoes_select_own" on public.integracoes_videochamada;
create policy "integracoes_select_own" on public.integracoes_videochamada
  for select to authenticated using (user_id = auth.uid());

-- Desconectar é do usuário; conectar/atualizar é só do servidor (é lá que o
-- refresh_token é obtido e guardado).
drop policy if exists "integracoes_delete_own" on public.integracoes_videochamada;
create policy "integracoes_delete_own" on public.integracoes_videochamada
  for delete to authenticated using (user_id = auth.uid());

-- GRANT por COLUNA: `refresh_token` fica de fora de propósito, então o app
-- simplesmente não tem como lê-lo, nem com a sessão legítima do dono.
grant select (
  user_id, provedor, conta_email, transcricao_automatica_disponivel,
  capacidade_verificada_em, conectado_em, invalidado_em, invalidado_motivo
) on public.integracoes_videochamada to authenticated;
grant delete on public.integracoes_videochamada to authenticated;

-- Lição repetida das migrations 0011/0013/0026/0037/0053: RLS habilitada não
-- basta, service_role precisa de GRANT explícito.
grant select, insert, update, delete on public.integracoes_videochamada to service_role;

-- ─── Sessão: de onde veio a transcrição ─────────────────────────────────
alter table public.sessions
  -- Sala criada pelo app pra esta sessão (spaces/xxxx) e o link mostrado
  -- pra profissional enviar ao analisante.
  add column if not exists meet_space_name text,
  add column if not exists meet_meeting_uri text,
  -- Preenchido quando a chamada acontece; é por ele que se pede o texto.
  add column if not exists meet_conference_record text,
  -- 'microfone' = gravado pelo aparelho e transcrito pela AssemblyAI (custa
  -- crédito); 'meet' = texto veio pronto do Google (não custa crédito);
  -- 'manual' = digitado. Sem isto não dá pra saber o que cobrar nem o que
  -- mostrar na tela da sessão.
  add column if not exists transcricao_origem text
    check (transcricao_origem is null
           or transcricao_origem in ('microfone', 'meet', 'zoom', 'manual'));

-- O cron busca exatamente estas: sessão de Meet ainda sem texto.
create index if not exists sessions_meet_pendentes_idx
  on public.sessions(meet_space_name)
  where meet_space_name is not null and transcricao_status = 'processando';

-- ─── O dispositivo de autorização, agora também no servidor ─────────────
-- Até aqui a exigência de autorização do analisante para gravar/transcrever
-- só existia na tela (NovaSessaoScreen bloqueia o botão). A Edge Function
-- ia-transcrever nunca consultou `autorizacoes_transcricao` — quem chamasse
-- a função direto transcrevia sem autorização nenhuma. O curso-transcrever
-- já fazia o certo, conferindo `consentimento_professor` no banco.
--
-- Espelha exatamente a regra da tela (getStatusAutorizacao): vale a
-- solicitação MAIS RECENTE do analisante, e ela precisa estar 'autorizada'.
-- Se a profissional pedir autorização de novo, a nova solicitação fica
-- 'pendente' e volta a bloquear — servidor nunca mais permissivo que a tela.
create or replace function public.gravacao_autorizada(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select a.status = 'autorizada'
       from public.autorizacoes_transcricao a
      where a.patient_local_id = p_patient_id
      order by a.criado_em desc
      limit 1),
    false
  );
$$;

grant execute on function public.gravacao_autorizada(uuid) to authenticated, service_role;
