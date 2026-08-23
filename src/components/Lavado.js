import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';

/**
 * Degradê vertical sem dependência nativa.
 *
 * O app tem `expo-linear-gradient` no package.json, mas nunca importado —
 * passar a usá-lo exigiria rebuild antes de qualquer teste. Como o lavado
 * daqui é de contraste muito baixo (véu de sálvia até papel), uma pilha de
 * faixas interpoladas é visualmente idêntica e roda em qualquer binário.
 *
 * `parada` é onde a cor de cima termina de se dissolver (0–1); daí para
 * baixo fica só o papel.
 */
const FAIXAS = 14;

function interpolar(de, para, t) {
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [r1, g1, b1] = hex(de);
  const [r2, g2, b2] = hex(para);
  const m = (a, b) => Math.round(a + (b - a) * t);
  return `rgb(${m(r1, r2)}, ${m(g1, g2)}, ${m(b1, b2)})`;
}

export default function Lavado({ de, para, parada = 0.74, style, children }) {
  const faixas = useMemo(() => {
    const out = [];
    for (let i = 0; i < FAIXAS; i += 1) {
      const pos = (i + 0.5) / FAIXAS;
      const t = pos >= parada ? 1 : pos / parada;
      out.push(interpolar(de, para, t));
    }
    return out;
  }, [de, para, parada]);

  return (
    <View style={style}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {faixas.map((cor, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: cor }} />
        ))}
      </View>
      {children}
    </View>
  );
}
