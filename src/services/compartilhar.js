// Compartilhar texto e baixar arquivos, nas duas versões do app.
//
// No celular, "compartilhar" abre a folha do sistema (WhatsApp, e-mail...).
// No computador essa folha quase nunca existe: o texto é copiado para a
// área de transferência, e a pessoa cola onde quiser. Arquivos vão para a
// pasta Downloads.
import { Alert, Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

export async function compartilharTexto(mensagem) {
  if (Platform.OS !== 'web') return Share.share({ message: mensagem });
  if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.({ text: mensagem })) {
    try {
      await navigator.share({ text: mensagem });
      return { action: 'sharedAction' };
    } catch (e) {
      if (e?.name === 'AbortError') return { action: 'dismissedAction' };
    }
  }
  await Clipboard.setStringAsync(mensagem);
  Alert.alert('Texto copiado', 'Agora é só colar (Ctrl+V) onde quiser enviar.');
  return { action: 'sharedAction' };
}

export function baixarNoNavegador(nomeArquivo, conteudo, tipo) {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
