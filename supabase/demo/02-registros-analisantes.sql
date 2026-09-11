-- ═══════════════════════════════════════════════════════════════════════
-- Consultório de demonstração — registros de sessão (analisantes, parte 1)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Anna O., Dora, Elisabeth von R. e Emmy von N. — cinco sessões cada,
-- espalhadas de junho a setembro, sempre no dia e no horário que a agenda
-- da ficha diz. Data de registro que não bate com o horário do analisante
-- é o tipo de incoerência que faz o visitante desconfiar da amostra
-- inteira.
--
-- Os textos têm evolução entre si: o que aparece na primeira sessão
-- retorna transformado na quarta. É isso que faz a Busca Dr.Sig e os
-- relatórios terem o que encontrar — com cinco anotações desconexas, a IA
-- não tem o que costurar, e o recurso mais caro do app aparece vazio.
--
-- `category` é onde o app grava o tipo (sessão/estudo/outro); `type`
-- existe por legado e recebe o mesmo valor. O texto começa com a mesma
-- introdução descritiva que a tela de Novo Registro gera, porque é dela
-- que a IA tira o contexto do arquivo.
--
-- Reexecutável: apaga os registros destes analisantes antes de inserir.

do $$
declare
  freud uuid;
begin
  select id into freud from public.profiles where email = 'oseusig@gmail.com';
  if freud is null then
    raise exception 'Conta de demonstração não encontrada.';
  end if;

  -- Limpa registros anteriores destes quatro (inclusive os dois de teste
  -- que sobraram, com título "Teste" e "Teste2").
  delete from public.records r
  using public.patients p
  where r.patient_id = p.id and p.user_id = freud
    and p.nome in ('Anna O.', 'Dora', 'Elisabeth Von R.', 'Emmy Von N.');
end $$;

-- Função auxiliar: monta o texto com a mesma introdução que o app gera.
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

-- ─── Anna O. — Seg a Sex, 09:00 ────────────────────────────────────────
('Anna O.', '2026-06-09 09:00-03'::timestamptz, 'O braço que endurece ao fim do dia',
'Volta à rigidez do braço direito, que aparece sempre no fim da tarde e some durante a noite. Hoje associa pela primeira vez o horário: é a hora em que, durante os meses de doença do pai, ela assumia o turno da enfermeira. Descreve o gesto exato de sustentar o peso dele para trocar a roupa de cama — o braço direito por baixo das costas, firme, sem poder tremer.

Diz, quase como queixa administrativa: "eu não podia largar". Registro a frase; ela passa direto.

Ao fim da sessão, mexe o braço e comenta, surpresa, que está solto. Não faço interpretação. Anoto para acompanhar se a melhora se repete nas sessões em que o assunto aparece.'),

('Anna O.', '2026-06-24 09:00-03', 'Quando o português some',
'Episódio de ontem à noite: ao telefone com a irmã, perdeu o português no meio da frase e terminou a conversa em inglês, sem perceber a troca. A irmã perguntou se ela estava bem e ela desligou envergonhada.

Peço que reconstrua a conversa. Estavam falando do inventário do pai — especificamente de quem fica com a casa. É a terceira vez que o inglês aparece exatamente quando o assunto é herança.

Observo em voz alta que o inglês é a língua da babá que a criou, a única pessoa da casa, segundo ela mesma disse em maio, "que não queria nada dela". Silêncio longo. Diz que nunca tinha pensado nisso.'),

('Anna O.', '2026-07-15 09:00-03', 'A cura pela fala, nas palavras dela',
'Chega dizendo que descobriu como o tratamento funciona e quer explicar. Sua formulação: "só passa quando eu conto a coisa inteira, do começo ao fim, sem pular a parte ruim". Chama isso de cura pela fala.

Vale registrar que ela chegou a essa ideia sozinha e a apresenta com certo orgulho de autoria. Não corrijo nem confirmo. Trabalho a partir dali: pergunto qual a parte que ela costuma pular. Responde rápido demais — "nenhuma" — e em seguida se cala por quase dez minutos.

O silêncio de hoje foi diferente dos anteriores: não parecia bloqueio, parecia decisão.'),

('Anna O.', '2026-08-12 09:00-03', 'A água no copo',
'Há três semanas evita beber água em copo; bebe direto da garrafa, e inventou explicações práticas para isso. Hoje conta que a coisa começou depois de ver a cachorra da vizinha bebendo do copo que a dona deixou no chão. Sentiu nojo e não conseguiu mais.

Pergunto o que a impediu de dizer alguma coisa à vizinha na hora. Diz que "não se faz isso", que a mulher é gentil, que seria grosseria.

Aparece de novo, agora em outro material, a mesma posição da sessão de junho: o nojo é dela, a contrariedade é dela, e não pode chegar à outra pessoa. Fica no corpo — no braço, na língua, agora na garganta.'),

('Anna O.', '2026-09-02 09:00-03', 'Primeira vez que reclama do pai',
'Sessão importante. Ao falar do turno da noite, interrompe a si mesma e diz: "ele era insuportável quando estava doente". Cala imediatamente e pede desculpa — a mim, não a ele.

Trabalhamos a desculpa. A quem ela pede desculpas ao dizer a verdade sobre o próprio cansaço? Responde que "não é bonito falar assim de quem morreu". Devolvo que não falar também não o ressuscita.

Chora pela primeira vez desde o início da análise. Sai com o braço solto. Anoto: os sintomas corporais têm cedido nas sessões em que a agressividade encontra palavra, e voltado nas semanas em que ela se ocupa de ser boa filha.'),

-- ─── Dora — Seg a Sex, 07:00 ───────────────────────────────────────────
('Dora', '2026-06-10 07:00-03', 'Não fui eu que marquei',
'Primeira sessão depois da avaliação. Abre dizendo que não pediu para vir, que quem marcou foi o pai e que vem porque é menor de dependência financeira, não de idade. Tem dezoito anos e faz questão de dizer isso.

Não discuto o enquadre nem a defendo do pai. Pergunto o que ela faria com o horário, se o horário fosse dela. Responde que não sabe — e é a primeira frase da sessão que não sai pronta.

A tosse aparece duas vezes, ambas quando menciona o pai. Ela não comenta a tosse.'),

('Dora', '2026-06-30 07:00-03', 'O que houve no lago',
'Conta, com pressa e sem nenhuma pausa, o episódio do fim de semana na casa do casal amigo dos pais. O Sr. K. a procurou sozinha na beira do lago e disse coisas que ela não repete. Ela deu um tapa e voltou para casa no mesmo dia.

O pai, avisado, tratou o assunto como fantasia dela. É essa frase — "ele disse que eu inventei" — que ela repete três vezes na sessão, sempre no mesmo tom, sem chorar.

Fico com a impressão de que a afonia dos meses seguintes começa exatamente aí: não quando o episódio aconteceu, mas quando foi desmentido. Ainda não digo isso a ela.'),

('Dora', '2026-07-21 07:00-03', 'A amizade que convém ao pai',
'Hoje chega ao que vinha rondando: a mulher do Sr. K. tem uma relação com o pai dela, e todo mundo na família sabe e ninguém nomeia. Ela diz que foi "entregue" — usa essa palavra — como preço dessa conveniência.

Aponto que ela conta isso como se fosse informação administrativa da família, sem raiva. Responde que raiva não adianta. Pergunto desde quando. Diz que desde sempre.

A tosse não apareceu uma vez sequer na sessão de hoje. É a primeira sessão sem tosse desde que começou.'),

('Dora', '2026-08-11 07:00-03', 'Também gostava da Sra. K.',
'Sessão difícil e produtiva. Ao falar da Sra. K., o tom muda completamente: fala das conversas das duas, dos livros que ela lhe emprestava, de como era a única adulta que a levava a sério. Diz "eu adorava ela" e em seguida se corrige, incomodada, para "eu gostava, né, como se gosta de uma tia".

Não insisto na correção. Registro apenas que o material mais quente da análise até aqui não é o Sr. K., é ela.

Sai visivelmente desconfortável. Risco de interrupção a considerar nas próximas semanas — anoto explicitamente para não me surpreender depois.'),

('Dora', '2026-09-08 07:00-03', 'Avisa que vai parar',
'Chega e avisa, de pé, ainda sem sentar, que esta é a última sessão. Alega a faculdade, o horário, o trânsito. Nenhum dos três motivos é novo.

Sento-me e digo que vou escutar até o fim do horário, como em qualquer outra sessão. Ela senta.

Falamos dos quinze dias anteriores. Em nenhum momento nomeia a sessão de 11/08. Ao sair, diz "talvez eu volte depois do semestre".

Deixo o horário reservado por quatro semanas. Se não voltar, encerro formalmente e informo. Registro aqui o que penso e não disse: ela está fazendo comigo o que fizeram com ela — indo embora sem explicar, e me deixando com a versão de que eu inventei.'),

-- ─── Elisabeth Von R. — Seg a Sex, 08:00 ───────────────────────────────
('Elisabeth Von R.', '2026-06-11 08:00-03', 'A dor que só existe parada',
'Retomo a queixa principal: dores nas coxas que a impedem de ficar em pé. Peço que descreva a dor em situações diferentes. Descobrimos juntos, na própria sessão, que a dor não aparece quando ela caminha — só quando fica parada, esperando alguma coisa.

Pergunto o que ela costuma estar esperando. Responde: "que alguém venha me render". Fica evidentemente incomodada com a própria frase.

Localiza o ponto mais doloroso na face interna da coxa direita. É onde apoiava a perna do pai durante os curativos.'),

('Elisabeth Von R.', '2026-07-02 08:00-03', 'Todo mundo pôde sair, menos ela',
'Reconstrução do período de doença do pai. As duas irmãs casaram e saíram de casa nesse intervalo; ela ficou. Conta isso sem queixa aparente, como divisão natural de tarefas: "eu era a que não tinha compromisso".

Aponto a expressão. Ela ri e diz que não quis dizer nada com isso. Em seguida chora, e diz que também estava namorando naquela época, e que terminou porque não dava para conciliar.

Primeira vez que menciona esse namoro em um ano de análise.'),

('Elisabeth Von R.', '2026-07-28 08:00-03', 'O cunhado',
'A dor aumentou muito na semana do aniversário da irmã mais nova. Ela associa a um esforço físico na arrumação da festa.

Peço que conte a festa. Conta tudo, em detalhe, exceto a conversa que teve com o cunhado na cozinha. Quando pergunto, diz que "não foi nada" e muda de assunto duas vezes seguidas.

Não forço. Anoto: a dor tem seguido, com fidelidade, os momentos em que ela está perto desse homem e precisa não estar.'),

('Elisabeth Von R.', '2026-08-18 08:00-03', 'Se ela morresse',
'Sessão decisiva. Conta um pensamento que teve durante a internação da irmã, meses atrás, e que a envergonha desde então: pensou, por um segundo, que se a irmã morresse ela poderia ficar com ele.

Conta e espera minha reação — literalmente para de falar e olha para mim. Não reajo como ela espera. Digo que um pensamento não é um ato, e que ela tem carregado esse segundo como se tivesse feito alguma coisa.

Chora muito. Ao levantar, diz que a perna está leve. Peço que não tire conclusões da melhora de hoje: o que importa é o que vai acontecer na semana.'),

('Elisabeth Von R.', '2026-09-07 08:00-03', 'Voltou a dançar',
'Três semanas sem crise de dor, o intervalo mais longo desde o início. Voltou a ir ao baile de sábado com as amigas — atividade que tinha abandonado há quatro anos, na época da doença do pai.

Comenta, ela mesma, que acha estranho a perna doer menos justo agora que ela anda mais.

Trabalhamos o "estranho". Ela sabe a resposta e a formula: doía quando ela estava parada, e agora ela não está.'),

-- ─── Emmy Von N. — Seg a Sex, 10:00 ────────────────────────────────────
('Emmy Von N.', '2026-06-12 10:00-03', 'Não me interrompa',
'Sessão de enquadre. Pede, de forma direta, que eu não a interrompa enquanto ela fala. Explica que perde a linha e depois precisa recomeçar do início.

Aceito e digo por quê: se a interrupção desorganiza, o trabalho pode ser feito com ela falando e eu escutando, e comentamos depois.

Ao longo da hora, três estalidos com a língua — todos em pontos precisos: quando diz "meu marido", quando diz "o hospital" e quando diz "as meninas eram pequenas".'),

('Emmy Von N.', '2026-07-03 10:00-03', 'Fique quieto, não diga nada',
'Repete várias vezes na sessão uma fórmula: "fique quieto, não diga nada". Diz que é uma coisa que fala sozinha, sem querer, desde a época do hospital.

Pergunto a quem a frase é dirigida. Fica claramente perturbada com a pergunta e responde que a ninguém, que é só um cacoete.

Mais adiante, ao contar da UTI, diz que o marido tentou falar com ela na última visita e que ela pediu que ele guardasse forças — que não falasse. Ele morreu naquela noite.

Não interpreto. Ela chega sozinha ao fim da sessão: "eu mandei ele ficar quieto".'),

('Emmy Von N.', '2026-07-24 10:00-03', 'O gesto de afastar',
'O gesto com a mão — como quem afasta alguma coisa do rosto — apareceu quatro vezes hoje. Peço, com o acordo dela, que repare no gesto quando acontecer.

Consegue notar duas das quatro vezes. As duas foram enquanto falava da filha mais velha, que quer se mudar para outro estado.

Ela própria formula: "é como se eu estivesse tirando alguma coisa da frente". Pergunto o que fica atrás. Não responde hoje.'),

('Emmy Von N.', '2026-08-14 10:00-03', 'Os negócios e o cansaço',
'Sessão mais administrativa, e vale registrar por quê: ela usa os assuntos da empresa como terreno seguro, e faz isso justamente nas semanas seguintes às sessões mais difíceis. Já aconteceu em maio e em julho.

Não aponto ainda. Deixo o terreno seguro existir; ela precisa dele.

Um estalido apenas, ao mencionar de passagem que faria dezessete anos de casada neste mês.'),

('Emmy Von N.', '2026-09-04 10:00-03', 'Deixou a filha ir',
'A filha mais velha se mudou no fim de agosto. Ela ajudou na mudança, ficou dois dias por lá e voltou.

Conta sem o gesto da mão. Nenhuma vez na hora inteira — é a primeira sessão sem o gesto desde que começamos.

Diz que chorou na estrada de volta, sozinha, e que se permitiu. Comenta: "não mandei ninguém ficar quieto dessa vez".

Registro a frase inteira, dela, sem acréscimo meu.')

) as d(quem, quando, titulo, corpo)
join public.patients p on p.user_id = (select id from public.profiles where email = 'oseusig@gmail.com')
  and p.nome = d.quem;
