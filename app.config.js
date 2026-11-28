// A versão de computador (web) usa o mesmo código do app de celular.
//
// Instalar react-native-web faz o Expo incluir "web" na lista de plataformas,
// e essa lista entra no fingerprint do Android (fonte `expoConfig`). Sem este
// arquivo, só ter a versão web no repositório já mudaria o runtime e o
// `eas update` deixaria de chegar aos aparelhos instalados (ver AGENTS.md).
//
// Por isso "web" só entra quando a variável DRSIG_WEB=1 está ligada, que é
// o caso apenas ao rodar ou exportar a versão de computador:
//
//     DRSIG_WEB=1 npx expo export --platform web
//     DRSIG_WEB=1 npx expo start --web
module.exports = ({ config }) => ({
  ...config,
  platforms: process.env.DRSIG_WEB === '1' ? ['ios', 'android', 'web'] : ['ios', 'android'],
});
