-- ═══════════════════════════════════════════════════════════════════════
-- Consultório de demonstração — registros de sessão (analisantes, parte 2)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Cäcilie M., Katharina, Lucy R. e Pequeno Hans. Mesmas regras da parte 1:
-- data e hora batendo com a agenda da ficha, e material que evolui entre
-- as sessões.
--
-- Katharina exige um cuidado que as outras não exigem. O caso original
-- envolve violência sexual intrafamiliar, e uma amostra pública não é
-- lugar para detalhar cena de abuso. As anotações registram o que a
-- clínica registra — o sintoma, o que ela consegue dizer, o que o analista
-- decide não perguntar ainda, e o encaminhamento de proteção — sem
-- descrever o ato. Isso não é pudor: é como se escreve prontuário.

do $$
declare freud uuid;
begin
  select id into freud from public.profiles where email = 'oseusig@gmail.com';
  if freud is null then raise exception 'Conta de demonstração não encontrada.'; end if;
  delete from public.records r using public.patients p
  where r.patient_id = p.id and p.user_id = freud
    and p.nome in ('Cäcilie M.', 'Katharina', 'Lucy R.', 'Pequeno Hans');
end $$;

create or replace function pg_temp.registro_demo(
  p_nome text, p_data timestamptz, p_corpo text
) returns text
language sql immutable
as $$
  select 'Registro do tipo sessão clínica, referente ao analisante ' || p_nome
      || ', criado em ' || to_char(p_data, 'DD/MM/YYYY') || ' às ' || to_char(p_data, 'HH24:MI')
      || '. Este documento contém anotações e observações clínicas referentes a um '
      || 'atendimento/sessão terapêutica realizada.' || chr(10) || chr(10) || p_corpo;
$$;

insert into public.records (patient_id, type, category, author, title, date, content)
select p.id, 'sessao', 'sessao', 'analyst', d.titulo, d.quando,
       pg_temp.registro_demo(p.nome, d.quando, d.corpo)
from (values

-- ─── Cäcilie M. — Seg a Sex, 12:00 ─────────────────────────────────────
('Cäcilie M.', '2026-06-15 12:00-03'::timestamptz, 'Como uma bofetada',
'A nevralgia facial voltou na quinta. Peço, como sempre, que descreva a dor sem usar a palavra dor. Ela hesita e diz: "é como uma bofetada, do lado direito".

É a terceira vez que usa exatamente essa imagem. Aponto a repetição — não o sentido, só a repetição.

Ela ri, incomodada, e diz que é força de expressão. Em seguida conta que na quinta o sócio do escritório a corrigiu na frente de dois estagiários, e que ela agradeceu a correção.

Pergunto o que ela teria dito se não tivesse agradecido. Não responde. A dor começou naquela tarde.'),

('Cäcilie M.', '2026-07-06 12:00-03', 'A conta do mês',
'Sessão sobre dinheiro, e vale registrar o cuidado. Ela traz o assunto do valor da sessão com um constrangimento que não tem quando fala do corpo.

Reafirmo o acordo que fizemos no início: o valor reduzido não é provisório nem favor, e não muda conforme o mês dela. Ela chora e diz que tinha certeza de que eu ia aumentar quando ela voltasse a trabalhar.

Trabalhamos isso: onde mais ela espera que a gentileza tenha um preço a ser cobrado depois? A resposta vem rápida e sem conflito: no escritório, em casa, com a mãe.

Nenhuma pontada na sessão de hoje.'),

('Cäcilie M.', '2026-07-27 12:00-03', 'O que ela engole',
'Conta um episódio de sábado: a mãe comentou, na frente da família, que ela "nunca soube escolher marido". Ela mudou de assunto e serviu a sobremesa.

Descreve o que sentiu no corpo naquele instante: um calor subindo pelo lado direito do rosto.

Não interpreto o lado. Pergunto o que ela fez com a resposta que não deu. Diz que "guardou". Pergunto onde. Ela leva a mão ao rosto sem perceber.

Fica em silêncio quando aponto o gesto.'),

('Cäcilie M.', '2026-08-17 12:00-03', 'Respondeu ao sócio',
'Semana com um acontecimento: o sócio a corrigiu de novo, e desta vez ela respondeu — disse, na frente das mesmas pessoas, que o dado estava correto e que ele podia conferir.

Conta isso com uma mistura de orgulho e pânico. Passou o fim de semana esperando ser demitida. Não foi.

Registro o mais importante: não houve nevralgia na semana inteira. É o primeiro intervalo assim desde março.

Ela mesma comenta, no fim: "eu não engoli".'),

('Cäcilie M.', '2026-09-09 12:00-03', 'A dor que voltou diferente',
'A dor voltou na segunda, mas mudou de qualidade — é mais difusa, menos em pontada, e ela não usou a palavra bofetada uma vez sequer.

Pergunto o que aconteceu na segunda. Almoço na casa da mãe. Ela respondeu a um comentário, e a mãe ficou magoada, e ela passou a tarde pedindo desculpas por mensagem.

Comento que o preço de responder está sendo cobrado — mas agora por ela mesma, não pelos outros. Concorda e diz que é mais difícil assim.

É trabalho de meses. Anoto para acompanhar.'),

-- ─── Katharina — Seg a Sex, 14:00 ──────────────────────────────────────
('Katharina', '2026-06-16 14:00-03', 'O peso no peito',
'Descreve a crise: começa com um peso sobre o peito, como se alguém estivesse sentado ali, e ela não consegue puxar o ar. Dura poucos minutos. Já foi ao pronto-socorro três vezes; eletrocardiograma e exames normais nas três.

Pergunto quando foi a primeira. Diz que aos dezesseis anos, e para. Depois acrescenta: "depois do que eu vi".

Não pergunto o que ela viu. Digo que ela pode contar quando e se quiser, e que a análise não depende disso para começar a funcionar.

Visivelmente aliviada com a frase. A sessão segue por outros assuntos — a faculdade, a mudança para a capital.'),

('Katharina', '2026-07-07 14:00-03', 'O rosto que aparece',
'Nas crises, junto com o peso, aparece um rosto. Ela diz que é um rosto de homem e que não consegue dizer de quem.

Não insisto na identificação. Pergunto o que o rosto está fazendo. Responde depois de um tempo longo: "olhando".

Anoto a resposta exatamente assim. Não acrescento.

No fim da sessão pergunta se está ficando louca. Digo que não, e explico em duas frases o que é uma crise de angústia, porque nesse ponto informação é cuidado, não interpretação.'),

('Katharina', '2026-07-28 14:00-03', 'Por que ela veio pra capital',
'Conta que a mudança para a capital foi decisão dela, contra a vontade da família, e que o argumento oficial foi a faculdade.

Pergunto qual foi o argumento não-oficial. Silêncio de vários minutos, e então: "eu não queria mais dormir lá".

Não avanço. Digo apenas que ela fez o que precisava fazer, e que sair de um lugar é uma forma de se proteger.

Crises diminuíram desde a mudança: eram semanais, agora são mensais. Ela mesma tinha notado e não tinha dito.'),

('Katharina', '2026-08-25 14:00-03', 'O tio',
'Hoje nomeia. Conta o suficiente para que a situação fique clara — quem era, que idade ela tinha, e que a mãe soube e pediu que ela não falasse para não "destruir a família".

Registro o essencial e não detalho a cena aqui: não é o que serve ao tratamento nem ao prontuário.

O que trabalho na sessão não é o episódio, é a segunda parte: o pedido de silêncio. É dele que vem a falta de ar — o peso sobre o peito de quem não pode falar.

Informo, com o cuidado do momento, sobre as vias de proteção e denúncia disponíveis, deixo por escrito, e digo que a decisão é dela e que a análise continua de todo jeito. Ela agradece e não decide nada hoje.'),

('Katharina', '2026-09-08 14:00-03', 'Respirou',
'Primeira sessão depois da anterior. Chega dizendo que dormiu bem pela primeira vez em muito tempo.

Não houve crise nas duas semanas.

Ela pergunta se agora "está resolvido". Digo que não funciona assim, e que o que aconteceu foi ela ter podido dizer — o resto é trabalho.

Comenta que contou também para a prima, e que a prima acreditou nela. Registro isso como o dado mais importante da sessão: alguém da família a escutou sem pedir silêncio.'),

-- ─── Lucy R. — Seg a Sex, 11:00 ────────────────────────────────────────
('Lucy R.', '2026-06-17 11:00-03', 'Cheiro de pudim queimado',
'A alucinação olfativa apareceu duas vezes na semana. Descreve com precisão: cheiro de pudim queimado, forte, que dura alguns minutos e some.

Reconstruímos as duas ocasiões. Na primeira, estava organizando o armário das crianças. Na segunda, conversando com o pai delas sobre o calendário escolar do ano que vem.

Ela nota sozinha que as duas têm a ver com "o ano que vem".

Pergunto onde ela pretende estar no ano que vem. Responde que vai voltar para a Inglaterra. Diz isso há três anos.'),

('Lucy R.', '2026-07-08 11:00-03', 'A carta que não mandou',
'Escreveu uma carta de demissão em janeiro e nunca entregou. Trouxe a carta impressa hoje, dobrada na bolsa, e pediu para ler em voz alta.

Leio junto. É uma carta correta, educada e sem uma linha sobre o motivo.

Pergunto o que ficou de fora. Ela ri e diz "tudo". Depois: "que eu gosto dele, né".

Primeira vez que diz. Diz e imediatamente acrescenta que é ridículo, que ele nunca demonstrou nada, que ela é funcionária.

Não trabalho o ridículo hoje. Apenas registro que ela pôde dizer.'),

('Lucy R.', '2026-07-29 11:00-03', 'O cheiro e a cena',
'Hoje chegamos à origem do cheiro. Conta um episódio de dois anos atrás: estava fazendo pudim com as crianças quando o pai delas chegou e disse, brincando, que ela era "melhor que uma mãe pra eles". O pudim queimou.

Ela ficou com a frase. Não percebeu o pudim.

Comento que o cheiro guarda uma cena que tem as duas coisas juntas — a frase que ela queria ouvir e a prova de que ela estava distraída do serviço dela. Ela chora e diz "é exatamente isso".

O cheiro não apareceu nas duas semanas seguintes. Anotado para acompanhar.'),

('Lucy R.', '2026-08-19 11:00-03', 'O lugar que ela ocupa',
'Sessão sobre a posição dela na casa: mãe sem sê-lo, empregada mas da família, e a ambiguidade que o próprio patrão alimenta sem perceber.

Ela descreve o Natal passado, em que ganhou presente junto com as crianças e comeu na mesa, e a semana seguinte, em que recebeu a advertência sobre o horário.

Formula: "eu nunca sei em que cadeira eu estou sentada".

É a melhor frase da análise até aqui. Registro sem acrescentar.'),

('Lucy R.', '2026-09-09 11:00-03', 'Entregou a carta',
'Entregou a carta na semana passada, reescrita — desta vez dizendo o motivo, com todas as letras, e propondo três meses de aviso para as crianças se organizarem.

Ele reagiu bem, ficou visivelmente constrangido, e pediu que ela reconsiderasse. Ela manteve.

Nenhum episódio de cheiro desde então.

Trabalhamos o que vem agora: ir embora resolve a cadeira, não resolve o que a fez ficar três anos numa cadeira indefinida. Ela concorda e pergunta se pode continuar a análise da Inglaterra, online. Digo que sim.'),

-- ─── Pequeno Hans — Ter e Qui, 16:00 ───────────────────────────────────
('Pequeno Hans', '2026-06-16 16:00-03', 'O cavalo que caiu',
'Atendimento com o pai presente, como combinado. Hans tem oito anos.

Há três semanas recusa-se a sair de casa. Começou no dia em que viu, na rua, um cavalo de carroça cair e se debater no asfalto até levantar.

Hans conta o episódio com riqueza de detalhe e sem angústia aparente. A angústia aparece quando o pai menciona a escola.

Pergunto a Hans o que o cavalo poderia fazer com ele. Responde na hora, sem pensar: "morder".

O pai me olha. Peço que ele apenas anote em casa o que o menino falar, sem corrigir e sem explicar.'),

('Pequeno Hans', '2026-07-02 16:00-03', 'As anotações do pai',
'O pai traz duas páginas de anotações — funcionou muito bem. Entre elas, uma frase que Hans disse no banho: "o cavalo tem uma coisa preta na boca e olhos na frente, igual ao papai".

Leio a frase em voz alta na sessão. Hans ri muito e diz que o pai usa óculos.

Não interpreto para o menino. Comento com o pai, depois, em separado, que a fobia tem endereço e que o endereço é doméstico.

Hans desenhou um cavalo durante a sessão e fez questão de me dar. Guardo na pasta dele.'),

('Pequeno Hans', '2026-07-30 16:00-03', 'A irmã',
'Hans fala da irmã de um ano pela primeira vez sem que ninguém pergunte. Diz que ela "não faz nada" e que "todo mundo acha ela linda".

Pergunto o que ele acha. Diz que acha ela chata e olha para o pai imediatamente.

O pai, muito bem, não reage.

Registro: a fobia começou quatro meses depois do nascimento dela, dado que nem os pais tinham relacionado.'),

('Pequeno Hans', '2026-08-20 16:00-03', 'Foi até a esquina',
'Foi até a esquina com o pai no sábado. Voltou correndo, mas foi.

Hans conta a façanha com orgulho e acrescenta detalhe que não aconteceu: diz que viu um cavalo e não teve medo. O pai confirma, depois, que não havia cavalo nenhum.

Não desmento. A invenção é o trabalho dele.

Combinamos com o pai: nada de elogiar demais a saída nem de cobrar a próxima.'),

('Pequeno Hans', '2026-09-03 16:00-03', 'Voltou à escola',
'Voltou à escola na segunda, dia inteiro, sem episódio.

Hans quase não fala de cavalo hoje; fala de um amigo da turma e de um jogo. É bom sinal e digo isso ao pai.

Peço que as anotações continuem por mais um mês, mesmo sem sintoma. O material da criança aparece quando ninguém está procurando.

Mantemos as duas sessões semanais até o fim do bimestre e reavaliamos.')

) as d(quem, quando, titulo, corpo)
join public.patients p on p.user_id = (select id from public.profiles where email = 'oseusig@gmail.com')
  and p.nome = d.quem;
