# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

# Não adicione scripts ao package.json

O `runtimeVersion` é `{ "policy": "fingerprint" }`, e o objeto `scripts` do
`package.json` entra no fingerprint (fonte `packageJson:scripts`). Acrescentar
um script — mesmo um que não toca em nada nativo, como `lint` — muda o runtime
e faz o `eas update` publicar para um runtime que nenhum aparelho instalado
tem: a atualização sobe, aparece na lista, e não chega a ninguém.

Rode as ferramentas direto:

    npx eslint src App.js index.js

Para conferir antes de publicar, o fingerprint atual tem que bater com o
runtime da versão que está na Play Console:

    npx expo-updates fingerprint:generate --platform android
