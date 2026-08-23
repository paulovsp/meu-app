// Fonte única dos botões de navegação das abas Clínica/Administrativo —
// usada pela grade da InicioScreen.js E pelo MenuLateral.js (item 7 da leva
// pós-teste: o menu de 3 barras passou a abrir em outras telas além da
// Início, sempre mostrando essas mesmas seções globais).
// bloqueiaSemAssinatura: telas de criação — a mesma tela já tem o
// mount-guard (useBloqueioAssinatura) como rede de segurança, mas checar
// aqui evita a "piscada" de abrir a tela pra só então mostrar o aviso e
// voltar.
export const CLINICA_BUTTONS = [
  { id: 'session',  icon: 'mic-outline',      label: 'Nova Sessão',   screen: 'NewSession', corBadge: '#8F5456', bloqueiaSemAssinatura: true },
  { id: 'record',   icon: 'clipboard-outline', label: 'Novo Registro', screen: 'AddRecord',  corBadge: '#447362', bloqueiaSemAssinatura: true },
  { id: 'patients', icon: 'people-outline',    label: 'Clientes', screen: 'Patients', corBadge: '#825F4D' },
  { id: 'relatorios', icon: 'document-text-outline', label: 'Relatórios', screen: 'Relatorios', corBadge: '#776746' },
];

export const ADMIN_BUTTONS = [
  { id: 'pagamentos', icon: 'wallet-outline',     label: 'Pagamentos', screen: 'Pagamentos', corBadge: '#4B6B80' },
  { id: 'financeiro', icon: 'stats-chart-outline', label: 'Financeiro',  screen: 'Financeiro', corBadge: '#567243' },
  { id: 'cobranca',   icon: 'cash-outline',        label: 'Recebíveis',  screen: 'Cobranca',   corBadge: '#776746', corIcone: '#302C28' },
  { id: 'fiscal',     icon: 'receipt-outline',     label: 'Fiscal',      screen: 'Fiscal',    corBadge: '#875B50' },
];
