-- Foto de fundo do cabeçalho do Perfil (item 9), além da foto de perfil já
-- existente (migration 0028) — mesmo bucket "avatars", mesmo dono, só um
-- path diferente ("<user_id>/capa.jpg"); as policies de storage já
-- cobrem qualquer arquivo dentro da pasta do usuário, então não precisam
-- de policy nova.
alter table public.profiles add column if not exists capa_url text;
