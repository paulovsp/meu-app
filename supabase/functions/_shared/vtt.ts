// Conversão da legenda WebVTT do Zoom para os turnos que o app usa.
// Sem nada de Deno de propósito: assim a mesma lógica roda nos testes
// (src/services/__tests__/vtt.test.js) — é a peça mais fácil de errar de
// todo o caminho do Zoom, e a que estraga a transcrição em silêncio.
/**
 * Converte a legenda VTT do Zoom nos turnos que o app já usa.
 *
 * O Zoom entrega a transcrição como WebVTT, com o nome de quem falou no
 * começo de cada fala ("Fulano: texto"). Quem abriu a reunião é a
 * profissional, então esse nome vira "A:" e os demais "P:" — mesmo critério
 * de chute usado com a AssemblyAI e com o Meet, corrigível na tela.
 *
 * Falas seguidas da mesma pessoa são unidas: o VTT quebra por tempo, não
 * por turno de conversa, e sem juntar o texto sairia picado em dezenas de
 * linhas de poucas palavras.
 */
export function vttParaTurnos(vtt: string, nomeAnfitriao: string | null): string {
  const linhas = String(vtt || '').split(/\r?\n/);
  const falas: { quem: string | null; texto: string }[] = [];

  for (const linha of linhas) {
    const t = linha.trim();
    if (!t) continue;
    if (t === 'WEBVTT' || t.startsWith('NOTE')) continue;
    if (t.includes('-->')) continue;      // linha de tempo
    if (/^\d+$/.test(t)) continue;         // número da legenda

    const m = t.match(/^([^:]{1,60}):\s*(.+)$/);
    const quem = m ? m[1].trim() : null;
    const texto = m ? m[2].trim() : t;
    if (!texto) continue;

    const anterior = falas[falas.length - 1];
    if (anterior && anterior.quem === quem) {
      anterior.texto += ` ${texto}`;
    } else {
      falas.push({ quem, texto });
    }
  }

  const anfitriaoNormalizado = (nomeAnfitriao || '').trim().toLowerCase();
  return falas
    .map(({ quem, texto }) => {
      const ehAnfitriao = !!quem && !!anfitriaoNormalizado
        && quem.toLowerCase() === anfitriaoNormalizado;
      return `${ehAnfitriao ? 'A' : 'P'}: ${texto}`;
    })
    .join('\n');
}
