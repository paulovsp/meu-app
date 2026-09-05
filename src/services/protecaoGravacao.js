// O que o Android ainda pode fazer pra derrubar uma gravação em andamento —
// e o que a pessoa pode ajustar pra impedir.
//
// O foreground service (index.js + NovaSessaoScreen) é o que dá ao app o
// direito de usar o microfone com outro aplicativo na frente. Mas ele não
// basta sozinho: se as notificações do canal estiverem bloqueadas o serviço
// não tem como se anunciar, e se a otimização de bateria estiver ligada o
// sistema (ou o gerenciador do fabricante — Xiaomi, Samsung, Motorola)
// mata o processo mesmo com serviço ativo.
//
// Este módulo só DIAGNOSTICA e sabe abrir cada tela de ajuste. Quem decide
// o que fazer é a tela que chama.
import { Platform } from 'react-native';
import notifee, { AuthorizationStatus } from 'react-native-notify-kit';

/** Canal da notificação da gravação de sessão (NovaSessaoScreen). */
export const CANAL_SESSAO = 'gravacao';
/** Canal da gravação de aula (FormularioCursoScreen). */
export const CANAL_CURSO = 'gravacao_curso';

/**
 * Devolve a lista de pendências que ainda podem interromper a gravação.
 *
 * Cada item traz o texto que a pessoa lê e a ação que abre a tela do
 * sistema correspondente. Lista vazia = nada a ajustar.
 *
 * `gravidade`:
 *  - 'impede'  — sem isso a gravação em segundo plano NÃO funciona.
 *  - 'arrisca' — funciona, mas o sistema pode derrubar a qualquer momento.
 */
export async function diagnosticarProtecao(canalId = CANAL_SESSAO) {
  if (Platform.OS !== 'android') return [];
  const pendencias = [];

  try {
    const settings = await notifee.getNotificationSettings();
    if (settings.authorizationStatus === AuthorizationStatus.DENIED) {
      pendencias.push({
        id: 'notificacoes',
        gravidade: 'impede',
        titulo: 'Notificações bloqueadas',
        descricao:
          'O aviso de "Gravando sessão" é o que mantém a gravação viva com o '
          + 'app em segundo plano. Bloqueado, ele não sobe.',
        acaoLabel: 'Liberar notificações',
        abrir: () => notifee.openNotificationSettings(),
      });
    }
  } catch (_) {}

  // Permissão geral concedida mas o canal específico silenciado dá no mesmo:
  // a notificação do serviço não aparece.
  try {
    const canal = await notifee.getChannel(canalId);
    if (canal?.blocked) {
      pendencias.push({
        id: 'canal',
        gravidade: 'impede',
        titulo: 'Aviso de gravação desativado',
        descricao:
          'A categoria de notificação da gravação está desligada nas '
          + 'configurações do Android.',
        acaoLabel: 'Reativar aviso',
        abrir: () => notifee.openNotificationSettings(canalId),
      });
    }
  } catch (_) {}

  try {
    if (await notifee.isBatteryOptimizationEnabled()) {
      pendencias.push({
        id: 'bateria',
        gravidade: 'arrisca',
        titulo: 'Otimização de bateria ligada',
        descricao:
          'Com ela ligada, o Android pode encerrar o Dr.Sig no meio de uma '
          + 'sessão longa pra economizar bateria. Marque o app como "Sem '
          + 'restrições".',
        acaoLabel: 'Abrir ajuste de bateria',
        abrir: () => notifee.openBatteryOptimizationSettings(),
      });
    }
  } catch (_) {}

  // Fabricantes com gerenciador próprio (Xiaomi, Huawei, Oppo, Samsung...)
  // matam processos por conta própria, à revelia do ajuste do Android.
  try {
    const info = await notifee.getPowerManagerInfo();
    if (info?.activity) {
      pendencias.push({
        id: 'fabricante',
        gravidade: 'arrisca',
        titulo: `Gerenciador de energia da ${info.manufacturer || 'fabricante'}`,
        descricao:
          'Este aparelho tem um controle de energia próprio, além do Android. '
          + 'Libere o Dr.Sig nele também, ou a gravação pode ser encerrada em '
          + 'sessões longas.',
        acaoLabel: 'Abrir ajuste do fabricante',
        abrir: () => notifee.openPowerManagerSettings(),
      });
    }
  } catch (_) {}

  return pendencias;
}

/** Alguma pendência que impede de vez a gravação em segundo plano? */
export function impedeGravacaoEmSegundoPlano(pendencias) {
  return (pendencias || []).some((p) => p.gravidade === 'impede');
}
