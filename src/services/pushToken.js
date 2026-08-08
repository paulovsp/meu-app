// Registro do token de push (Expo) — chamado uma vez por sessão de app,
// silenciosamente: se a pessoa negar a permissão de notificação, o app
// continua funcionando normalmente, só sem push (a tela de detalhe da
// sessão já tem um botão "Atualizar" como reforço pra esse caso).
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { salvarPushToken } from './database';

export async function registrarPushToken() {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Notificações',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const { status: statusAtual } = await Notifications.getPermissionsAsync();
    let status = statusAtual;
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;

    await salvarPushToken(token);
  } catch (err) {
    console.warn('Registro de push token:', err.message);
  }
}
