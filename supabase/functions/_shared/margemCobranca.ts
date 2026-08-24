// Fonte única do multiplicador de cobrança sobre o custo real pago aos
// provedores de IA (DeepSeek e AssemblyAI) — o usuário paga sempre o dobro
// do custo real da empresa, decisão de negócio (não é margem de segurança
// contra reajuste de preço, é o modelo de cobrança). Usado por
// precificacaoIA.ts (transcrição) e por ia-busca/index.ts (relatórios e
// busca); espelhado em src/services/precificacaoIA.js pro app conseguir
// mostrar a mesma estimativa ANTES de chamar a IA.
export const MULTIPLICADOR_COBRANCA_USUARIO = 2;
