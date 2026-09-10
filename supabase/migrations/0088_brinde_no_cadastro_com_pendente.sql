-- O trigger de criação de conta creditava o VALOR PAGO inteiro.
--
-- `handle_new_user` cobre o caso em que o pagamento chega antes de a conta
-- existir: o webhook grava em `pagamentos_pendentes` e o cadastro consome
-- essa linha. Só que ele fazia `creditos_ia + pendente.valor / 5.08` — o
-- preço da assinatura convertido em crédito. Quem assinasse o anual
-- entraria com US$ 115 de crédito no lugar dos US$ 1,97 do brinde: quase
-- sessenta vezes o combinado, e por um caminho que ninguém testa porque
-- quase nunca roda.
--
-- O brinde é o mesmo dos outros dois caminhos (webhook e renovar-creditos):
-- R$ 5 / 7 / 10 por mês conforme o plano, à taxa de referência fixa de
-- 5,08. Aqui entra só o primeiro mês, e `proxima_renovacao_credito` marca
-- de onde `renovar-creditos` continua — sem ela o mês seguinte não vinha,
-- e ela é também a guarda que impede creditar duas vezes.

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  pendente record;
  brinde_brl numeric;
begin
  insert into public.profiles (
    id, nome, crp, email, cpf, telefone, data_nascimento,
    cep, logradouro, numero, complemento, bairro, cidade, uf
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.raw_user_meta_data->>'crp',
    new.email,
    new.raw_user_meta_data->>'cpf',
    new.raw_user_meta_data->>'telefone',
    nullif(new.raw_user_meta_data->>'data_nascimento', '')::date,
    new.raw_user_meta_data->>'cep',
    new.raw_user_meta_data->>'logradouro',
    new.raw_user_meta_data->>'numero',
    new.raw_user_meta_data->>'complemento',
    new.raw_user_meta_data->>'bairro',
    new.raw_user_meta_data->>'cidade',
    new.raw_user_meta_data->>'uf'
  );

  select * into pendente
  from public.pagamentos_pendentes
  where email = new.email and not processado
  order by criado_em desc
  limit 1;

  if found then
    brinde_brl := case pendente.assinatura_plano
      when 'mensal' then 5
      when 'semestral' then 7
      when 'anual' then 10
      else 0
    end;

    update public.profiles
    set
      assinatura_status = pendente.assinatura_status,
      assinatura_expira_em = pendente.assinatura_expira_em,
      mp_preapproval_id = pendente.mp_preapproval_id,
      assinatura_plano = pendente.assinatura_plano,
      assinatura_ciclo_inicio = pendente.assinatura_ciclo_inicio,
      assinatura_valor_mensal_equivalente = pendente.assinatura_valor_mensal_equivalente,
      creditos_ia = creditos_ia + brinde_brl / 5.08,
      proxima_renovacao_credito = case
        when brinde_brl > 0 and pendente.assinatura_status = 'ativa'
          then (current_date + interval '1 month')::date
        else proxima_renovacao_credito
      end
    where id = new.id;

    update public.pagamentos_pendentes
    set processado = true
    where email = new.email and not processado;
  end if;

  return new;
end;
$$;
