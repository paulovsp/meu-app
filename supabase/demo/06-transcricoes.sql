-- ═══════════════════════════════════════════════════════════════════════
-- Consultório de demonstração — sessões com transcrição
-- ═══════════════════════════════════════════════════════════════════════
--
-- Três sessões transcritas, e só três de propósito.
--
-- Transcrição é o recurso mais caro do app e o mais impressionante de ver
-- funcionando — mas diálogo fictício em volume não se sustenta: fica
-- repetitivo, e um psicanalista percebe na segunda página que ninguém
-- falou daquele jeito. Três boas mostram o recurso; trinta medíocres o
-- desmentem.
--
-- As sessões existentes ficam: elas têm resumo e servem ao histórico. O
-- que estas três acrescentam é o texto em turnos, com hesitação, silêncio
-- e correção — que é como a fala transcrita realmente se parece, e é o que
-- alimenta a Busca Dr.Sig e os relatórios.
--
-- `transcricao_status = 'concluida'` porque a demonstração precisa mostrar
-- a transcrição pronta, não a fila de processamento.
--
-- Reexecutável.

do $$
declare
  freud uuid;
begin
  select id into freud from public.profiles where email = 'oseusig@gmail.com';
  if freud is null then raise exception 'Conta de demonstração não encontrada.'; end if;

  -- Reexecução identificada pelo par pessoa+data: `transcricao_origem` só
  -- aceita os valores reais ('microfone', 'meet', 'zoom', 'manual'), e
  -- inventar um marcador ali quebraria a restrição que garante que esse
  -- campo signifique alguma coisa.
  delete from public.sessions s using public.patients p
  where s.patient_id = p.id and p.user_id = freud
    and p.nome in ('Anna O.', 'Wilhelm Stekel', 'Sandor Ferenczi')
    and s.date::date in (date '2026-09-02', date '2026-09-09', date '2026-09-07')
    and s.transcript like '[00:00:%';
end $$;

insert into public.sessions
  (patient_id, type, online_platform, date, duration_seconds,
   transcricao_status, transcricao_origem, category, transcript)
select p.id, 'sessao_individual', d.plataforma, d.quando, d.duracao,
       'concluida', 'microfone', 'sessao', d.texto
from (values

('Anna O.', '2026-09-02 09:00-03'::timestamptz, null::text, 2940,
'[00:00:12] Analisante: Eu ia falar do trabalho, mas acho que não é isso.

[00:00:31] Analisante: Ontem eu tava arrumando o armário do quarto dele. Faz um ano e eu ainda não tinha aberto. Minha irmã falou que era pra doar tudo, que não faz sentido guardar.

[00:01:04] Analisante: E eu abri e tava lá o pijama, aquele azul, e eu... (silêncio)

[00:01:29] Analisante: Ele era insuportável quando tava doente.

[00:01:33] Analisante: Desculpa.

[00:01:40] Analista: Desculpa por quê?

[00:01:47] Analisante: Sei lá. Não é bonito falar assim de quem morreu.

[00:02:03] Analista: A quem a senhora está pedindo desculpas?

[00:02:19] Analisante: (silêncio) Não sei. Pro senhor, acho.

[00:02:35] Analisante: Não. Pra ele.

[00:02:58] Analisante: Mas ele era. Ele gritava comigo de madrugada porque o travesseiro tava torto. E eu levantava, e arrumava, e falava tá bom pai, e voltava pro quarto e ficava acordada até dar hora de levantar de novo.

[00:03:41] Analisante: E de manhã minha irmã ligava perguntando se ele tinha dormido bem.

[00:04:02] Analista: E o que a senhora respondia?

[00:04:09] Analisante: Que tinha dormido bem.

[00:04:16] Analisante: (rindo) Que ele tinha dormido bem.

[00:04:52] Analisante: Meu braço tá solto hoje. Reparou? Desde que eu comecei a falar.

[00:05:10] Analista: Reparei.

[00:05:14] Analisante: Por que que é assim?

[00:05:31] Analista: A senhora tem uma ideia.

[00:05:48] Analisante: Tenho. Mas é meio besta.

[00:06:02] Analisante: É que quando eu falo, eu não preciso segurar.

[00:06:20] (silêncio prolongado)

[00:06:58] Analisante: Não falei isso pra ninguém em um ano. Que foi horrível. Todo mundo fala do quanto eu fui dedicada, e eu fui, eu fui mesmo, mas foi horrível.

[00:07:30] Analisante: As duas coisas ao mesmo tempo.'),

('Wilhelm Stekel', '2026-09-09 15:00-03', null, 2820,
'[00:00:08] Analisante: Tive um sonho. Vou contar sem interpretar, como a gente combinou.

[00:00:19] Analisante: (pausa) É difícil.

[00:00:41] Analisante: Eu tava numa mesa comprida, cheia de gente, e tinha um prato na minha frente que eu não conseguia alcançar. E eu esticava o braço e a mesa crescia.

[00:01:12] Analisante: Só isso. Acordei irritado.

[00:01:34] (silêncio)

[00:01:58] Analisante: O senhor não vai falar nada?

[00:02:05] Analista: O senhor disse que ia contar sem interpretar.

[00:02:12] Analisante: Eu disse EU. O senhor pode.

[00:02:20] (silêncio)

[00:02:47] Analisante: Isso é insuportável, sabia?

[00:03:03] Analista: O quê, exatamente?

[00:03:15] Analisante: O senhor ficar aí quieto esperando. Como se soubesse.

[00:03:38] Analista: E se eu não souber?

[00:03:44] Analisante: Aí é pior.

[00:04:19] Analisante: (rindo) Tá bom. Tá bom.

[00:04:51] Analisante: Eu tive um paciente essa semana. Segurei uma interpretação por três sessões. Três. Tava na ponta da língua desde a primeira.

[00:05:22] Analisante: E ontem ele chegou sozinho. Chegou num lugar diferente do meu. Melhor que o meu.

[00:05:47] Analisante: Eu tava certo e não servia pra nada.

[00:06:10] (silêncio)

[00:06:33] Analisante: Meu pai perguntava coisa na mesa do jantar. Já falei disso aqui.

[00:06:52] Analisante: Quem respondia rápido ficava. Quem não respondia...

[00:07:09] Analisante: Meu irmão parou de falar na mesa com dez anos.

[00:07:38] Analisante: Eu nunca parei.'),

('Sandor Ferenczi', '2026-09-07 06:00-03', null, 3000,
'[00:00:15] Analisante: Recusei um atendimento fora de hora na quarta.

[00:00:24] Analisante: Ele ligou às onze da noite. Eu olhei o telefone tocando e não atendi.

[00:00:47] Analisante: Mandei mensagem de manhã oferecendo o horário das seis. Ele veio.

[00:01:15] Analista: E como foi?

[00:01:22] Analisante: Ele tava bravo. Muito bravo.

[00:01:41] Analisante: Falou que eu tinha abandonado ele, que ele achou que eu era diferente dos outros.

[00:02:09] Analisante: E eu fiquei... (pausa) eu fiquei bem.

[00:02:28] Analisante: Achei que ia ficar mal. Passei a noite de quarta achando que ele ia fazer alguma besteira.

[00:02:52] Analisante: E ele só ficou bravo.

[00:03:20] Analista: Ficar bravo é uma resposta viva.

[00:03:31] Analisante: (silêncio longo)

[00:04:12] Analisante: Minha mãe nunca ficava brava.

[00:04:26] Analisante: Ela ficava no quarto.

[00:04:53] Analisante: Se eu não fosse lá, ela ficava o dia inteiro. Eu abria a cortina e falava até ela responder alguma coisa. Qualquer coisa.

[00:05:31] Analisante: Nove anos. Eu tinha nove anos.

[00:06:04] Analisante: Então quando alguém fica bravo comigo eu... é quase um alívio? Porque bravo é alguém que tá ali.

[00:06:44] (silêncio)

[00:07:21] Analisante: Eu queria perguntar uma coisa e não sei se é hora.

[00:07:35] Analisante: Eu tava pensando em vir quatro vezes por semana em vez de cinco.

[00:07:52] Analista: É uma boa pergunta, e não se responde no último minuto da sessão.

[00:08:01] Analisante: (rindo) Eu sabia que o senhor ia falar isso.

[00:08:09] Analista: Segunda a gente retoma.')

) as d(quem, quando, plataforma, duracao, texto)
join public.patients p on p.user_id = (select id from public.profiles where email = 'oseusig@gmail.com')
  and p.nome = d.quem;
