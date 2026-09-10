# O que entra no próximo build

Melhorias que exigem build novo porque mexem no lado nativo — instalar um
módulo, mudar permissão, mexer em plugin ou em asset nativo. Nenhuma delas
cabe em OTA: o `runtimeVersion` é fingerprint, e essas mudanças alteram o
fingerprint (ver [AGENTS.md](AGENTS.md)).

A regra: **não piorar a usabilidade só pra caber num OTA.** Quando a saída
sem build for pior pra quem usa, a boa vai pra esta lista e a saída
provisória fica documentada no código, com o motivo.

---

## Nada pendente

Tudo o que estava acumulado entrou na v23. Registro do que foi:

- **Splash screen.** Não existia nenhuma configuração: o app abria numa tela
  branca vazia, que era a primeira coisa que se via toda vez. O
  `splash-icon.png` que estava no projeto era o placeholder do template do
  Expo, com um grid cinza — nunca trocado.
- **Ícone de notificação.** O `expo-notifications` tinha `color` mas não
  `icon`. Sem ícone, o Android usa o do app, e como ele é opaco de canto a
  canto o resultado na barra era um quadrado branco. Agora é uma silhueta
  gerada da própria arte.
- **Ícone monocromático** para os ícones temáticos do Android 13+, que sem
  ele caem num genérico.
- **Botão de copiar do Pix.** Passava pelo menu de compartilhar, um passo a
  mais no meio de um pagamento. Agora é um toque e "Copiado".
- **Volta preditiva** do Android 14+.

---

## Como conferir antes de publicar

Depois de qualquer mudança nativa o fingerprint muda — e é isso que obriga
o build. Pra confirmar qual runtime o pacote atual atinge:

```bash
npx expo-updates fingerprint:generate --platform android
```

O valor tem que bater com o runtime da versão que está na Play Console.
Runtimes conhecidos: **v22 = `3be34136…`**, **v21 = `283bd312…`**.
