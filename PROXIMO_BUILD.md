# O que entra no próximo build

Melhorias que exigem build novo porque mexem no lado nativo — instalar um
módulo, mudar permissão, mexer em plugin. Nenhuma delas cabe em OTA: o
`runtimeVersion` é fingerprint, e essas mudanças alteram o fingerprint (ver
[AGENTS.md](AGENTS.md)).

A regra: **não piorar a usabilidade só pra caber num OTA.** Quando a saída
sem build for pior pra quem usa, a boa vai pra esta lista e a saída
provisória fica documentada no código, com o motivo.

Quando um build for feito, aplicar tudo o que estiver aqui de uma vez — e
esvaziar o arquivo.

---

## 1. Botão de copiar de verdade no Pix

**Onde:** [src/screens/RecargaCreditosScreen.js](src/screens/RecargaCreditosScreen.js)

**Hoje:** o "Pix copia e cola" abre o menu de compartilhar (`Share`) e conta
com o toque longo do Android pra selecionar o texto.

**Deveria:** um toque, o código na área de transferência, e o rótulo virando
"Copiado". É o gesto que qualquer pessoa espera de um copia-e-cola, e o
caminho pelo compartilhar tem um passo a mais bem no meio de um pagamento.

**O que fazer:**

```bash
npx expo install expo-clipboard
```

Trocar a função `compartilhar()` por:

```js
async function copiar() {
  if (!cobranca?.emv) return;
  await Clipboard.setStringAsync(cobranca.emv);
  setCopiado(true);
  setTimeout(() => setCopiado(false), 2500);
}
```

com `import * as Clipboard from 'expo-clipboard';`, o ícone voltando a
`copy-outline` / `checkmark` e o rótulo a "Tocar para copiar" / "Copiado".
Apagar o comentário que explica por que era Share.

---

## Como conferir antes de publicar

Depois de qualquer mudança nativa, o fingerprint muda — e é isso que obriga
o build. Pra confirmar qual runtime o pacote atual atinge:

```bash
npx expo-updates fingerprint:generate --platform android
```

O valor tem que bater com o runtime da versão que está na Play Console.
Runtimes conhecidos: **v22 = `3be34136…`**, **v21 = `283bd312…`**.
