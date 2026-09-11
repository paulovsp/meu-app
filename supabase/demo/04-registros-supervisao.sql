-- ═══════════════════════════════════════════════════════════════════════
-- Consultório de demonstração — análise e supervisão dos colegas
-- ═══════════════════════════════════════════════════════════════════════
--
-- Ferenczi e Stekel aparecem duas vezes cada: nas sessões de análise
-- (segunda a sexta, de manhã) e nas de supervisão (sábado). São dois
-- enquadres distintos na mesma ficha, e as anotações mostram a diferença —
-- na análise fala-se dele, na supervisão fala-se do caso dele.
--
-- Essa separação não é detalhe de estilo: é o que a ficha dupla do app
-- existe para sustentar, e um visitante psicanalista repara na hora se
-- estiver embaralhado.
--
-- Jung, Adler, Rank, Jones e Kahane só supervisionam. Os registros deles
-- são anotações de supervisão: o que o supervisionando trouxe, o que se
-- discutiu do manejo, e o que ficou para a próxima.

do $$
declare freud uuid;
begin
  select id into freud from public.profiles where email = 'oseusig@gmail.com';
  if freud is null then raise exception 'Conta de demonstração não encontrada.'; end if;
  -- Apaga também os dois registros de teste que sobraram em Adler
  -- ("Teste" e "Teste2").
  delete from public.records r using public.patients p
  where r.patient_id = p.id and p.user_id = freud
    and p.nome in ('Sandor Ferenczi', 'Wilhelm Stekel', 'Carl Jung',
                   'Alfred Adler', 'Otto Rank', 'Ernst Jones', 'Max Kahane');
end $$;

create or replace function pg_temp.registro_demo(
  p_nome text, p_data timestamptz, p_corpo text, p_rotulo text, p_descricao text
) returns text
language sql immutable
as $$
  select 'Registro do tipo ' || p_rotulo || ', referente ao analisante ' || p_nome
      || ', criado em ' || to_char(p_data, 'DD/MM/YYYY') || ' às ' || to_char(p_data, 'HH24:MI')
      || '. Este documento contém ' || p_descricao || '.' || chr(10) || chr(10) || p_corpo;
$$;

insert into public.records (patient_id, type, category, author, title, date, content)
select p.id, d.tipo, d.tipo, 'analyst', d.titulo, d.quando,
       pg_temp.registro_demo(
         p.nome, d.quando, d.corpo,
         case when d.tipo = 'sessao' then 'sessão clínica' else 'estudo' end,
         case when d.tipo = 'sessao'
              then 'anotações e observações clínicas referentes a um atendimento/sessão terapêutica realizada'
              else 'anotações de supervisão clínica: o caso trazido pelo supervisionando, o manejo discutido e os encaminhamentos'
         end)
from (values

-- ─── Sandor Ferenczi — ANÁLISE, Seg a Sex, 06:00 ───────────────────────
('Sandor Ferenczi', '2026-06-15 06:00-03'::timestamptz, 'sessao', 'O primeiro horário do dia',
'Escolheu o horário das seis, o primeiro do dia, e hoje diz por quê: "assim ninguém sabe que eu venho".

Trabalhamos a frase. Ele é analista, supervisiona, escreve — e a análise dele é a coisa que precisa ficar no escuro.

Diz que não é vergonha, é "não querer que pensem que ele não dá conta". Pergunto quem pensaria isso. Responde com o nome de um colega e, em seguida, com o meu.

Sessão importante: é a primeira vez que a transferência aparece nomeada, e ele a nomeia sozinho.'),

('Sandor Ferenczi', '2026-07-13 06:00-03', 'sessao', 'Se oferece demais',
'Traz um episódio com um paciente que ligou fora de hora, e ele atendeu, e a ligação durou quarenta minutos.

Não é a primeira vez. Aponto a série: quatro episódios semelhantes desde março, sempre com pacientes em situação grave.

Ele defende a conduta com argumento técnico — a tal técnica ativa que vem estudando. Digo que o argumento é bom e que não é disso que estou falando.

Fica em silêncio e depois diz: "eu tenho medo que eles morram e que a culpa seja minha".

Aí está o material da análise, e não da supervisão. Marco a diferença em voz alta, porque ele mistura os dois com facilidade.'),

('Sandor Ferenczi', '2026-08-10 06:00-03', 'sessao', 'A mãe que adoecia',
'Chega ao que vinha rondando. A mãe teve episódios depressivos graves durante toda a infância dele, e ele era o filho que "sabia acordar ela".

Descreve a rotina: entrar no quarto de manhã, abrir a cortina, falar até ela responder. Tinha nove anos.

Faz sozinho a ligação com os pacientes que liga fora de hora. Não preciso dizer nada.

Chora — pela primeira vez em sete anos de análise, segundo ele. Registro assim, com a ressalva de que é a contagem dele.'),

('Sandor Ferenczi', '2026-09-07 06:00-03', 'sessao', 'Disse não a um paciente',
'Recusou um atendimento fora de hora na semana passada. Ofereceu o horário do dia seguinte e manteve.

Conta com culpa e alívio misturados, e observa que o paciente não piorou — "ele só ficou bravo".

Comento que ficar bravo é uma resposta viva, e que ele a tratou a vida inteira como catástrofe.

Fim de sessão: pergunta se pode reduzir de cinco para quatro vezes por semana. Digo que a pergunta é boa e que não se responde no último minuto da sessão. Retomamos segunda.'),

-- ─── Sandor Ferenczi — SUPERVISÃO, Sáb, 09:00 ──────────────────────────
('Sandor Ferenczi', '2026-06-20 09:00-03', 'estudo', 'Supervisão: a paciente que não fala',
'Traz caso de mulher de 40 anos, três meses de atendimento, sessões inteiras em silêncio.

Ele descreve o que tem feito: falar para preencher, propor temas, e uma vez oferecer papel para que ela escrevesse.

Discutimos o manejo. Pergunto o que ele imagina que acontece com ela no silêncio. Responde que "nada". Proponho a hipótese contrária: que acontece muito, e que a intervenção dele interrompe.

Combinamos um experimento para as próximas quatro sessões: sustentar o silêncio e anotar o que ele mesmo sente durante.

Encaminhamento anotado para retomar em 18/07.'),

('Sandor Ferenczi', '2026-07-18 09:00-03', 'estudo', 'Supervisão: o que apareceu no silêncio',
'Retoma o caso da paciente silenciosa. Sustentou o silêncio em três das quatro sessões.

Na terceira, ela falou por vinte minutos seguidos, sobre a morte do irmão, assunto que nunca tinha aparecido.

Ele chega entusiasmado e propõe generalizar a conduta para outros casos. Freio a generalização: o que funcionou aqui foi ele ter suportado, não a técnica.

Discutimos a diferença entre técnica e disposição do analista. É o tema que atravessa a supervisão dele desde o começo do ano.'),

-- ─── Wilhelm Stekel — ANÁLISE, Seg a Sex, 15:00 ────────────────────────
('Wilhelm Stekel', '2026-06-17 15:00-03', 'sessao', 'Interpreta antes de escutar',
'Conta um sonho e, antes que eu diga qualquer coisa, oferece três interpretações.

Comento que ele chegou às três em menos de um minuto. Ele ri e diz que é rápido mesmo.

Pergunto o que ele faz com o tempo que sobra. Não entende a pergunta. Reformulo: o que aconteceria se ele ficasse um minuto sem saber?

Silêncio desconfortável, e então: "eu odeio não saber".

É o material. A velocidade interpretativa dele, que na supervisão aparece como talento, aqui aparece como defesa — e as duas coisas são verdadeiras ao mesmo tempo.'),

('Wilhelm Stekel', '2026-07-15 15:00-03', 'sessao', 'O pai que perguntava',
'Cena de infância: o pai fazia perguntas à mesa, de aritmética e de história, e quem não respondia rápido ficava sem sobremesa. Ele sempre respondia.

Conta como anedota engraçada. Não rio junto; pergunto como era para o irmão mais novo, que não respondia.

Muda de tom. Diz que o irmão parou de falar na mesa aos dez anos e que hoje eles quase não se veem.

Fica claro, e ele mesmo diz: saber rápido foi o preço de ficar na mesa.'),

('Wilhelm Stekel', '2026-08-12 15:00-03', 'sessao', 'Um minuto sem saber',
'Traz, espontaneamente, um sonho sem interpretação. Diz que tentou o experimento e que "foi horrível".

Descreve a angústia de ficar com o sonho na mão sem fechar o sentido. Foi dormir irritado.

Trabalhamos a irritação. Contra quem? Ele responde: contra mim, "que fica aí quieto esperando".

Transferência posta com todas as letras. Sessão produtiva.'),

('Wilhelm Stekel', '2026-09-09 15:00-03', 'sessao', 'Deixou o paciente chegar sozinho',
'Conta, orgulhoso, que segurou uma interpretação com um paciente por três sessões, e que o paciente chegou sozinho — e chegou diferente do que ele tinha imaginado.

Observa que a versão do paciente era melhor que a dele.

Registro a frase porque ela vale mais que qualquer interpretação que eu pudesse dar hoje: "eu estava certo e não servia pra nada".'),

-- ─── Wilhelm Stekel — SUPERVISÃO, Sáb, 10:00 ───────────────────────────
('Wilhelm Stekel', '2026-06-27 10:00-03', 'estudo', 'Supervisão: simbolismo e pressa',
'Traz três casos, todos com material onírico farto, e conduz a supervisão como uma aula de simbolismo.

Interrompo e peço um caso só, com o que o paciente disse, na ordem em que disse.

A supervisão muda de qualidade imediatamente. Aparecem hesitações, repetições, uma correção que o paciente fez e que ele não tinha registrado.

Fica combinado: nas próximas supervisões, um caso por encontro, com o material antes da leitura dele.'),

('Wilhelm Stekel', '2026-08-08 10:00-03', 'estudo', 'Supervisão: um caso por vez',
'Cumpriu o combinado. Traz um caso, com material transcrito.

O trabalho rendeu o dobro. Ele próprio comenta que "sobrou tempo", e que não sabia o que fazer com o tempo que sobrou — repetindo, na supervisão, exatamente o que aparece na análise dele.

Não aponto a repetição aqui. A supervisão não é o lugar.'),

-- ─── Carl Jung — SUPERVISÃO, Seg, 17:00 (online) ───────────────────────
('Carl Jung', '2026-06-15 17:00-03', 'estudo', 'Supervisão: paciente internada há oito meses',
'Supervisão online, como de praxe — ele atende num hospital em outra cidade.

Traz caso de mulher de 33 anos, internada há oito meses, com fala desorganizada e neologismos. Ele vem aplicando testes de associação de palavras e traz as tabelas de tempo de reação.

O material é rico e ele o organiza muito bem. Aponto o que falta: o que ela diz quando não está sendo testada.

Ele reconhece que quase não há registro disso. Combinamos que traz na próxima.'),

('Carl Jung', '2026-07-20 17:00-03', 'estudo', 'Supervisão: o que ela diz fora do teste',
'Trouxe. E o material é impressionante: as falas "desorganizadas" da paciente repetem, com variações, uma cena de casamento.

Discutimos o quanto o delírio tem estrutura, e o quanto o teste — justamente por ser bom — tinha escondido isso dele.

Ele fica incomodado, e o incômodo é produtivo. Diz que teria continuado dois anos medindo tempo de reação.'),

('Carl Jung', '2026-08-24 17:00-03', 'estudo', 'Supervisão: divergência sobre mitologia',
'Traz uma leitura do caso que recorre a material mitológico, e a discussão passa da clínica para a teoria.

Registro a divergência sem resolvê-la: ele lê o material da paciente como imagem coletiva; eu leio como história dela.

O que importa para a supervisão é que a divergência não atrapalhou o caso — as duas leituras indicam o mesmo manejo.

Anoto porque prevejo que essa diferença vai crescer, e é melhor que esteja registrada desde quando era pequena.'),

-- ─── Alfred Adler — SUPERVISÃO, Ter, 17:00 ─────────────────────────────
('Alfred Adler', '2026-06-16 17:00-03', 'estudo', 'Supervisão: o menino que não competia',
'Caso de menino de 11 anos, terceiro filho, que se recusa a participar de qualquer atividade em que possa perder.

Ele formula rapidamente em termos de inferioridade e compensação. A formulação é boa e explica muito.

Pergunto o que ela deixa de fora. Ele pensa e diz: "o que ele sente pelo irmão do meio".

Trabalhamos aí. A supervisão rende bem quando ele não fecha o caso na primeira formulação.'),

('Alfred Adler', '2026-07-21 17:00-03', 'estudo', 'Supervisão: a mãe entra na sessão',
'A mãe do menino pediu para participar e ele aceitou, na hora, sem combinar enquadre.

A sessão virou conversa familiar e o menino não falou.

Discutimos o manejo, sem censura: o pedido era legítimo, a resposta é que precisava de tempo. Combinamos como ele vai retomar o enquadre sem desautorizar a mãe.

Ele anota. É um supervisionando que aceita bem a observação técnica — as divergências dele são teóricas, não de manejo.'),

('Alfred Adler', '2026-08-18 17:00-03', 'estudo', 'Supervisão: divergência teórica em curso',
'Boa parte do encontro se passa em discussão teórica sobre o lugar da sexualidade infantil na formação do sintoma.

Ele sustenta a posição dele com consistência e traz caso para apoiá-la.

Registro o essencial: a divergência é real, é de fundo, e não está prejudicando os pacientes dele. São coisas diferentes, e confundir as duas seria transformar supervisão em disciplina.'),

-- ─── Otto Rank — SUPERVISÃO, Qua, 17:00 ────────────────────────────────
('Otto Rank', '2026-06-17 17:00-03', 'estudo', 'Supervisão: a paciente que muda de cidade',
'Caso de mulher de 27 anos que muda de cidade, emprego e relação a cada dois anos, com precisão de calendário.

Ele traz o material bem organizado e uma hipótese sobre separação. Discutimos como sustentar o enquadre com alguém cuja solução é ir embora.

Ponto central do manejo: o que acontece nas férias dele. Combinamos que ele avise com antecedência longa e registre a reação.'),

('Otto Rank', '2026-07-15 17:00-03', 'estudo', 'Supervisão: as férias',
'Avisou das férias com seis semanas de antecedência, como combinado.

A paciente faltou nas duas sessões seguintes ao aviso e voltou dizendo que estava pensando em interromper.

Ele manejou bem: não insistiu, não interpretou de imediato, e manteve o horário.

Ela voltou. Discutimos como usar isso no retorno, sem transformar em prova contra ela.'),

('Otto Rank', '2026-09-02 17:00-03', 'estudo', 'Supervisão: o trabalho dele sobre o herói',
'Encontro mais teórico, a pedido dele: traz o ensaio que vem escrevendo sobre o mito do nascimento do herói.

O material é sólido, e a parte clínica é a mais fraca — como costuma acontecer com quem vem das letras.

Sugiro que ele escreva o capítulo clínico a partir de um caso só, e do caso mais difícil, não do mais ilustrativo.'),

-- ─── Ernst Jones — SUPERVISÃO, Qui, 17:00 (online) ─────────────────────
('Ernst Jones', '2026-06-18 17:00-03', 'estudo', 'Supervisão: o analista ocupado demais',
'Supervisão online. Ele abre pedindo desculpas pelo atraso — terceiro atraso seguido.

Não trato como falta de educação, trato como material de supervisão: ele está com três cargos de organização além da clínica.

Traz um caso e percebe, no meio, que confundiu dois pacientes.

Não dramatizo. Digo que é o tipo de coisa que acontece quando a clínica vira o que sobra do dia, e pergunto quantos pacientes ele quer ter.'),

('Ernst Jones', '2026-07-16 17:00-03', 'estudo', 'Supervisão: reduziu a agenda',
'Devolveu dois pacientes a colegas e reorganizou os horários. Chegou na hora hoje.

Traz um caso com material cuidadoso — é outro supervisionando.

Discutimos um paciente que fala inglês em casa e português no trabalho, e o que muda no que ele conta em cada língua. Assunto que ele conhece de dentro.'),

('Ernst Jones', '2026-08-27 17:00-03', 'estudo', 'Supervisão: análise com Ferenczi',
'Comenta, de passagem, uma questão da própria análise — que faz com Ferenczi, não comigo.

Corto com cuidado: isso é da análise dele, e o lugar disso é lá.

Registro porque é exatamente a confusão que a supervisão precisa não permitir. Ele entende na hora e agradece o corte.'),

-- ─── Max Kahane — SUPERVISÃO, Sex, 17:00 ───────────────────────────────
('Max Kahane', '2026-06-19 17:00-03', 'estudo', 'Supervisão: os que chegam pelo corpo',
'Ele é clínico geral e traz o caso de um paciente com dores difusas há sete anos, com dezenas de exames normais.

O paciente não fala de nada além do corpo. Ele pergunta como "fazer o paciente falar de outra coisa".

Reformulo a pergunta: talvez o corpo seja o que ele tem para falar, e a tarefa não seja trocar de assunto, e sim escutar esse assunto com mais tempo.'),

('Max Kahane', '2026-07-24 17:00-03', 'estudo', 'Supervisão: a dor tem horário',
'Seguiu a orientação e mapeou as dores com o paciente. Descobriram juntos que as crises são quase todas nas segundas.

O paciente, sozinho, comentou que segunda é o dia de visitar a mãe.

Ele conta isso com o entusiasmo de quem viu algo funcionar pela primeira vez. Registro assim.'),

('Max Kahane', '2026-09-04 17:00-03', 'estudo', 'Supervisão: encaminhar ou atender',
'Pergunta se deve encaminhar o paciente para uma análise ou continuar ele mesmo.

Discutimos os dois lados sem que eu decida por ele. O que pesa: o vínculo de sete anos, e o fato de que o paciente nunca aceitou outro encaminhamento.

Ele decide continuar, com supervisão quinzenal em vez de mensal. Combinado.')

) as d(quem, quando, tipo, titulo, corpo)
join public.patients p on p.user_id = (select id from public.profiles where email = 'oseusig@gmail.com')
  and p.nome = d.quem;
