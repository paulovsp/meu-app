// expo-audio embute, sem opção de desativar via app.json, um foreground
// service de media-session em segundo plano (controles na tela de
// bloqueio, tipo player de música) — ver
// node_modules/expo-audio/android/src/main/AndroidManifest.xml. Este app
// só usa expo-audio pra tocar o áudio da sessão com a tela aberta
// (DetalheSessaoScreen.js), nunca em segundo plano com controles de
// mídia. Declarar FOREGROUND_SERVICE_MEDIA_PLAYBACK sem a capacidade
// correspondente é o tipo de divergência que a revisão do Google Play (e
// a Play Data Safety) rejeita — bloqueia o merge da permissão em vez de
// justificar um uso que não existe.
const { AndroidConfig } = require('@expo/config-plugins');

function withoutForegroundServiceMediaPlayback(config) {
  return AndroidConfig.Permissions.withBlockedPermissions(config, [
    'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  ]);
}

module.exports = withoutForegroundServiceMediaPlayback;
