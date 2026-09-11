-- ═══════════════════════════════════════════════════════════════════════
-- Consultório de demonstração — fichas e agenda
-- ═══════════════════════════════════════════════════════════════════════
--
-- Conta: oseusig@gmail.com (Sigmund Freud). É o perfil que qualquer pessoa
-- pode abrir para conhecer o app antes de se cadastrar, e por isso ele
-- precisa parecer um consultório em funcionamento — não uma tela de
-- demonstração com três linhas de exemplo.
--
-- Tudo aqui é FICTÍCIO. Os nomes são os casos clínicos publicados por
-- Freud e os membros da Sociedade Psicológica das Quartas-Feiras; as datas
-- de nascimento são contemporâneas, então as anotações falam de um
-- consultório de hoje que ecoa aquele material, sem fingir ser 1895.
--
-- ── A semana ──────────────────────────────────────────────────────────
--
-- Análise cinco vezes por semana, de segunda a sexta, no mesmo horário —
-- que é o enquadre clássico e o que dá sentido ao histórico de sessões que
-- o app mostra. Supervisão uma vez por semana.
--
-- Pequeno Hans é a exceção, duas vezes por semana: análise de criança não
-- segue a frequência de adulto, e ele é atendido com o pai presente.
--
-- Ferenczi e Stekel aparecem nos DOIS papéis — análise de segunda a sexta
-- e supervisão no sábado. É historicamente correto (os dois foram
-- analisados por Freud, ao contrário de Jung, Adler, Rank e Jones) e serve
-- de exemplo vivo de uma ficha que é analisante e supervisionando ao mesmo
-- tempo.
--
-- Reexecutável: apaga a agenda da conta antes de reconstruir.

do $$
declare
  freud uuid;
begin
  select id into freud from public.profiles where email = 'oseusig@gmail.com';
  if freud is null then
    raise exception 'Conta de demonstração (oseusig@gmail.com) não encontrada.';
  end if;

  -- ═══════════════════════════════════════════════════════════════════
  -- 1. Fichas: o que estava em branco
  -- ═══════════════════════════════════════════════════════════════════
  update public.patients set
    modalidade = 'presencial',
    tipo_cobranca = coalesce(tipo_cobranca, 'por_sessao'),
    dia_pagamento = coalesce(dia_pagamento, 10),
    -- Fichas fictícias: o consentimento aqui não representa pessoa alguma.
    -- Sem ele, as telas de sessão e transcrição apareceriam bloqueadas na
    -- demonstração, e o visitante não veria justamente o que o app faz.
    consentimento_perfil = true,
    consentimento_perfil_em = coalesce(consentimento_perfil_em, now() - interval '6 months')
  where user_id = freud;

  update public.patients set
    email = 'anna.o@exemplo.com.br', telefone = '11988120001',
    como_chegou = 'Encaminhada por neurologista',
    info_relevantes = 'Procurou análise depois de um longo período cuidando do pai adoecido. Queixa inicial de episódios em que "as palavras somem" — perde o português e responde em inglês, língua que aprendeu na infância. Relata também rigidez no braço direito ao fim do dia, sem achado neurológico. Nomeia o próprio tratamento de "cura pela fala": diz que melhora quando consegue contar a cena inteira, do começo ao fim, sem pular.'
  where user_id = freud and nome = 'Anna O.';

  update public.patients set
    email = 'cacilie.m@exemplo.com.br', telefone = '11988120002',
    como_chegou = 'Indicação de outra analisante',
    info_relevantes = 'Nevralgia facial de anos, investigada à exaustão sem causa orgânica. A dor aparece em pontada, do lado direito, e ela própria a descreve como "uma bofetada". Trabalha num escritório de advocacia onde relata humilhações frequentes e às quais responde calando. Valor de sessão reduzido, acordado no início: atravessa aperto financeiro desde a separação.'
  where user_id = freud and nome = 'Cäcilie M.';

  update public.patients set
    email = 'dora@exemplo.com.br', telefone = '11988120003',
    como_chegou = 'Trazida pelo pai',
    info_relevantes = 'Chegou à análise trazida pelo pai, e deixa claro na primeira sessão que não pediu para vir. Tosse seca há meses e episódios de afonia que duram dias, sem achado clínico. Há um casal amigo da família (Sr. e Sra. K.) no centro de tudo que ela conta: uma amizade da qual o pai depende e um episódio à beira do lago que ninguém na família quis ouvir. Risco de interrupção precoce a considerar.'
  where user_id = freud and nome = 'Dora';

  update public.patients set
    email = 'elisabeth.r@exemplo.com.br', telefone = '11988120004',
    como_chegou = 'Encaminhada pela ortopedia',
    info_relevantes = 'Dores nas pernas que a impedem de ficar em pé por muito tempo; exames repetidos, todos normais. Cuidou do pai até a morte dele e, em seguida, da casa das irmãs. A dor aparece associada a ficar parada, nunca a andar. Curiosamente localiza o ponto mais doloroso na coxa direita — exatamente onde apoiava a perna do pai para trocar o curativo.'
  where user_id = freud and nome = 'Elisabeth Von R.';

  update public.patients set
    email = 'emmy.n@exemplo.com.br', telefone = '11988120005',
    como_chegou = 'Busca própria, pelo site',
    info_relevantes = 'Viúva, duas filhas, administra sozinha os negócios da família. Apresenta estalidos com a língua e um gesto de afastar com a mão que interrompem a fala em momentos precisos — quase sempre quando o assunto se aproxima da morte do marido. Repete uma fórmula ("fique quieto, não diga nada") como quem pede silêncio a si mesma. Pediu explicitamente, na primeira sessão, que não seja interrompida enquanto fala.'
  where user_id = freud and nome = 'Emmy Von N.';

  update public.patients set
    email = 'katharina@exemplo.com.br', telefone = '11988120006',
    como_chegou = 'Procurou por conta própria',
    info_relevantes = 'Vinte e poucos anos, trabalha na pousada da família numa cidade de serra e veio para a capital estudar. Crises de falta de ar que começam com a sensação de um peso sobre o peito e o rosto de um homem que ela não consegue nomear. As crises começaram aos 16 anos, e ela situa o início "depois do que viu" — sem completar. Escuta cuidadosa e sem pressa: há indícios de violência intrafamiliar.'
  where user_id = freud and nome = 'Katharina';

  update public.patients set
    email = 'lucy.r@exemplo.com.br', telefone = '11988120007',
    como_chegou = 'Indicação médica',
    info_relevantes = 'Inglesa, mora no Brasil há oito anos e trabalha como governanta na casa de um viúvo com duas crianças. Queixa de sentir cheiro de queimado — pudim esquecido no forno — em momentos em que não há nada queimando. O cheiro aparece sobretudo quando fala do patrão. Diz que vai embora "no mês que vem" há três anos.'
  where user_id = freud and nome = 'Lucy R.';

  update public.patients set
    email = 'familia.hans@exemplo.com.br', telefone = '11988120008',
    como_chegou = 'Pais, por indicação do pediatra',
    info_relevantes = 'Oito anos. Atendimento conduzido com a presença do pai, que anota em casa o que o menino fala e traz essas anotações — o pai é quem sustenta o dia a dia do tratamento. Recusa-se a sair de casa desde que viu um cavalo cair na rua; teme que "o cavalo morda". A irmã nasceu há pouco mais de um ano. Duas sessões por semana: frequência de análise de criança, não de adulto.'
  where user_id = freud and nome = 'Pequeno Hans';

  update public.patients set
    email = 'ferenczi@exemplo.com.br', telefone = '11988120009',
    como_chegou = 'Colega de formação',
    info_relevantes = 'Analista, em análise e em supervisão comigo — dois enquadres separados, em dias separados, e isso precisa continuar assim. Traz na supervisão o interesse pela chamada técnica ativa e pela elasticidade do enquadre; na análise, o quanto disso responde à própria história. Atende casos difíceis e tende a se oferecer demais.'
  where user_id = freud and nome = 'Sandor Ferenczi';

  update public.patients set
    email = 'stekel@exemplo.com.br', telefone = '11988120010',
    como_chegou = 'Foi meu paciente antes de se formar analista',
    info_relevantes = 'Analista. Começou como analisante e depois entrou também em supervisão. Trabalha com simbolismo onírico e tem facilidade impressionante para interpretar — facilidade que às vezes atropela o tempo do analisando. É esse o ponto de trabalho na supervisão.'
  where user_id = freud and nome = 'Wilhelm Stekel';

  update public.patients set
    email = 'jung@exemplo.com.br', telefone = '11988120011',
    como_chegou = 'Correspondência profissional',
    info_relevantes = 'Psiquiatra de hospital, supervisão semanal. Traz casos graves, de internação, e um trabalho próprio com testes de associação de palavras. Nunca esteve em análise comigo, e isso é dado clínico relevante para a supervisão: há material dele que aparece nos casos e não tem outro lugar para ir.'
  where user_id = freud and nome = 'Carl Jung';

  update public.patients set
    email = 'adler@exemplo.com.br', telefone = '11988120012',
    como_chegou = 'Sociedade das Quartas-Feiras',
    info_relevantes = 'Clínico geral que migrou para a psicanálise, supervisão semanal. Formula os casos a partir de sentimento de inferioridade e compensação, e cada vez menos a partir da sexualidade infantil. Divergência teórica em curso, que aparece na supervisão como discussão de caso e convém não confundir com resistência.'
  where user_id = freud and nome = 'Alfred Adler';

  update public.patients set
    email = 'rank@exemplo.com.br', telefone = '11988120013',
    como_chegou = 'Aluno, depois colega',
    info_relevantes = 'Não é médico; veio da literatura e da mitologia, e é hoje um dos analistas mais cuidadosos que supervisiono. Trabalha com o nascimento e a separação como matriz da angústia. Supervisão semanal, casos de adultos jovens.'
  where user_id = freud and nome = 'Otto Rank';

  update public.patients set
    email = 'jones@exemplo.com.br', telefone = '11988120014',
    como_chegou = 'Congresso internacional',
    info_relevantes = 'Galês, radicado no Brasil, supervisão semanal em inglês e português. Analisou-se com Ferenczi, não comigo. Ocupa-se da organização e da difusão da psicanálise tanto quanto da clínica, e a supervisão serve para que a segunda não seja engolida pela primeira.'
  where user_id = freud and nome = 'Ernst Jones';

  update public.patients set
    email = 'kahane@exemplo.com.br', telefone = '11988120015',
    como_chegou = 'Fundador da Sociedade das Quartas-Feiras',
    info_relevantes = 'Médico, um dos quatro que começaram as reuniões de quarta-feira. Supervisão semanal, casos de clínica geral com sofrimento psíquico — pacientes que chegam pelo corpo e ficam anos sem chegar à palavra.'
  where user_id = freud and nome = 'Max Kahane';

  -- ═══════════════════════════════════════════════════════════════════
  -- 2. A agenda da semana
  -- ═══════════════════════════════════════════════════════════════════
  delete from public.slot_participantes where user_id = freud;
  delete from public.availability_slots where user_id = freud;

  -- Análise: segunda a sexta, mesmo horário todo dia.
  insert into public.availability_slots
    (user_id, patient_id, day_of_week, start_time, end_time, modality, tipo, recorrencia_tipo)
  select freud, p.id, d, h.inicio, h.fim, 'presencial', 'sessao_individual', 'semanal'
  from generate_series(1, 5) as d
  cross join (values
    ('Sandor Ferenczi',  '06:00', '06:50'),
    ('Dora',             '07:00',       '07:50'),
    ('Elisabeth Von R.', '08:00',       '08:50'),
    ('Anna O.',          '09:00',       '09:50'),
    ('Emmy Von N.',      '10:00',       '10:50'),
    ('Lucy R.',          '11:00',       '11:50'),
    ('Cäcilie M.',       '12:00',       '12:50'),
    ('Katharina',        '14:00',       '14:50'),
    ('Wilhelm Stekel',   '15:00',       '15:50')
  ) as h(quem, inicio, fim)
  join public.patients p on p.user_id = freud and p.nome = h.quem;

  -- Pequeno Hans: terça e quinta, com o pai.
  insert into public.availability_slots
    (user_id, patient_id, day_of_week, start_time, end_time, modality, tipo, recorrencia_tipo)
  select freud, p.id, d, '16:00', '16:50', 'presencial', 'sessao_individual', 'semanal'
  from generate_series(2, 4, 2) as d
  join public.patients p on p.user_id = freud and p.nome = 'Pequeno Hans';

  -- Supervisão individual: uma vez por semana, fim de tarde.
  insert into public.availability_slots
    (user_id, patient_id, day_of_week, start_time, end_time, modality, tipo, recorrencia_tipo)
  select freud, p.id, s.dia, s.inicio, s.fim, s.modo, 'supervisao_individual', 'semanal'
  from (values
    ('Carl Jung',       1, '17:00', '18:00', 'online'),
    ('Alfred Adler',    2, '17:00',       '18:00',       'presencial'),
    ('Otto Rank',       3, '17:00',       '18:00',       'presencial'),
    ('Ernst Jones',     4, '17:00',       '18:00',       'online'),
    ('Max Kahane',      5, '17:00',       '18:00',       'presencial'),
    -- Os dois que também estão em análise: supervisão no sábado, em dia
    -- separado do divã. Misturar os dois enquadres no mesmo dia é
    -- justamente o que não se faz.
    ('Sandor Ferenczi', 6, '09:00',       '10:00',       'presencial'),
    ('Wilhelm Stekel',  6, '10:00',       '11:00',       'presencial')
  ) as s(quem, dia, inicio, fim, modo)
  join public.patients p on p.user_id = freud and p.nome = s.quem;

  -- A Sociedade Psicológica das Quartas-Feiras: supervisão de grupo.
  insert into public.availability_slots
    (user_id, patient_id, day_of_week, start_time, end_time, modality, tipo, titulo, recorrencia_tipo)
  values (freud, null, 3, '20:00', '22:00', 'presencial', 'supervisao_grupo',
          'Sociedade Psicológica das Quartas-Feiras', 'semanal');

  insert into public.slot_participantes (slot_id, patient_id, user_id, valor_sessao, tipo_cobranca)
  select s.id, p.id, freud, 60, 'por_sessao'
  from public.availability_slots s
  join public.patients p on p.user_id = freud
  where s.user_id = freud and s.tipo = 'supervisao_grupo'
    and p.nome in ('Alfred Adler', 'Otto Rank', 'Wilhelm Stekel', 'Max Kahane', 'Sandor Ferenczi');

  -- ═══════════════════════════════════════════════════════════════════
  -- 3. O texto de horário da ficha, batendo com a agenda
  -- ═══════════════════════════════════════════════════════════════════
  -- `patients.horario` é texto denormalizado que a ficha mostra. Estava
  -- divergindo dos slots (Jones aparecia como "Qua 09:00" e o slot dele
  -- era segunda às 20:30) — e ficha que contradiz agenda é o tipo de
  -- detalhe que faz alguém desconfiar de tudo que vê.
  update public.patients p set horario = (
    select string_agg(txt, ', ' order by ord)
    from (
      select distinct
        case s.day_of_week when 1 then 'Seg' when 2 then 'Ter' when 3 then 'Qua'
             when 4 then 'Qui' when 5 then 'Sex' when 6 then 'Sáb' else 'Dom' end
          || ' ' || s.start_time as txt,
        s.day_of_week * 10000 + left(s.start_time, 2)::int * 100 as ord
      from public.availability_slots s
      where s.user_id = freud and s.patient_id = p.id
    ) t
  )
  where p.user_id = freud;
end $$;
