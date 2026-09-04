-- Transcrição em blocos.
--
-- Motivo (investigação de 03/09/2026): uma gravação de 50 min falhou no
-- envio e uma aula de 4h seria impossível pela arquitetura antiga — o áudio
-- ia como texto base64 dentro de um JSON, e a Edge Function precisava fazer
-- parse + decodificação, puro CPU, contra o teto de 2s da Supabase.
-- Medido na linha exata que era usada: 10 min = 473ms (passa), 38 min =
-- 1859ms (no limite), 50 min = 2448ms (estoura).
--
-- A correção tem duas partes. (1) O áudio passa a ser enviado como binário
-- puro, repassado adiante sem a function tocar nos bytes — some o custo de
-- CPU. (2) Gravações acima de 1h são gravadas em BLOCOS de até 1h: o .m4a
-- só é finalizado ao parar a gravação, então uma aula de 4h num arquivo só
-- vira lixo irrecuperável se o app for morto no minuto 200. Em blocos,
-- perde-se no máximo o bloco corrente, e os anteriores já foram enviados.
--
-- Esta tabela acompanha cada bloco até a AssemblyAI devolver o texto. O
-- caso de arquivo único (até 1h) é só um caso particular com total = 1,
-- então existe UM caminho de código só, não dois.
--
-- Serve tanto sessão quanto curso: aula de 2-4h é justamente onde blocos
-- mais importam, e duplicar a tabela obrigaria a duplicar também a lógica
-- de montagem nos dois webhooks.
create table if not exists public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete cascade,
  curso_id uuid references public.cursos(id) on delete cascade,
  -- Ordem do bloco dentro da gravação (0-based). A montagem final do texto
  -- respeita esta ordem, não a ordem de chegada dos webhooks (que a
  -- AssemblyAI não garante).
  indice integer not null,
  -- Quantos blocos a gravação tem no total. Fica 0 enquanto a gravação
  -- ainda está em andamento: o app envia cada bloco assim que ele fecha,
  -- e só no último é que sabe quantos foram. Quando o total definitivo
  -- chega, ele é gravado em todos os blocos da mesma gravação. O webhook
  -- só monta o texto quando o total é > 0 e todos os blocos chegaram.
  total integer not null default 0,
  assemblyai_transcript_id text,
  texto text,
  status text not null default 'processando'
    check (status in ('processando', 'concluida', 'erro')),
  criado_em timestamptz not null default now(),
  -- Exatamente um dono: ou sessão, ou curso.
  constraint transcript_segments_dono_unico check (
    (session_id is not null and curso_id is null)
    or (session_id is null and curso_id is not null)
  )
);

-- Um bloco por índice em cada gravação — é o que deixa o reenvio de um
-- bloco que falhou ser idempotente (upsert na mesma linha).
create unique index if not exists transcript_segments_sessao_indice_idx
  on public.transcript_segments(session_id, indice) where session_id is not null;
create unique index if not exists transcript_segments_curso_indice_idx
  on public.transcript_segments(curso_id, indice) where curso_id is not null;

-- O webhook chega sabendo só o transcript_id da AssemblyAI — é por aqui que
-- ele encontra a qual bloco/gravação aquele texto pertence.
create index if not exists transcript_segments_assemblyai_idx
  on public.transcript_segments(assemblyai_transcript_id);

alter table public.transcript_segments enable row level security;

drop policy if exists "transcript_segments_select_own" on public.transcript_segments;
create policy "transcript_segments_select_own" on public.transcript_segments
  for select to authenticated
  using (
    (session_id is not null and public.owns_session(session_id))
    or (curso_id is not null and exists (
      select 1 from public.cursos c
      where c.id = transcript_segments.curso_id and c.user_id = auth.uid()
    ))
  );

grant select on public.transcript_segments to authenticated;

-- As functions de transcrição criam o bloco e os webhooks o completam; as
-- quatro rodam com service_role. Sem GRANT explícito o service_role esbarra
-- em "permission denied" — exatamente o bug que travou toda a transcrição
-- em 24/08 e virou a migration 0053. Não repetir.
grant select, insert, update, delete on public.transcript_segments to service_role;
