---
name: pre-voo
description: A lista de pré-voo de uma versão do Dr.Sig — fingerprint contra o runtime instalado, testes, lint, migrations aplicadas, DEPLOY.md × config.toml, working tree limpo, versionCode, notas da versão a partir do git log. Roda localmente, antes de OTA ou build. Use "/pre-voo ota" ou "/pre-voo build".
---

# Pré-voo

Roda **nesta máquina** (precisa do CLI do Supabase linkado e do EAS logado). Nenhum comando aqui publica nada: `eas update` e `eas build` continuam sendo comandos do dono, e este roteiro termina dizendo exatamente qual deles rodar.

Modo em `$ARGUMENTS`: `ota` (só JavaScript) ou `build` (mudou algo nativo). Sem argumento, descubra pelo fingerprint.

## Lista

1. **Working tree** — `git status --short` vazio e `git log origin/main..HEAD` vazio. Se não, pare: primeiro commit e push.
2. **Testes e lint** — `npx jest --silent` (todos passando) e `npx eslint src App.js index.js` (0 erros).
3. **Migrations** — `npx supabase migration list --linked`: toda migration local está no remoto. Se não, é `db push` (com um "sim" do dono).
4. **Funções** — cada pasta de `supabase/functions/*/` (menos `_shared`) tem entrada em `config.toml` e linha em `DEPLOY.md`, com o mesmo `verify_jwt`. Funções alteradas desde a última tag/versão (`git diff --name-only <última-versão>..HEAD -- supabase/functions`) precisam de deploy — liste-as com a flag certa.
5. **Fingerprint** — `npx expo-updates fingerprint:generate --platform android` (hash em `.hash`). Compare com o runtime da última build: `npx eas-cli build:list --platform android --limit 1 --json` (campo `runtimeVersion`). Igual → OTA serve. Diferente → é build; confira que `android.versionCode` em `app.json` é maior que o da última build.
6. **Páginas** — `curl -s -o /dev/null -w "%{http_code}"` em cada página de `docs/` publicada em https://app.drsig.com.br/ deve dar 200.
7. **Notas da versão** — a partir de `git log --oneline <última-versão>..HEAD`, escreva as notas em linguagem de loja (o que muda para quem usa; sem jargão), em `<pt-BR>…</pt-BR>`, no máximo 500 caracteres.

## Entrega

`operacao/pre-voo/AAAA-MM-DD.md` com cada item ✅/❌ e a evidência, as notas da versão prontas, e **a ordem exata de publicação**: deploys (com flags) → `db push` → e o comando final, sem executá-lo:

```
npx eas-cli update --channel production --message "…"
```
ou
```
npx eas-cli build --platform android --profile production
```

Se qualquer item estiver ❌, o veredito é "não voa" e o comando final não aparece.
