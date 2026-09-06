-- Ajuste no bloqueio de autocadastro da 0076.
--
-- Como estava, o trigger conferia toda UPDATE do mesmo jeito que uma
-- INSERT. Consequência: uma ficha criada ANTES desta regra existir, com o
-- nome ou o CPF do titular, ficava impossível de editar — nem pra corrigir
-- o CPF errado que a deixou nessa situação, nem pra mexer em qualquer outro
-- campo. O bloqueio trancaria a pessoa do lado de fora do próprio dado.
--
-- Agora, numa UPDATE, só barra quando o nome ou o CPF MUDAM para o do
-- titular. Não abre brecha nenhuma: criar com CPF diferente e depois trocar
-- pelo do titular é exatamente uma mudança, e continua barrado. O que passa
-- a ser possível é editar o telefone de uma ficha que já nasceu torta.
create or replace function public.impedir_autocadastro_analisante()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  titular record;
  cpf_mudou boolean;
  nome_mudou boolean;
begin
  select nome, cpf into titular from public.profiles where id = new.user_id;
  if not found then return new; end if;

  if exists (
    select 1 from public.isencoes_autocadastro i
    where i.user_id = new.user_id
       or (i.cpf is not null and public.cpf_digitos(i.cpf) = public.cpf_digitos(titular.cpf))
  ) then
    return new;
  end if;

  cpf_mudou := tg_op = 'INSERT'
    or public.cpf_digitos(new.cpf) is distinct from public.cpf_digitos(old.cpf);
  nome_mudou := tg_op = 'INSERT'
    or public.nome_normalizado(new.nome) is distinct from public.nome_normalizado(old.nome);

  -- CPF igual é a prova direta: é a mesma pessoa, não há segunda leitura.
  if cpf_mudou
     and public.cpf_digitos(new.cpf) is not null
     and public.cpf_digitos(new.cpf) = public.cpf_digitos(titular.cpf) then
    raise exception 'AUTOCADASTRO'
      using hint = 'Este CPF é o do titular da conta.';
  end if;

  -- Nome igual só bloqueia quando NÃO há CPF que prove o contrário. Com um
  -- CPF diferente informado, homônimo é homônimo — bloquear aí quebraria
  -- cadastro legítimo (pai e filho, nome comum). Sem CPF, o nome é tudo o
  -- que existe, e é justamente por onde a brecha voltaria.
  if (nome_mudou or cpf_mudou)
     and public.cpf_digitos(new.cpf) is null
     and public.nome_normalizado(new.nome) is not null
     and public.nome_normalizado(new.nome) = public.nome_normalizado(titular.nome) then
    raise exception 'AUTOCADASTRO'
      using hint = 'Este nome é o do titular da conta. Informe o CPF do analisante se for outra pessoa.';
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
