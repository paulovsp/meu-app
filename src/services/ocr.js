// Leitura de texto de uma foto, feita no próprio aparelho (Google ML Kit,
// pelo expo-text-extractor). Na versão de computador entra ocr.web.js,
// que diz "não suportado", e a tela esconde o botão.
export { isSupported, extractTextFromImage } from 'expo-text-extractor';
