# Operação

Os relatórios dos agentes de operação (ver `.claude/agents/` e
`.claude/skills/`). Cada rodada deixa um arquivo aqui e uma linha em
`op_rodadas` no banco.

- `ronda/AAAA-MM-DD.md` — o Vigia: estado do app nas últimas 24 h.
- `atendimento/AAAA-MM-DD.md` — o Zelador: feedbacks triados e respostas rascunhadas.

Regras: nenhum dado de analisante ou de usuária entra aqui — só contagens,
origens e ids. O que precisa de decisão do dono chega por e-mail; o resto
fica só neste registro.
