// ─── Dr.Sig · tokens visuais ───────────────────────────────────────────
// Fonte única de cor, tipografia, espaço, forma e movimento.
// A partir daqui nenhuma tela deve declarar hexadecimal solto: se faltar
// alguma cor, ela entra aqui primeiro.
//
// A direção é "papel e água": um só chão morno em todas as telas, a cor
// entrando lavada (véu para superfície, tinta para ícone e texto), e a
// separação feita por luz — sombra larga e quente — em vez de contorno.
// O antigo azul #3D5A80 não existe mais: a marca é verde.

// ─── Papel — os fundos ──────────────────────────────────────────────────
export const papel = {
  base: '#F7F5F0',       // fundo de toda tela, sem exceção
  alto: '#FDFCFA',       // cartão, campo, lista
  puro: '#FFFFFF',       // só modal e folha sobre o conteúdo
  linha: '#EAE5DC',      // o único fio de 1 px do app
  linhaForte: '#DDD6CA', // divisória entre seções de uma mesma tela
  veu: '#F1EDE5',        // estado pressionado, faixa alternada
};

// ─── Tinta — os textos (razões contra papel.base) ───────────────────────
export const tinta = {
  t900: '#302C28', // 12,7:1 — títulos e números grandes
  t700: '#4E4941', //  8,2:1 — corpo, valores, conteúdo
  t500: '#756E66', //  4,6:1 — rótulo, legenda, placeholder
  t400: '#8C857B', //  3,4:1 — desabilitado e ícone decorativo. Nunca texto essencial.
  t300: '#A9A299', //  2,3:1 — só traço e separador
};

// ─── Sálvia — a cor da marca ────────────────────────────────────────────
export const salvia = {
  tinta: '#497363',  // ação principal, filete, ícone ativo. Branco em cima: 5,4:1
  funda: '#3A5C4F',  // logotipo e título sobre fundo claro
  base: '#6B9E8A',   // decorativa — ondas, cabeçalho
  suave: '#A8CBBA',  // segundo plano de ilustração, filete fino
  veu: '#E4EFE9',    // fundo de item ativo, aro de foco
  veuForte: '#D6E9DF', // topo do degradê das células da Início
};

// ─── Semânticas — véu para superfície, tinta para texto ─────────────────
export const semantica = {
  sucesso: { tinta: '#44745B', veu: '#E2EFE8', borda: '#CBE0D3' },
  atencao: { tinta: '#7D6540', veu: '#F2E9DC', borda: '#E3D5BC' },
  erro:    { tinta: '#975451', veu: '#F1E4E3', borda: '#E3C9C7' },
  info:    { tinta: '#4D6B88', veu: '#E3EAF1', borda: '#C4D3E0' },
};

// ─── Acentos por seção — véu na superfície, tinta no ícone ──────────────
export const acento = {
  session:    { veu: '#EFDFDF', tinta: '#8F5456' },
  record:     { veu: '#DFEFE9', tinta: '#447362' },
  patients:   { veu: '#EFE4DF', tinta: '#825F4D' },
  relatorios: { veu: '#EFE9DF', tinta: '#776746' },
  busca:      { veu: '#E2DFEF', tinta: '#675A9A' },
  pagamentos: { veu: '#DFE9EF', tinta: '#4B6B80' },
  financeiro: { veu: '#E5EFDF', tinta: '#567243' },
  cobranca:   { veu: '#EFE9DF', tinta: '#776746' },
  fiscal:     { veu: '#EFE2DF', tinta: '#875B50' },
};

// ─── Espaço, forma e elevação ───────────────────────────────────────────
export const espaco = { xxs: 2, xs: 4, sm: 8, md: 12, base: 16, gut: 20, lg: 24, xl: 32, xxl: 40 };
export const raio = { sm: 8, md: 12, lg: 16, xl: 20, pilula: 28, circulo: 999 };

// Sombra quente: a própria tinta do texto, diluída. Nunca #000 — sombra
// preta sobre papel morno lê como sujeira, não como profundidade.
export const sombra = {
  e1: { shadowColor: '#4E4941', shadowOffset: { width: 0, height: 2 },  shadowOpacity: 0.05, shadowRadius: 8,  elevation: 1 },
  e2: { shadowColor: '#4E4941', shadowOffset: { width: 0, height: 6 },  shadowOpacity: 0.07, shadowRadius: 18, elevation: 3 },
  e3: { shadowColor: '#4E4941', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.12, shadowRadius: 34, elevation: 8 },
};

// ─── A moldura tripla ───────────────────────────────────────────────────
// A invenção formal própria do app, com a proporção invertida: a linha
// central é a substância (3 dp ≈ 0,5 mm), as duas finas dão a leveza.
// Usar sempre os três níveis aninhados, nesta ordem.
export const moldura = {
  fina: salvia.suave,
  grossa: salvia.tinta,
  externa: { borderWidth: 1, borderColor: salvia.suave, borderRadius: 21, padding: 2 },
  central: { borderWidth: 3, borderColor: salvia.tinta, borderRadius: 18, padding: 2 },
  interna: { borderWidth: 1, borderColor: salvia.suave, borderRadius: 13, overflow: 'hidden' },
  campo:   { borderRadius: 12, overflow: 'hidden' },
};

// ─── Tipografia — oito papéis, toda medida com entrelinha ───────────────
export const tipo = {
  marca:   { fontSize: 34, lineHeight: 40, fontWeight: '600', fontStyle: 'italic', letterSpacing: -0.7, color: salvia.funda },
  titulo:  { fontSize: 24, lineHeight: 32, fontWeight: '600', letterSpacing: -0.5, color: tinta.t900 },
  secao:   { fontSize: 16, lineHeight: 22, fontWeight: '500', color: tinta.t900 },
  cartao:  { fontSize: 15, lineHeight: 21, fontWeight: '500', color: tinta.t900 },
  corpo:   { fontSize: 15, lineHeight: 23, fontWeight: '400', color: tinta.t700 },
  corpoSm: { fontSize: 13, lineHeight: 20, fontWeight: '400', color: tinta.t700 },
  legenda: { fontSize: 12, lineHeight: 17, fontWeight: '400', color: tinta.t500 },
  rotulo:  { fontSize: 11, lineHeight: 14, fontWeight: '500', letterSpacing: 1.5,
             textTransform: 'uppercase', color: tinta.t500 },
};

// ─── Movimento ──────────────────────────────────────────────────────────
export const movimento = {
  toque: { escala: 0.985, opacidade: 0.92, duracao: 120 },
  entrada: { deslocamento: 8, duracao: 220, escalonamento: 30 },
  tela: { duracao: 280 },
  modal: { duracao: 200, deslocamento: 24 },
};

// ─── Área segura ────────────────────────────────────────────────────────
// Toda tela usa SafeAreaView com as bordas certas; onde houver barra fixa
// no pé, somar insets.bottom ao paddingBottom.
export const areaSegura = {
  telaCheia: ['top', 'bottom'],
  comHeader: ['bottom'],
};

export default {
  papel, tinta, salvia, semantica, acento,
  espaco, raio, sombra, moldura, tipo, movimento, areaSegura,
};
