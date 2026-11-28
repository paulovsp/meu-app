// Transforma um HTML em PDF e devolve o conteúdo em base64.
//
// No celular quem faz é o próprio sistema (expo-print). Na versão de
// computador entra pdf.web.js (o Metro escolhe o .web.js sozinho), que
// desenha a página no navegador.
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';

export async function htmlParaPdfBase64(html) {
  const { uri } = await Print.printToFileAsync({ html });
  return FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
}
