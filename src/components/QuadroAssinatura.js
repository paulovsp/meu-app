// Quadro onde a pessoa desenha a assinatura. No celular é a biblioteca
// react-native-signature-canvas; na versão de computador quem entra é
// QuadroAssinatura.web.js (o Metro escolhe o arquivo .web.js sozinho), que
// tem a mesma "cara" para a tela: clearSignature(), readSignature(),
// onOK(dataUri) e onEmpty().
export { default } from 'react-native-signature-canvas';
