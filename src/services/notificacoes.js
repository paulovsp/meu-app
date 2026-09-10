// O estado das notificações do sistema — e o atalho pra resolver.
//
// O app já mandava notificação pro Android; o que faltava era a metade de
// baixo da história. Se a permissão fosse negada, `registrarPushToken`
// desistia em silêncio, e os interruptores em Perfil continuavam ligados
// prometendo avisos que nunca chegariam. A pessoa esperaria pelo aviso de
// "transcrição pronta" que o Android estava descartando.
//
// Duas coisas resolvem: dizer em que estado está, e abrir a tela certa do
// sistema. A segunda é o que economiza a pior parte — achar, dentro das
// configurações do Android, onde fica a permissão de um app específico.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import notifee, { AuthorizationStatus } from 'react-native-notify-kit';
import { CANAL_SESSAO, CANAL_CURSO } from './protecaoGravacao';

/**
 * Um canal do Android por tipo de aviso.
 *
 * Antes todo push caía num canal só, chamado "Notificações". Isso torna a
 * coluna "Celular" da matriz do Perfil inadministrável do lado do sistema:
 * quem quisesse silenciar só o aviso de atraso, deslizando a notificação
 * pro lado, silenciava junto o de transcrição pronta — e o app não tinha
 * como perceber, porque só olhava os canais de gravação.
 *
 * Os ids são estáveis: mudar um cria um canal novo e o antigo fica lá,
 * silenciado, invisível pro app.
 */
export const CANAIS_DE_AVISO = [
  { id: 'transcricao', nome: 'Transcrição pronta' },
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
  try {
    await notifee.openNotificationSettings(canalId);
    return true;
  } catch (_) {
    try {
      await notifee.openNotificationSettings();
      return true;
    } catch (__) {
      return false;
    }
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
  const nomes = {
    [CANAL_SESSAO]: 'Gravação de sessão',
    [CANAL_CURSO]: 'Gravação de aula',
    ...Object.fromEntries(CANAIS_DE_AVISO.map((c) => [c.id, c.nome])),
  };
  const silenciados = [];
  for (const id of Object.keys(nomes)) {
    try {
      const canal = await notifee.getChannel(id);
      if (canal?.blocked) silenciados.push({ id, nome: nomes[id] });
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

export { AuthorizationStatus };
