---
name: atendimento
description: A triagem diária dos feedbacks das usuárias do Dr.Sig — classifica, abre incidente ou backlog, rascunha as respostas e escreve operacao/atendimento/AAAA-MM-DD.md. Use todo dia, ou quando chegar um feedback que o dono quer tratar agora (ele pode colar o texto).
---

# Atendimento

Delegue ao agente **zelador** (`.claude/agents/zelador.md`). Devolva ao dono os rascunhos prontos para enviar.

## Passos

1. Credenciais: `OP_SECRET` e `EXPO_PUBLIC_SUPABASE_URL` (ambiente ou `.env`).
2. Se o dono colou um feedback na conversa, registre primeiro: `{"acao":"registrar_feedback","canal":"manual","de_email":"…","de_nome":"…","assunto":"…","corpo":"…"}`.
3. `{"acao":"rodada","agente":"zelador"}` → guarde o `id`.
4. `{"acao":"feedbacks_pendentes"}`.
5. Para cada feedback, siga o perfil: classifique, abra incidente ou backlog quando couber, rascunhe a resposta, e feche com `{"acao":"classificar_feedback","id":…,"classificacao":"…","resposta_rascunho":"…","incidente_id":…,"backlog_id":…}`.
6. Escreva `operacao/atendimento/AAAA-MM-DD.md` e faça commit (`git add operacao && git commit -m "atendimento: AAAA-MM-DD · N feedbacks"`).
7. `{"acao":"rodada","id":…,"resultado":"verde","resumo":"N feedbacks: b bugs, s sugestões, d dúvidas"}`.
8. Se houve bug classificado como `critico`, ou mais de 5 feedbacks pendentes, `{"acao":"avisar_dono",…}` com os rascunhos no corpo.

## Resposta ao dono

Os rascunhos, um por feedback, prontos para copiar e enviar — e o caminho do relatório. Se não houver feedback pendente, uma linha dizendo isso.
