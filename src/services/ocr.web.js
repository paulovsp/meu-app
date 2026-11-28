// Versão de computador: o leitor de texto de foto do expo-text-extractor é
// só do celular. A tela Novo registro já esconde o botão quando
// isSupported é falso. Ver ocr.js.
export const isSupported = false;
export async function extractTextFromImage() {
  throw new Error('A leitura de texto de foto só está disponível no celular.');
}
