// ─── Mandala dos Núcleos Psíquicos — SVG interativa ───────────────────────
// Reproduz a geometria paramétrica de docs/referencia-visual/mockup-tela-
// nucleos-v2.html: 4 círculos sobrepostos, asas (instâncias) como
// interseções triplas, Eu Nuclear como losango bombeado ao centro, nuvem
// de evidências com posição estável por seed do id, setas de transição.
//
// Adaptação a toque (não existe hover em mobile): tocar em qualquer
// elemento (círculo/asa/seta/ponto/centro) chama onSelecionar(...) — quem
// usa este componente decide como mostrar o painel de detalhe.

import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Circle, Text as SvgText, G } from 'react-native-svg';

const W = 340;
const H = 340;
const C = { x: W / 2, y: H / 2 };
const D = 62;
const R = 127; // R/D ≈ 2.05, mesma proporção do mockup de referência

const CIRCULOS = {
  bem: { x: C.x - D, y: C.y - D },
  mal: { x: C.x + D, y: C.y - D },
  mau: { x: C.x - D, y: C.y + D },
  bom: { x: C.x + D, y: C.y + D },
};

const S = Math.sqrt(R * R - D * D) - D;
const T = Math.sqrt(R * R - 2 * D * D) / Math.SQRT2;

const G1 = { x: C.x, y: C.y - S };
const G2 = { x: C.x + S, y: C.y };
const G3 = { x: C.x, y: C.y + S };
const G4 = { x: C.x - S, y: C.y };
const T_NW = { x: C.x - T, y: C.y - T };
const T_NE = { x: C.x + T, y: C.y - T };
const T_SE = { x: C.x + T, y: C.y + T };
const T_SW = { x: C.x - T, y: C.y + T };

const ASAS_GEOMETRIA = {
  ego: { gA: G1, tBase: T_NW, gB: G4, label: 'EGO', pos: { x: C.x - 44, y: C.y - 8 } },
  id: { gA: G1, tBase: T_NE, gB: G2, label: 'ID', pos: { x: C.x + 44, y: C.y - 8 } },
  superego: { gA: G4, tBase: T_SW, gB: G3, label: 'SUPER-EGO', pos: { x: C.x - 44, y: C.y + 40 } },
  superid: { gA: G2, tBase: T_SE, gB: G3, label: 'SUPER-ID', pos: { x: C.x + 44, y: C.y + 40 } },
};

function caminhoAsa(gA, tBase, gB, k) {
  const Tp = { x: C.x + (tBase.x - C.x) * k, y: C.y + (tBase.y - C.y) * k };
  const mA = { x: (gA.x + Tp.x) / 2, y: (gA.y + Tp.y) / 2 };
  const mB = { x: (Tp.x + gB.x) / 2, y: (Tp.y + gB.y) / 2 };
  const cA = { x: mA.x + (mA.x - C.x) * 0.2, y: mA.y + (mA.y - C.y) * 0.2 };
  const cB = { x: mB.x + (mB.x - C.x) * 0.2, y: mB.y + (mB.y - C.y) * 0.2 };
  const cIn = { x: C.x + (Tp.x - C.x) * 0.28, y: C.y + (Tp.y - C.y) * 0.28 };
  return `M${gA.x},${gA.y} Q${cA.x},${cA.y} ${Tp.x},${Tp.y} Q${cB.x},${cB.y} ${gB.x},${gB.y} Q${cIn.x},${cIn.y} ${gA.x},${gA.y} Z`;
}

function caminhoCentro() {
  const bow = (gA, gB) => {
    const mx = (gA.x + gB.x) / 2, my = (gA.y + gB.y) / 2;
    return { x: C.x + (mx - C.x) * 1.32, y: C.y + (my - C.y) * 1.32 };
  };
  const b12 = bow(G1, G2), b23 = bow(G2, G3), b34 = bow(G3, G4), b41 = bow(G4, G1);
  return (
    `M${G1.x},${G1.y} Q${b12.x},${b12.y} ${G2.x},${G2.y} Q${b23.x},${b23.y} ${G3.x},${G3.y} ` +
    `Q${b34.x},${b34.y} ${G4.x},${G4.y} Q${b41.x},${b41.y} ${G1.x},${G1.y} Z`
  );
}

function escalaAsa(valor, maxValor) {
  if (!maxValor) return 0.9;
  const k = 0.5 + (valor / maxValor) * 0.8;
  return Math.min(1.3, Math.max(0.5, k));
}

/** Gerador determinístico (mesmo algoritmo do mockup) — posição da evidência é sempre a mesma para o mesmo id. */
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 2147483647;
  return h > 0 ? h : h + 2147483646 + 1;
}

function posicaoEvidencia(id, centro, raio) {
  let seed = hashSeed(String(id)) || 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
  const spread = raio * 0.42;
  return { x: centro.x + gauss() * spread, y: centro.y + gauss() * spread };
}

export default function MandalaNucleos({ rubrica, evidencias, transicoes, asas, onSelecionar }) {
  const evidenciasComNucleo = (evidencias || []).filter((e) => e.nucleo !== 'eu_nuclear');
  const evidenciasIndizíveis = (evidencias || []).filter((e) => e.nucleo === 'eu_nuclear');

  const densidadePorNucleo = {};
  Object.keys(CIRCULOS).forEach((n) => {
    densidadePorNucleo[n] = evidenciasComNucleo.filter((e) => e.nucleo === n).length;
  });
  const maxDensidade = Math.max(1, ...Object.values(densidadePorNucleo));
  const maxAsa = Math.max(1, ...Object.values(asas || {}));

  // Setas: agrega transições por par (de,para) e conta frequência.
  const paresContagem = new Map();
  (transicoes || []).forEach((t) => {
    const chave = `${t.de_nucleo}>${t.para_nucleo}`;
    paresContagem.set(chave, (paresContagem.get(chave) || 0) + 1);
  });
  const maxTransicao = Math.max(1, ...paresContagem.values());

  return (
    <View>
      <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={W}>
        {/* eixos */}
        <SvgText x={C.x} y={16} fontSize={10} fill="#898781" textAnchor="middle" letterSpacing={2}>ATRAÇÃO</SvgText>
        <SvgText x={C.x} y={H - 6} fontSize={10} fill="#898781" textAnchor="middle" letterSpacing={2}>REPULSA</SvgText>

        {/* círculos dos núcleos */}
        {Object.entries(CIRCULOS).map(([chave, centro]) => {
          const n = rubrica.nucleos[chave];
          const opacidade = 0.08 + (densidadePorNucleo[chave] / maxDensidade) * 0.22;
          return (
            <G key={chave}>
              <Circle
                cx={centro.x} cy={centro.y} r={R}
                fill={n.cor} fillOpacity={opacidade}
                stroke={n.cor} strokeWidth={2} strokeOpacity={0.85}
                onPress={() => onSelecionar({ tipo: 'nucleo', chave, evidencias: evidenciasComNucleo.filter((e) => e.nucleo === chave) })}
              />
              <SvgText
                x={centro.x} y={centro.y - R + 20} fontSize={11} fontWeight="700"
                fill={n.cor} textAnchor="middle" stroke="#fcfcfb" strokeWidth={3} paintOrder="stroke"
              >
                {`${n.numero} · ${n.nome.toUpperCase()}`}
              </SvgText>
            </G>
          );
        })}

        {/* asas (instâncias) */}
        {Object.entries(ASAS_GEOMETRIA).map(([chave, geo]) => {
          const valor = asas?.[chave] || 0;
          const k = escalaAsa(valor, maxAsa);
          return (
            <G key={chave}>
              <Path
                d={caminhoAsa(geo.gA, geo.tBase, geo.gB, k)}
                fill="rgba(82,81,78,0.14)" stroke="#52514e" strokeWidth={1.3}
                onPress={() => onSelecionar({ tipo: 'asa', chave, valor })}
              />
              <SvgText x={geo.pos.x} y={geo.pos.y} fontSize={9.5} fontWeight="700" fill="#0b0b0b" textAnchor="middle" stroke="#fcfcfb" strokeWidth={3} paintOrder="stroke">
                {geo.label}
              </SvgText>
              <SvgText x={geo.pos.x} y={geo.pos.y + 11} fontSize={9} fill="#52514e" textAnchor="middle" stroke="#fcfcfb" strokeWidth={3} paintOrder="stroke">
                {valor.toFixed(1)}
              </SvgText>
            </G>
          );
        })}

        {/* setas de transição */}
        {[...paresContagem.entries()].map(([chave, contagem]) => {
          const [de, para] = chave.split('>');
          if (!CIRCULOS[de] || !CIRCULOS[para]) return null;
          const origem = CIRCULOS[de];
          const destino = CIRCULOS[para];
          const anomala = (['bem', 'bom'].includes(de) && ['bem', 'bom'].includes(para)) ||
            (['mal', 'mau'].includes(de) && ['mal', 'mau'].includes(para));
          const meio = { x: (origem.x + destino.x) / 2, y: (origem.y + destino.y) / 2 };
          const desvio = anomala ? 0.15 : 0.35; // diagonal passa perto do centro (pelo Eu nuclear)
          const controle = {
            x: C.x + (meio.x - C.x) * desvio,
            y: C.y + (meio.y - C.y) * desvio,
          };
          const espessura = 1.5 + (contagem / maxTransicao) * 4;
          const d = `M${origem.x},${origem.y} Q${controle.x},${controle.y} ${destino.x},${destino.y}`;
          return (
            <G key={chave}>
              <Path d={d} fill="none" stroke="transparent" strokeWidth={18}
                onPress={() => onSelecionar({ tipo: 'transicao', de, para, contagem, anomala })} />
              <Path
                d={d} fill="none"
                stroke={anomala ? '#c0392b' : '#52514e'}
                strokeWidth={espessura}
                strokeDasharray={anomala ? '4,3' : undefined}
                strokeOpacity={0.8}
              />
            </G>
          );
        })}

        {/* nuvem de evidências */}
        {evidenciasComNucleo.map((ev) => {
          const centro = CIRCULOS[ev.nucleo];
          if (!centro) return null;
          const pos = posicaoEvidencia(ev.id, centro, R);
          const raioPonto = 3 + (Number(ev.intensidade) || 0) * 1.3;
          const cor = rubrica.nucleos[ev.nucleo]?.cor || '#888';
          return (
            <Circle
              key={ev.id}
              cx={pos.x} cy={pos.y} r={raioPonto}
              fill={cor} stroke="#fcfcfb" strokeWidth={2}
              fillOpacity={ev.status_validacao === 'confirmada' ? 1 : 0.55}
              onPress={() => onSelecionar({ tipo: 'evidencia', evidencia: ev })}
            />
          );
        })}

        {/* indizíveis, no centro */}
        {evidenciasIndizíveis.map((ev, i) => {
          let seed = hashSeed(String(ev.id)) || 1;
          const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
          const dx = (rnd() - 0.5) * 24;
          const dy = (rnd() - 0.5) * 20;
          return (
            <Circle
              key={ev.id}
              cx={C.x + dx} cy={C.y + dy} r={3.2}
              fill="#898781" stroke="#fcfcfb" strokeWidth={2}
              onPress={() => onSelecionar({ tipo: 'evidencia', evidencia: ev })}
            />
          );
        })}

        {/* centro: Eu Nuclear */}
        <Path
          d={caminhoCentro()}
          fill="#fcfcfb" stroke="#0b0b0b" strokeWidth={1.4}
          onPress={() => onSelecionar({ tipo: 'eu_nuclear', evidencias: evidenciasIndizíveis })}
        />
        <SvgText x={C.x} y={C.y - 6} fontSize={10.5} fontWeight="700" fill="#0b0b0b" textAnchor="middle">EU NUCLEAR</SvgText>
        <SvgText x={C.x} y={C.y + 9} fontSize={9} fill="#52514e" textAnchor="middle" fontStyle="italic">tudo/nada · vazio</SvgText>
        <SvgText x={C.x} y={C.y + 22} fontSize={9} fill="#52514e" textAnchor="middle">{evidenciasIndizíveis.length} indizível(is)</SvgText>
      </Svg>
    </View>
  );
}
