// O estado das notificações do sistema — e o atalho pra resolver.
//
// O app já mandava notificação pro Android; o que faltava era a metade de
// baixo da história. Se a permissão fosse negada, `registrarPushToken`
// desistia em silêncio, e os interruptores em Perfil continuavam ligados
// prometendo avisos que nunca chegariam.
//
// Desde a remodelagem Agenda/Arquivo isto usa só o expo-notifications: o
// react-native-notify-kit existia pelo foreground service da gravação de
// sessão, que saiu do app.
//
// Duas coisas resolvem: dizer em que estado está, e abrir a tela certa do
// sistema. A segunda é o que economiza a pior parte — achar, dentro das
// configurações do Android, onde fica a permissão de um app específico.
import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

/**
 * Um canal do Android por tipo de aviso.
 *
 * Antes todo push caía num canal só, chamado "Notificações". Isso torna a
 * coluna "Celular" da matriz do Perfil inadministrável do lado do sistema:
 * quem quisesse silenciar só o aviso de atraso, deslizando a notificação
 * pro lado, silenciava junto todos os outros — e o app não tinha como
 * perceber.
 *
 * Os ids são estáveis: mudar um cria um canal novo e o antigo fica lá,
 * silenciado, invisível pro app.
 */
export const CANAIS_DE_AVISO = [
  { id: 'atraso', nome: 'Recebimento em atraso' },
  { id: 'sessao', nome: 'Sessões a confirmar' },
];

/**
 * 'liberadas'   — o sistema entrega.
 * 'bloqueadas'  — a pessoa negou; só as configurações resolvem.
 * 'nao_pedidas' — ainda não perguntamos.
 * 'indefinido'  — não deu pra saber (iOS antigo, erro). Não afirma nada.
 */
export async function estadoDasNotificacoes() {
  try {
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return 'liberadas';
    if (status === 'denied') return canAskAgain ? 'nao_pedidas' : 'bloqueadas';
    return 'nao_pedidas';
  } catch (_) {
    return 'indefinido';
  }
}

/** Pede a permissão. Devolve o estado depois da resposta. */
export async function pedirPermissaoDeNotificacao() {
  try {
    await Notifications.requestPermissionsAsync();
  } catch (_) {}
  return estadoDasNotificacoes();
}

/**
 * Abre a tela de notificações DESTE app no sistema.
 *
 * Com `canalId`, abre direto a categoria — é a diferença entre "procure
 * nas configurações" e "toque aqui e ligue este interruptor". O Android
 * separa por canal, e um canal desligado silencia aquele tipo de aviso
 * mesmo com a permissão geral concedida.
 */
export async function abrirConfiguracoesDeNotificacao(canalId) {
  const pacote = Constants.expoConfig?.android?.package || 'br.com.drsig.app';
  if (Platform.OS === 'android') {
    try {
      if (canalId) {
        await Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [
          { key: 'android.provider.extra.APP_PACKAGE', value: pacote },
          { key: 'android.provider.extra.CHANNEL_ID', value: canalId },
        ]);
      } else {
        await Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
          { key: 'android.provider.extra.APP_PACKAGE', value: pacote },
        ]);
      }
      return true;
    } catch (_) {}
  }
  try {
    await Linking.openSettings();
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Canais desligados individualmente, com a permissão geral concedida.
 *
 * É o caso que engana: o app tem permissão, o Android mostra tudo certo, e
 * mesmo assim um tipo de aviso não aparece porque aquela categoria foi
 * silenciada — normalmente ao deslizar uma notificação pro lado e escolher
 * "não mostrar mais deste tipo", sem perceber o que isso desligava.
 */
export async function canaisSilenciados() {
  if (Platform.OS !== 'android') return [];
  const silenciados = [];
  for (const { id, nome } of CANAIS_DE_AVISO) {
    try {
      const canal = await Notifications.getNotificationChannelAsync(id);
      if (canal && canal.importance === Notifications.AndroidImportance.NONE) {
        silenciados.push({ id, nome });
      }
    } catch (_) {}
  }
  return silenciados;
}

/** Só pra manter num lugar só o que a tela de Perfil precisa saber. */
export async function diagnosticoDeNotificacoes() {
  const [estado, canais] = await Promise.all([
    estadoDasNotificacoes(),
    canaisSilenciados(),
  ]);
  return { estado, canaisSilenciados: canais };
}

