// Versão de computador das notificações do sistema (ver notificacoes.js).
//
// No computador não há canais do Android nem permissão de push a pedir: os
// avisos continuam chegando no celular, e as opções da coluna "Celular" em
// Perfil valem para ele. 'indefinido' faz o Perfil não mostrar nenhum aviso
// de "falta liberar", que não faria sentido aqui.
// Os mesmos ids de notificacoes.js (só para quem importar a lista).
export const CANAIS_DE_AVISO = [
  { id: 'atraso', nome: 'Recebimento em atraso' },
  { id: 'sessao', nome: 'Sessões a confirmar' },
];
export async function estadoDasNotificacoes() { return 'indefinido'; }
export async function pedirPermissaoDeNotificacao() { return 'indefinido'; }
export async function abrirConfiguracoesDeNotificacao() { return false; }
export async function canaisSilenciados() { return []; }
export async function diagnosticoDeNotificacoes() {
  return { estado: 'indefinido', canaisSilenciados: [] };
}
