import 'react-native-gesture-handler';

import { registerRootComponent } from 'expo';
import notifee from 'react-native-notify-kit';
import App from './App';

// A notificação "Gravando sessão" só vira um foreground service DE VERDADE
// se existir um runner registrado aqui, na raiz do app, antes de qualquer
// tela montar. Sem ele, o notify-kit registra a headless task com uma função
// que resolve na hora (dist/NotifeeApiModule.js:37) e o ForegroundService
// nativo chama stopForegroundCompat() logo depois de subir
// (android/.../ForegroundService.java:252) — o serviço morre em silêncio,
// sem erro nenhum pro JS.
//
// Era exatamente o sintoma relatado: com a tela bloqueada a gravação
// continuava (o app ainda era o app do topo, o Android não corta o microfone
// de quem está na frente), mas abrir outro aplicativo derrubava a captação,
// porque a partir do Android 11 só um foreground service do tipo
// `microphone` mantém o microfone de um app em segundo plano.
//
// A promessa nunca resolve de propósito: o serviço vive até alguém chamar
// notifee.stopForegroundService(), que é o que encerrarETranscrever faz.
notifee.registerForegroundService(() => new Promise(() => {}));

registerRootComponent(App);
