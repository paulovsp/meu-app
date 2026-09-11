-- A agenda de todo mundo estava aberta para todo mundo.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 1. Uma política que não existe em migration nenhuma
-- ═══════════════════════════════════════════════════════════════════════
-- Em produção havia `availability_slots_all`: permissiva, `for all`, com a
-- condição `patient_id is null or owns_patient(patient_id)`. Nenhuma
-- migration deste repositório a cria — a 0004 criou `_all_own`, a 0025 a
-- removeu e pôs as quatro `_own` por verbo. Esta foi criada à mão, no
-- painel, e ficou.
--
-- O estrago: toda linha SEM analisante — supervisão de grupo, curso,
-- bloqueio de agenda — passava na condição para QUALQUER usuário
-- autenticado. Na auditoria, uma conta comum leu 16 horários de outra,
-- inseriu um horário na agenda dela, apagou e renomeou o grupo. E como
-- a política não pedia `assinatura_ativa`, também servia para escrever
-- nos próprios horários com a conta vencida.
--
-- As quatro políticas `_own` (0025) já cobrem tudo, com `user_id =
-- auth.uid()`. Só se remove a intrusa.
drop policy if exists availability_slots_all on public.availability_slots;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Participante de grupo apontando para horário ou ficha de outra conta
-- ═══════════════════════════════════════════════════════════════════════
-- As políticas de INSERT de `slot_participantes` e
-- `appointment_participantes` (0032) só conferiam `user_id = auth.uid()`.
-- O `slot_id`/`appointment_id` e o `patient_id` da linha podiam ser de
-- qualquer conta: provado na auditoria, inserindo um participante num
-- grupo alheio. A leitura desse alheio continuava barrada (SELECT filtra
-- por `user_id`), então o efeito era sujeira — mas sujeira em tabela de
-- outra pessoa, e uma porta que não precisa existir.
--
-- Agora a linha só entra se o horário (ou o compromisso) e a ficha forem
-- de quem está inserindo.
drop policy if exists "slot_participantes_insert_own" on public.slot_participantes;
create policy "slot_participantes_insert_own" on public.slot_participantes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.assinatura_ativa(auth.uid())
    and public.owns_patient(patient_id)
    and exists (
      select 1 from public.availability_slots s
      where s.id = slot_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "appointment_participantes_insert_own" on public.appointment_participantes;
create policy "appointment_participantes_insert_own" on public.appointment_participantes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.assinatura_ativa(auth.uid())
    and public.owns_patient(patient_id)
    and exists (
      select 1 from public.appointments a
      where a.id = appointment_id and a.user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
