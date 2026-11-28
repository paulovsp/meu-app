// Versão de computador de htmlParaPdfBase64 (ver pdf.js).
//
// O expo-print não gera arquivo PDF no navegador. Aqui o HTML é montado
// numa moldura escondida do tamanho de uma folha A4, fotografado em alta
// resolução (html2canvas) e colocado numa página A4 (jsPDF). O recibo é
// uma página só, então isso basta.
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

// A4 a 96 pontos por polegada: 210 × 297 mm.
const LARGURA_PX = 794;
const ALTURA_PX = 1123;

export async function htmlParaPdfBase64(html) {
  const moldura = document.createElement('iframe');
  moldura.setAttribute('aria-hidden', 'true');
  Object.assign(moldura.style, {
    position: 'fixed', left: '-10000px', top: '0',
    width: `${LARGURA_PX}px`, height: `${ALTURA_PX}px`, border: '0',
  });
  document.body.appendChild(moldura);
  try {
    const doc = moldura.contentDocument;
    doc.open();
    doc.write(html);
    doc.close();
    // Espera as imagens (a assinatura desenhada) carregarem.
    await Promise.all(
      Array.from(doc.images).map((img) => (img.complete ? null : new Promise((ok) => {
        img.onload = ok; img.onerror = ok;
      })))
    );
    const corpo = doc.body;
    corpo.style.margin = '0';
    corpo.style.width = `${LARGURA_PX}px`;
    corpo.style.minHeight = `${ALTURA_PX}px`;
    corpo.style.boxSizing = 'border-box';
    corpo.style.background = '#fff';

    const tela = await html2canvas(corpo, {
      scale: 2, backgroundColor: '#ffffff', width: LARGURA_PX, windowWidth: LARGURA_PX,
    });
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const alturaMm = Math.min(297, (tela.height / tela.width) * 210);
    pdf.addImage(tela.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, alturaMm);
    return pdf.output('datauristring').split(',')[1];
  } finally {
    moldura.remove();
  }
}
