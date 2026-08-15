// Fonte única dos botões de navegação das abas Clínica/Administrativo —
// usada pela grade da InicioScreen.js E pelo MenuLateral.js (item 7 da leva
// pós-teste: o menu de 3 barras passou a abrir em outras telas além da
// Início, sempre mostrando essas mesmas seções globais).
export const CLINICA_BUTTONS = [
  { id: 'session',  icon: 'mic-outline',      label: 'Nova Sessão',   screen: 'NewSession', corBadge: '#3D5A80' },
  { id: 'record',   icon: 'clipboard-outline', label: 'Novo Registro', screen: 'AddRecord',  corBadge: '#4C9F8F' },
  { id: 'patients', icon: 'people-outline',    label: 'Analisantes e Supervisionandos', screen: 'Patients', corBadge: '#C97B4A' },
  { id: 'search',   icon: 'sparkles-outline',  label: 'Busca Dr.Sig',  screen: 'Busca',      corBadge: '#7B6FA6' },
];

export const ADMIN_BUTTONS = [
  { id: 'pagamentos', icon: 'wallet-outline',     label: 'Pagamentos', screen: 'Pagamentos', corBadge: '#4C8FA6' },
  { id: 'financeiro', icon: 'stats-chart-outline', label: 'Financeiro',  screen: 'Financeiro', corBadge: '#5B8C5A' },
  { id: 'cobranca',   icon: 'cash-outline',        label: 'Recebíveis',  screen: 'Cobranca',   corBadge: '#D9A441', corIcone: '#1C1C1E' },
  { id: 'fiscal',     icon: 'receipt-outline',     label: 'Fiscal',      screen: 'Fiscal',    corBadge: '#A65C4C' },
];
