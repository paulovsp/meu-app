-- Verificação do bloqueio de autocadastro (0076/0077). Não muda schema.
--
-- Existe porque uma regra de integridade que ninguém testou é uma regra que
-- talvez não exista: um trigger com a condição invertida, um `security
-- definer` sem permissão de ler `profiles`, uma isenção que não casa — tudo
-- isso falha em silêncio, e só apareceria quando a pessoa já estivesse
-- travada (ou já tivesse passado).
--
-- Testa os dois lados contra a conta real, e derruba a migration se algum
-- deles estiver errado. Nada é gravado: as duas tentativas acontecem em
-- subtransações que sempre voltam atrás.
do $$
declare
  dev      uuid;
  dev_cpf  text;
  dev_nome text;
begin
  select id, cpf, nome into dev, dev_cpf, dev_nome
  from public.profiles
  where email = 'paulovsp@gmail.com'
  limit 1;

  if dev is null then
    raise exception 'Conta de desenvolvimento não encontrada — verificação impossível.';
  end if;
  if dev_cpf is null then
    raise exception 'Conta de desenvolvimento sem CPF no perfil — a isenção por CPF da 0076 não tem alvo, e este teste não conclui nada.';
  end if;

  -- ── 1. A conta isenta CONTINUA podendo se cadastrar ──────────────────
  -- É a brecha proposital, usada pra testar o fluxo de autorização sem
  -- depender de um terceiro. Se isto quebrar, o teste do app quebra junto.
  begin
    insert into public.patients (user_id, nome, cpf)
    values (dev, 'Verificacao Isencao', dev_cpf);
    raise exception 'desfazer';
  exception
    when others then
      if sqlerrm <> 'desfazer' then
        raise exception 'ISENÇÃO QUEBRADA: a conta isenta foi bloqueada (%)', sqlerrm;
      end if;
  end;

  -- ── 2. Sem isenção, o mesmo cadastro é RECUSADO ──────────────────────
  begin
    delete from public.isencoes_autocadastro where user_id = dev;

    begin
      insert into public.patients (user_id, nome, cpf)
      values (dev, 'Verificacao Bloqueio', dev_cpf);
      raise exception 'BLOQUEIO FURADO: cadastro com o CPF do titular foi aceito.';
    exception
      when others then
        if sqlerrm <> 'AUTOCADASTRO' then raise; end if;
    end;

    -- E também pelo nome, quando não há CPF que prove ser outra pessoa.
    begin
      insert into public.patients (user_id, nome, cpf)
      values (dev, dev_nome, null);
      raise exception 'BLOQUEIO FURADO: cadastro com o nome do titular e sem CPF foi aceito.';
    exception
      when others then
        if sqlerrm <> 'AUTOCADASTRO' then raise; end if;
    end;

    -- Homônimo COM CPF próprio precisa continuar passando: bloquear aqui
    -- seria quebrar cadastro legítimo (pai e filho, nome comum).
    begin
      insert into public.patients (user_id, nome, cpf)
      values (dev, dev_nome, '00000000191');
      raise exception 'desfazer';
    exception
      when others then
        if sqlerrm <> 'desfazer' then
          raise exception 'FALSO POSITIVO: homônimo com CPF diferente foi bloqueado (%)', sqlerrm;
        end if;
    end;

    raise exception 'desfazer';
  exception
    when others then
      if sqlerrm <> 'desfazer' then raise; end if;
  end;

  raise notice 'Bloqueio de autocadastro verificado: isenção vale, CPF e nome do titular são recusados, homônimo com CPF próprio passa.';
end $$;
