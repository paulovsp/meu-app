// Config plugin: declara o foreground service de gravação do notifee com
// android:foregroundServiceType="microphone" no AndroidManifest.xml.
//
// Por quê: o notifee fornece a classe app.notifee.core.ForegroundService,
// mas não a declara no próprio AndroidManifest do módulo — quem usa a
// biblioteca precisa declarar. A partir do Android 14 (API 34), todo
// foreground service tem que declarar explicitamente o(s) tipo(s) que usa,
// e o sistema confere a permissão correspondente (RECORD_AUDIO, no caso de
// "microphone") na hora de iniciar o service — sem essa declaração, iniciar
// o service com esse tipo derruba a gravação em segundo plano.
//
// tools:replace é necessário porque, dependendo da ordem de merge dos
// manifests dos módulos nativos, pode já existir uma declaração do mesmo
// service sem o atributo foregroundServiceType — sem o tools:replace, o
// Gradle recusa o merge por conflito de atributo.
const { withAndroidManifest } = require('@expo/config-plugins');

const SERVICE_NAME = 'app.notifee.core.ForegroundService';

function withForegroundServiceMicrophone(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;

    if (!manifest.manifest.$['xmlns:tools']) {
      manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    const application = manifest.manifest.application[0];
    if (!application.service) {
      application.service = [];
    }

    const declaracao = {
      $: {
        'android:name': SERVICE_NAME,
        'android:foregroundServiceType': 'microphone',
        'tools:replace': 'android:foregroundServiceType',
      },
    };

    const existente = application.service.find(
      (s) => s.$['android:name'] === SERVICE_NAME
    );
    if (existente) {
      Object.assign(existente.$, declaracao.$);
    } else {
      application.service.push(declaracao);
    }

    return config;
  });
}

module.exports = withForegroundServiceMicrophone;
