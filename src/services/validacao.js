// ─── Validação de cadastro ─────────────────────────────────────────────
// CPF (dígito verificador) e conversão de data entre o formato exibido
// (DD/MM/AAAA) e o formato que o Postgres espera numa coluna `date`
// (AAAA-MM-DD) — sem essa conversão, "25/07/2026" pode ser interpretado
// errado ou rejeitado pelo banco, dependendo da configuração regional dele.
import { AsYouType } from 'libphonenumber-js';

/** (11) 9 9999-9999 (celular, 9 dígitos locais) ou (11) 9999-9999 (fixo, 8
 * dígitos) — sempre 4 dígitos depois do último hífen. Decide celular vs fixo
 * pelo primeiro dígito após o DDD: todo celular brasileiro (formato novo)
 * começa com 9. `numeros` já vem só com DDD + número local (sem DDI). */
function formatarTelefoneBR(numeros) {
  if (!numeros) return '';
  const ddd = numeros.slice(0, 2);
  const resto = numeros.slice(2, 11);
  if (numeros.length <= 2) return `(${ddd}`;
  if (!resto) return `(${ddd}) `;

  const celular = resto[0] === '9';
  const nono = celular ? resto.slice(0, 1) : '';
  const meio = celular ? resto.slice(1, 5) : resto.slice(0, 4);
  const fim = celular ? resto.slice(5, 9) : resto.slice(4, 8);

  let saida = `(${ddd}) `;
  if (nono) saida += `${nono} `;
  saida += meio;
  if (fim) saida += `-${fim}`;
  return saida;
}

/** Formata telefone pra exibição: padrão brasileiro escrito à mão (regra
 * exata acima), com "+55" opcional na frente; qualquer outro código de país
 * digitado (ex: "+1...") delega pra libphonenumber-js, que cobre o formato
 * de qualquer país sem precisar escrever regra pra cada um. Nunca escreve
 * fora dígitos, "+", espaço, parênteses e hífen — quem quiser os dígitos
 * puros (ex: montar link do WhatsApp) deve sempre re-extrair com \D. */
export function formatarTelefone(texto) {
  const bruto = texto || '';
  const comDDI = bruto.trim().startsWith('+');
  const digitos = bruto.replace(/\D/g, '');
  if (!digitos) return '';

  if (comDDI) {
    if (digitos.startsWith('55')) {
      const local = formatarTelefoneBR(digitos.slice(2, 13));
      return local ? `+55 ${local}` : '+55';
    }
    return new AsYouType().input(`+${digitos}`);
  }

  return formatarTelefoneBR(digitos.slice(0, 11));
}

export function validarCPF(cpfTexto) {
  const cpf = (cpfTexto || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i], 10) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto >= 10) resto = 0;
  if (resto !== parseInt(cpf[9], 10)) return false;

  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i], 10) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto >= 10) resto = 0;
  return resto === parseInt(cpf[10], 10);
}

/** "25/07/2026" -> "2026-07-25". Retorna null se a data estiver incompleta. */
export function dataBRParaISO(dataBR) {
  const partes = (dataBR || '').split('/');
  if (partes.length !== 3) return null;
  const [d, m, a] = partes;
  if (d.length !== 2 || m.length !== 2 || a.length !== 4) return null;
  return `${a}-${m}-${d}`;
}

/** "2026-07-25" -> "25/07/2026". */
export function dataISOParaBR(dataISO) {
  if (!dataISO) return '';
  const [a, m, d] = dataISO.split('-');
  if (!a || !m || !d) return '';
  return `${d}/${m}/${a}`;
}

/** { anos, meses } entre uma data (BR "DD/MM/AAAA" ou ISO "AAAA-MM-DD") e
 * hoje — usado pra idade (a partir do nascimento) e tempo de análise (a
 * partir do início do acompanhamento). Retorna null se a data for
 * inválida/vazia. */
export function calcularAnosEMeses(dataStr) {
  if (!dataStr) return null;
  const hoje = new Date();
  let data;
  if (dataStr.includes('/')) {
    const [d, m, a] = dataStr.split('/').map(Number);
    if (!a || !m || !d) return null;
    data = new Date(a, m - 1, d);
  } else {
    data = new Date(dataStr);
  }
  if (isNaN(data.getTime())) return null;

  let anos = hoje.getFullYear() - data.getFullYear();
  let meses = hoje.getMonth() - data.getMonth();
  if (hoje.getDate() < data.getDate()) meses--;
  if (meses < 0) { anos--; meses += 12; }
  return { anos, meses };
}

/** { anos, meses } -> "X anos e Y meses" (plural em português). */
export function formatarAnosEMeses(obj) {
  if (!obj) return null;
  const { anos, meses } = obj;
  if (!anos && !meses) return '0 meses';
  const partes = [];
  if (anos > 0) partes.push(`${anos} ${anos === 1 ? 'ano' : 'anos'}`);
  if (meses > 0) partes.push(`${meses} ${meses === 1 ? 'mês' : 'meses'}`);
  return partes.join(' e ');
}
