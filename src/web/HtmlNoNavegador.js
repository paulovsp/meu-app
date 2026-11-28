// Mostra um documento HTML (o conteúdo de um registro) na versão de
// computador, no lugar da WebView do celular.
//
// Fica numa moldura isolada (iframe com sandbox, sem scripts), para o
// texto do registro nunca poder rodar nada dentro do app. A altura se
// ajusta ao conteúdo, como a WebView faz no celular.
import React, { useEffect, useRef, useState } from 'react';

export default function HtmlNoNavegador({ html }) {
  const ref = useRef(null);
  const [altura, setAltura] = useState(300);

  useEffect(() => {
    const moldura = ref.current;
    if (!moldura) return undefined;
    let observador;
    const medir = () => {
      const corpo = moldura.contentDocument?.body;
      if (corpo) setAltura(Math.max(40, corpo.scrollHeight));
    };
    const aoCarregar = () => {
      medir();
      const corpo = moldura.contentDocument?.body;
      if (corpo && typeof ResizeObserver !== 'undefined') {
        observador = new ResizeObserver(medir);
        observador.observe(corpo);
      }
    };
    moldura.addEventListener('load', aoCarregar);
    return () => {
      moldura.removeEventListener('load', aoCarregar);
      observador?.disconnect();
    };
  }, [html]);

  return (
    <iframe
      ref={ref}
      title="Conteúdo do registro"
      srcDoc={html}
      sandbox="allow-same-origin"
      style={{ width: '100%', height: altura, border: 0, display: 'block' }}
    />
  );
}
