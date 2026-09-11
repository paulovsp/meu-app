---
name: dependencias
description: A conferência semanal de dependências, descontinuações e prazos do Dr.Sig — versões do package.json, Expo SDK, Google Play, avisos de Supabase/Mercado Pago/Resend/AssemblyAI/DeepSeek. Escreve operacao/dependencias/AAAA-MM-DD.md e abre PR só para atualizações de baixo risco. Use toda segunda-feira, ou quando sair notícia de descontinuação.
---

# Dependências

Delegue ao agente **guardiao** (`.claude/agents/guardiao.md`).

## Passos

1. Credenciais: `OP_SECRET` e `EXPO_PUBLIC_SUPABASE_URL` (ambiente ou `.env`). `{"acao":"rodada","agente":"guardiao"}` → guarde o `id`.
2. Pacotes: leia `package.json`; para cada dependência, `npm view <pacote> version`. Marque as que mudam o runtime (qualquer `expo-*`, `react-native*`, `@react-native-*`, pacote com código nativo) — atualizar essas exige build.
3. Expo SDK, Google Play (target API level do ano e políticas), fornecedores: consulte as fontes listadas no perfil com WebFetch/WebSearch. Anote data e link de cada aviso.
4. Escreva `operacao/dependencias/AAAA-MM-DD.md` no formato do perfil e faça commit.
5. Se houver atualização *patch* de pacote JavaScript puro: branch `dependencias/AAAA-MM-DD`, edite `package.json` (só a versão, sem tocar em `scripts`), `npm install --package-lock-only`, `npm ci`, `npx jest --silent`, `npx eslint src App.js index.js`, `npx expo-updates fingerprint:generate --platform android`. Fingerprint igual ao de `main` → `gh pr create`. Diferente → desfaça e relate.
6. `{"acao":"rodada","id":…,"resultado":"verde|amarelo|vermelho","relatorio_path":"…","resumo":"…"}` — amarelo se houver prazo a menos de 90 dias ou pacote crítico com versão maior nova; vermelho se prazo a menos de 60 dias ou descontinuação que atinja o app. Nesses dois casos, `avisar_dono`.

## Resposta ao dono

Veredito, os três itens mais urgentes com a data-limite, e o link do PR se houver.
