// ─── Arte das férias do analista na Agenda ──────────────────────────────
//
// Pedido do Paulo: "uma arte adequada, criativa, delicada, leve,
// estética" ocupando a agenda durante as férias. Segue a direção visual do
// app ("papel e água", theme/index.js): papel morno, um sol baixo e lavado,
// o mar em traços finos de sálvia, um ramo de oliveira no canto e duas
// gaivotas ao longe. Nada de cor forte: é para descansar o olho, não para
// chamar atenção.
//
// O desenho é feito num quadro 300×400 e preenche qualquer formato
// (`slice`): numa coluna estreita da semana aparece o centro, com o sol e o
// mar; no dia inteiro aparece tudo.
import React from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Path, G, Ellipse } from 'react-native-svg';

const SERIFA = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });

function Desenho() {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice">
      <Defs>
        <LinearGradient id="ceu" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FBF6EE" />
          <Stop offset="0.55" stopColor="#F6E9DC" />
          <Stop offset="0.62" stopColor="#E9F0EA" />
          <Stop offset="1" stopColor="#DCEAE2" />
        </LinearGradient>
        <RadialGradient id="sol" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor="#F3C9A4" stopOpacity="0.95" />
          <Stop offset="0.7" stopColor="#F3C9A4" stopOpacity="0.55" />
          <Stop offset="1" stopColor="#F3C9A4" stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id="mar" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#E8F0EA" />
          <Stop offset="1" stopColor="#DCEAE2" />
        </LinearGradient>
        <LinearGradient id="reflexo" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F3C9A4" stopOpacity="0.45" />
          <Stop offset="1" stopColor="#F3C9A4" stopOpacity="0" />
        </LinearGradient>
      </Defs>

      <Rect x="0" y="0" width="300" height="400" fill="url(#ceu)" />

      {/* Sol baixo, metade atrás da linha do mar */}
      <Circle cx="150" cy="246" r="74" fill="url(#sol)" />
      <Circle cx="150" cy="246" r="38" fill="#F1BE93" opacity="0.55" />

      {/* Morros ao longe */}
      <Path d="M0 250 C 40 232, 70 236, 104 246 C 126 252, 140 250, 150 250 L 0 250 Z" fill="#A8CBBA" opacity="0.45" />
      <Path d="M180 250 C 210 238, 250 230, 300 240 L 300 250 Z" fill="#A8CBBA" opacity="0.35" />

      {/* Mar: fundo e reflexo do sol */}
      <Rect x="0" y="250" width="300" height="150" fill="url(#mar)" />
      <Ellipse cx="150" cy="262" rx="46" ry="10" fill="url(#reflexo)" />
      <Path d="M126 274 h48 M134 284 h32 M141 294 h18" stroke="#F1BE93" strokeWidth="2" strokeLinecap="round" opacity="0.5" />

      {/* Ondas em traço fino */}
      <G fill="none" stroke="#6B9E8A" strokeLinecap="round">
        <Path d="M-10 272 q 15 -6 30 0 t 30 0 t 30 0" strokeWidth="1.2" opacity="0.35" />
        <Path d="M200 280 q 15 -6 30 0 t 30 0 t 30 0 t 30 0" strokeWidth="1.2" opacity="0.35" />
        <Path d="M-20 306 q 20 -8 40 0 t 40 0 t 40 0 t 40 0 t 40 0 t 40 0 t 40 0 t 40 0" strokeWidth="1.4" opacity="0.3" />
        <Path d="M-30 338 q 25 -9 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0" strokeWidth="1.6" opacity="0.26" />
        <Path d="M-40 374 q 30 -10 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0" strokeWidth="1.8" opacity="0.22" />
      </G>

      {/* Gaivotas ao longe */}
      <G fill="none" stroke="#756E66" strokeLinecap="round" strokeLinejoin="round" opacity="0.55">
        <Path d="M196 168 q 6 -6 12 0 q 6 -6 12 0" strokeWidth="1.3" />
        <Path d="M222 186 q 4 -4 8 0 q 4 -4 8 0" strokeWidth="1.1" />
      </G>

      {/* Ramo de oliveira no canto de cima */}
      <G opacity="0.75">
        <Path d="M300 40 C 262 52, 236 72, 214 104" fill="none" stroke="#6B9E8A" strokeWidth="1.4" strokeLinecap="round" />
        <G fill="#A8CBBA" stroke="#6B9E8A" strokeWidth="0.8">
          <Path d="M282 46 c -6 -10 -18 -12 -26 -8 c 6 8 16 12 26 8 z" />
          <Path d="M276 50 c 2 10 -4 20 -12 24 c -2 -10 4 -20 12 -24 z" />
          <Path d="M258 58 c -6 -10 -18 -12 -26 -8 c 6 8 16 12 26 8 z" />
          <Path d="M250 64 c 2 10 -4 20 -12 24 c -2 -10 4 -20 12 -24 z" />
          <Path d="M236 76 c -6 -9 -16 -11 -23 -7 c 5 7 14 11 23 7 z" />
          <Path d="M228 84 c 2 9 -3 17 -10 21 c -2 -9 3 -17 10 -21 z" />
        </G>
        <Circle cx="244" cy="74" r="3.2" fill="#7E9B6E" opacity="0.7" />
      </G>
    </Svg>
  );
}

/**
 * `titulo` ("Férias"), `periodo` ("04/01 a 31/01") e, se couber, a frase
 * de baixo. `compacta` é a coluna da visão semanal: só a palavra, de pé.
 */
export default function ArteFerias({ periodo, mensagem = 'Bom descanso.', compacta = false, onPress, style }) {
  const Conteudo = (
    <View style={[styles.quadro, style]}>
      <View style={StyleSheet.absoluteFill}>
        <Desenho />
      </View>
      {compacta ? (
        <View style={styles.textoCompacto} pointerEvents="none">
          <Text style={styles.tituloCompacto} numberOfLines={1} adjustsFontSizeToFit>Férias</Text>
        </View>
      ) : (
        <View style={styles.texto} pointerEvents="none">
          <Text style={styles.titulo}>Férias</Text>
          {periodo ? <Text style={styles.periodo}>{periodo}</Text> : null}
          {mensagem ? <Text style={styles.mensagem}>{mensagem}</Text> : null}
        </View>
      )}
    </View>
  );
  if (!onPress) return Conteudo;
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.toque}>
      {Conteudo}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  toque: { flex: 1 },
  quadro: { flex: 1, overflow: 'hidden', borderRadius: 16, backgroundColor: '#FBF6EE' },
  texto: { position: 'absolute', top: '9%', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 20 },
  titulo: {
    fontFamily: SERIFA, fontSize: 40, fontStyle: 'italic', color: '#3A5C4F',
    letterSpacing: 1, lineHeight: 50,
  },
  periodo: { fontSize: 14, color: '#4E4941', letterSpacing: 1.5, marginTop: 4, lineHeight: 20 },
  mensagem: { fontFamily: SERIFA, fontStyle: 'italic', fontSize: 15, color: '#756E66', marginTop: 10, lineHeight: 21 },
  textoCompacto: { position: 'absolute', top: 10, left: 2, right: 2, alignItems: 'center' },
  tituloCompacto: { fontFamily: SERIFA, fontStyle: 'italic', fontSize: 15, color: '#3A5C4F', lineHeight: 20 },
});
