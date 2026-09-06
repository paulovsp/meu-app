// Abrir algo FORA do app (WhatsApp, e-mail, navegador).
//
// `Linking.openURL` devolve uma promessa que REJEITA quando não há
// aplicativo capaz de abrir aquele endereço — e sem `catch` isso vira uma
// rejeição não tratada: a pessoa toca no botão e simplesmente nada
// acontece, sem erro, sem explicação. Era o caso de "Enviar pelo WhatsApp"
// num aparelho sem WhatsApp e de "Enviar por e-mail" num Android sem app
// de e-mail configurado, que é comum.
//
// `canOpenURL` não substitui isto: no Android ele exige que o esquema
// esteja declarado em `queries` no manifesto e devolve `false` por falta de
// declaração, não por falta de app. Tentar abrir e tratar a falha é o
// caminho honesto.
import { Alert, Linking } from 'react-native';

/**
 * @param url        endereço a abrir
 * @param seNaoAbrir { titulo, texto } mostrado quando nada consegue abrir
 * @returns true se abriu
 */
export async function abrirLinkExterno(url, seNaoAbrir) {
  try {
    await Linking.openURL(url);
    return true;
  } catch (_) {
    Alert.alert(
      seNaoAbrir?.titulo || 'Não foi possível abrir',
      seNaoAbrir?.texto || 'Nenhum aplicativo neste aparelho consegue abrir esse link.'
    );
    return false;
  }
}
