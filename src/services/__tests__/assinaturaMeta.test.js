// Conferência da assinatura dos webhooks do WhatsApp (Meta).
//
// Testado porque é o que separa uma mensagem real de um comprovante
// forjado — e comprovante confirmado marca pagamento como recebido. Até
// 05/09/2026 esta verificação não existia: a função aceitava qualquer POST,
// e o endereço dela é exibido na tela de Apps conectados, então bastava
// conhecê-lo para injetar comprovante na fila de alguém.
//
// O valor de referência abaixo foi calculado FORA do código, com
// `openssl dgst -sha256 -hmac`, justamente para o teste não validar a
// implementação contra ela mesma.
const { assinaturaMetaConfere } = require('../../../supabase/functions/_shared/assinaturaMeta.ts');

const CORPO = '{"entry":[{"id":"1"}]}';
const SEGREDO = 'segredo-de-teste';
const HMAC_DO_OPENSSL = '690e12c0ce581273d56d26953de121f5e164da56f45e8475829924e9e6ea0c5a';
const ASSINATURA_VALIDA = `sha256=${HMAC_DO_OPENSSL}`;

describe('assinaturaMetaConfere', () => {
  it('aceita a assinatura correta (conferida contra o openssl)', async () => {
    await expect(assinaturaMetaConfere(ASSINATURA_VALIDA, CORPO, SEGREDO)).resolves.toBe(true);
  });

  it('recusa quando não vem assinatura nenhuma', async () => {
    await expect(assinaturaMetaConfere(null, CORPO, SEGREDO)).resolves.toBe(false);
    await expect(assinaturaMetaConfere('', CORPO, SEGREDO)).resolves.toBe(false);
  });

  it('recusa assinatura de outro segredo', async () => {
    await expect(assinaturaMetaConfere(ASSINATURA_VALIDA, CORPO, 'outro-segredo')).resolves.toBe(false);
  });

  // O ataque que isto impede: pegar um envio legítimo e trocar o conteúdo
  // (outro valor, outro remetente) mantendo a assinatura original.
  it('recusa quando o corpo foi alterado depois de assinado', async () => {
    const corpoAdulterado = '{"entry":[{"id":"2"}]}';
    await expect(assinaturaMetaConfere(ASSINATURA_VALIDA, corpoAdulterado, SEGREDO)).resolves.toBe(false);
  });

  // Sem App Secret guardado não há como conferir nada — e nesse caso a
  // resposta certa é recusar, nunca "deixar passar porque não dá para
  // checar".
  it('recusa quando não há App Secret configurado', async () => {
    await expect(assinaturaMetaConfere(ASSINATURA_VALIDA, CORPO, null)).resolves.toBe(false);
    await expect(assinaturaMetaConfere(ASSINATURA_VALIDA, CORPO, '')).resolves.toBe(false);
  });

  it('recusa assinatura sem o prefixo sha256=', async () => {
    await expect(assinaturaMetaConfere(HMAC_DO_OPENSSL, CORPO, SEGREDO)).resolves.toBe(false);
  });
});
