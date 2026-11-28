// ─── Largura da versão de computador ────────────────────────────────────
//
// As telas do Dr.Sig foram desenhadas para o celular, e várias calculam o
// tamanho das coisas a partir da largura da tela (Dimensions), na hora em
// que o arquivo é carregado. Numa tela de computador de 1.900 px isso
// esticaria tudo. Na versão web o app fica numa coluna central, e a
// largura que as telas "enxergam" é a dessa coluna.
//
// Este arquivo precisa ser importado antes de qualquer tela (index.js).
// No celular não faz nada.
import { Dimensions, Platform } from 'react-native';

export const LARGURA_MAXIMA_WEB = 960;

if (Platform.OS === 'web') {
  const original = Dimensions.get.bind(Dimensions);
  Dimensions.get = (qual) => {
    const medidas = original(qual);
    if (!medidas || medidas.width <= LARGURA_MAXIMA_WEB) return medidas;
    return { ...medidas, width: LARGURA_MAXIMA_WEB };
  };
}
