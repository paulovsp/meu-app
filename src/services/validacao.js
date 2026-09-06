// ─── Validação de cadastro ─────────────────────────────────────────────
// CPF (dígito verificador) e conversão de data entre o formato exibido
// (DD/MM/AAAA) e o formato que o Postgres espera numa coluna `date`
// (AAAA-MM-DD) — sem essa conversão, "25/07/2026" pode ser interpretado
// errado ou rejeitado pelo banco, dependendo da configuração regional dele.

/** Sempre termina com 4 dígitos após o hífen. Se sobrarem 5 dígitos antes
 * dele (celular com o 9 extra), separa o primeiro deles com um espaço —
 * "9 9999-9999". Com 4 ou menos antes do hífen (fixo, ou ainda digitando),
 * fica só "9999-9999". Não tenta mais "adivinhar" celular vs fixo pelo
 * primeiro dígito — quem decide agora é a caixa em que a pessoa digitou. */
export function formatarNumeroLocalTelefone(digitos) {
  const d = (digitos || '').replace(/\D/g, '').slice(0, 9);
  if (d.length <= 4) return d;
  const antes = d.slice(0, d.length - 4);
  const depois = d.slice(-4);
  if (antes.length === 5) return `${antes[0]} ${antes.slice(1)}-${depois}`;
  return `${antes}-${depois}`;
}

/** Quebra um telefone já salvo (de qualquer formato anterior) em
 * { ddi, ddd, numero } pras 3 caixas do TelefoneInput. Sem "+" na frente,
 * assume DDI 55 (padrão anterior do app, sempre foi só número nacional). */
export function parseTelefone(texto) {
  const bruto = texto || '';
  const comDDI = bruto.trim().startsWith('+');
  const digitos = bruto.replace(/\D/g, '');
  if (!digitos) return { ddi: '55', ddd: '', numero: '' };

  if (comDDI) {
    if (digitos.startsWith('55')) {
      return { ddi: '55', ddd: digitos.slice(2, 4), numero: digitos.slice(4, 13) };
    }
    // Outro DDI: só sabemos que os 2 primeiros dígitos costumam ser o
    // código do país (a maioria tem 1-3 dígitos, mas não dá pra adivinhar
    // o tamanho certo de cada um sem uma tabela — a pessoa pode ajustar
    // na própria caixa de DDI se vier errado).
    return { ddi: digitos.slice(0, 2), ddd: '', numero: digitos.slice(2, 13) };
  }

  return { ddi: '55', ddd: digitos.slice(0, 2), numero: digitos.slice(2, 11) };
}

/** Monta a string final a partir das 3 caixas (DDI, DDD, número) — sempre
 * com "+" na frente, DDD entre parênteses quando presente, e o número já
 * formatado pela regra do hífen/espaço acima. */
export function montarTelefone(ddi, ddd, numero) {
  const ddiDigitos = (ddi || '').replace(/\D/g, '') || '55';
  const dddDigitos = (ddd || '').replace(/\D/g, '');
  const numeroDigitos = (numero || '').replace(/\D/g, '');
  if (!dddDigitos && !numeroDigitos) return '';

  let saida = `+${ddiDigitos}`;
  if (dddDigitos) saida += ` (${dddDigitos})`;
  const numeroFormatado = formatarNumeroLocalTelefone(numeroDigitos);
  if (numeroFormatado) saida += ` ${numeroFormatado}`;
  return saida;
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

/**
 * Data no fuso de QUEM ESTÁ USANDO o app, como "AAAA-MM-DD".
 *
 * Existe porque o caminho óbvio está errado: `toISOString().slice(0, 10)`
 * converte pra UTC antes de cortar, e no Brasil (UTC−3) qualquer coisa
 * depois das 21h já cai no dia seguinte. Um horário avulso marcado pra
 * hoje sumia da lista às 21h; a varredura de "compromissos futuros"
 * passava a ignorar os de hoje; uma despesa de curso nascia com a data de
 * amanhã. Nenhum desses erros aparece de dia — só à noite, que é quando a
 * profissional costuma organizar a semana.
 *
 * A versão certa monta a string a partir dos componentes LOCAIS, e estava
 * copiada em quatro arquivos. Agora é uma só.
 */
export function dataParaISO(data = new Date()) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/** Hoje, no fuso local. Atalho de `dataParaISO()`. */
export function hojeISO() {
  return dataParaISO(new Date());
}

/**
 * "AAAA-MM-DD" -> Date à MEIA-NOITE LOCAL.
 *
 * `new Date('2026-09-06')` é lido como meia-noite UTC — que no Brasil é
 * 05/09 às 21h. Quem chamasse `.getDay()` nisso recebia o dia da semana
 * ANTERIOR, e foi assim que a Agenda mandava o dia errado pra tela de
 * edição de horário. Passando ano/mês/dia separados, o Date nasce local.
 */
export function dataISOParaData(dataISO) {
  if (!dataISO) return null;
  const [ano, mes, dia] = String(dataISO).split('-').map(Number);
  if (!ano || !mes || !dia) return null;
  return new Date(ano, mes - 1, dia);
}

/** Dia da semana (0 = domingo) de uma data "AAAA-MM-DD", sem o desvio de
 *  fuso descrito em `dataISOParaData`. */
export function diaSemanaDeISO(dataISO) {
  const d = dataISOParaData(dataISO);
  return d ? d.getDay() : null;
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
    // `new Date('1980-05-15')` nasce em UTC — e no Brasil isso é 14/05 às
    // 21h. O `getDate()` logo abaixo lia 14, e a idade saía um mês errada
    // na virada do aniversário.
    data = dataISOParaData(dataStr) || new Date(dataStr);
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
