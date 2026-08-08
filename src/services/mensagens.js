// ─── Templates de mensagem editáveis (item F.17) ────────────────────────
// Cada profissional pode escrever o próprio texto (com variáveis tipo
// {{nome}}) em Perfil → Mensagens personalizadas, ou deixar em branco pra
// usar o texto padrão do Dr.Sig abaixo. Usado em 3 pontos: lembrete de
// cobrança (WhatsApp/e-mail em Recebíveis) e os 2 e-mails de recibo/nota
// (pro analisante, pro contador — o mesmo template do contador serve pra
// recibo e nota, já que os dois são "mensagem pro contador").

export function renderizarTemplate(template, variaveis) {
  return Object.entries(variaveis).reduce(
    (texto, [chave, valor]) => texto.split(`{{${chave}}}`).join(valor ?? ''),
    template
  );
}

export const VARIAVEIS_COBRANCA = ['nome', 'valor', 'dia_pagamento', 'chave_pix'];
export const VARIAVEIS_RECIBO_PACIENTE = ['nome', 'periodo', 'profissional'];
export const VARIAVEIS_RECIBO_CONTADOR = ['nome', 'periodo', 'valor', 'cpf_texto', 'profissional'];

export function templatePadraoCobranca(temPix) {
  const linhaPix = temPix ? ' Chave Pix para pagamento: {{chave_pix}}.' : '';
  return `Olá, {{nome}}. Escrevo para lembrar da contribuição financeira deste mês, no valor de {{valor}}, no dia {{dia_pagamento}}.${linhaPix} Qualquer dúvida, estou à disposição.`;
}

export function templatePadraoReciboPaciente() {
  return 'Olá, {{nome}}. Segue em anexo o recibo de prestação de serviços referente a {{periodo}}, emitido por {{profissional}}.';
}

export function templatePadraoReciboContador() {
  return 'Segue em anexo o recibo emitido para {{nome}}, referente a {{periodo}}.';
}

export function templatePadraoNotaContador() {
  return 'Segue o resumo para emissão da nota fiscal referente a {{nome}}{{cpf_texto}}, {{periodo}}, no valor de {{valor}}. Solicitação enviada por {{profissional}}. Por favor, emita a nota fiscal e a envie diretamente ao analisante.';
}

/** Texto final da cobrança (WhatsApp/e-mail) — usa o template do
 * profissional se ele escreveu um, senão o padrão. */
export function montarMensagemCobranca(profissional, { nome, valor, diaPagamento }) {
  const template = (profissional?.template_cobranca || '').trim() || templatePadraoCobranca(!!profissional?.pix_key);
  return renderizarTemplate(template, {
    nome,
    valor,
    dia_pagamento: diaPagamento,
    chave_pix: profissional?.pix_key || '',
  });
}

export function montarMensagemReciboPaciente(profissional, { nome, periodo }) {
  const template = (profissional?.template_recibo_paciente || '').trim() || templatePadraoReciboPaciente();
  return renderizarTemplate(template, {
    nome,
    periodo,
    profissional: profissional?.nome || 'sua psicanalista',
  });
}

export function montarMensagemReciboContador(profissional, { nome, periodo }) {
  const template = (profissional?.template_recibo_contador || '').trim() || templatePadraoReciboContador();
  return renderizarTemplate(template, {
    nome,
    periodo,
    profissional: profissional?.nome || '',
  });
}

export function montarMensagemNotaContador(profissional, { nome, periodo, valor, cpfTexto }) {
  const template = (profissional?.template_recibo_contador || '').trim() || templatePadraoNotaContador();
  return renderizarTemplate(template, {
    nome,
    periodo,
    valor,
    cpf_texto: cpfTexto || '',
    profissional: profissional?.nome || 'sua psicanalista',
  });
}
