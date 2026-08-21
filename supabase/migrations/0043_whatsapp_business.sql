-- Integração com WhatsApp Business API oficial (item 13, v13) — opcional,
-- por profissional. Só quem já tem conta comercial verificada na Meta
-- consegue usar: cola aqui o Phone Number ID e o token de acesso permanente
-- da própria conta (gerados no painel da Meta for Developers). A leitura de
-- mensagens roda por uma única Edge Function (whatsapp-webhook) compartilhada
-- — cada profissional configura essa mesma URL como webhook na sua própria
-- conta Meta, e o payload que chega diz de qual phone_number_id veio, então
-- a função sabe a qual profissional aquela mensagem pertence.
alter table public.profiles
  add column if not exists whatsapp_phone_number_id text,
  add column if not exists whatsapp_access_token text;

-- Comprovantes que chegaram por WhatsApp e foram lidos por OCR (mesmo
-- serviço já usado na autorização de gravação). Nunca marca pagamento como
-- recebido sozinho — só sinaliza pra profissional revisar e confirmar no
-- app, evitando falso positivo virar dinheiro "recebido" que não foi. A
-- imagem em si nunca é armazenada (mesma política de privacidade do OCR de
-- autorização) — só o texto extraído e os sinais (valor) que o OCR
-- conseguiu ler dele.
create table if not exists public.whatsapp_comprovantes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  telefone_remetente text not null,
  texto_extraido text,
  valor_detectado numeric,
  status text not null default 'pendente' check (status in ('pendente', 'confirmado', 'ignorado')),
  criado_em timestamptz not null default now(),
  revisado_em timestamptz
);

create index if not exists whatsapp_comprovantes_user_id_idx on public.whatsapp_comprovantes(user_id);
create index if not exists whatsapp_comprovantes_status_idx on public.whatsapp_comprovantes(status);

alter table public.whatsapp_comprovantes enable row level security;

-- A profissional só lê e revisa (confirma/ignora) as próprias — nunca cria
-- direto: só a Edge Function (service_role, ignora RLS) insere, depois de
-- validar o webhook e rodar o OCR.
create policy "whatsapp_comprovantes_select_own" on public.whatsapp_comprovantes
  for select to authenticated using (user_id = auth.uid());

create policy "whatsapp_comprovantes_update_own" on public.whatsapp_comprovantes
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, update on public.whatsapp_comprovantes to authenticated;
