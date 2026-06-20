// src/screens/HomeScreen.js
import { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  StatusBar, Image, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { getSessionsToday } from '../services/database';

const { width: SW } = Dimensions.get('window');

const COLORS = {
  bg:         '#F7F6F3',
  surface:    '#FFFFFF',
  border:     '#E8E4DD',
  textDark:   '#1C1C1E',
  textMid:    '#6B6860',
  textLight:  '#A5A19A',
  accent:     '#2C4A6E',
  accentMid:  '#3D5A80',
  accentSoft: '#5B7FA6',
  accentPale: '#8AAEC8',
  accentGhost:'#B8D4E8',
};

const BUTTONS = [
  { id: 'session',  icon: '🎙️', label: 'Nova Sessão',  desc: 'Gravar e transcrever',           screen: 'NewSession' },
  { id: 'record',   icon: '📋', label: 'Novo Registro', desc: 'Importar, digitar ou fotografar', screen: 'AddRecord'  },
  { id: 'patients', icon: '👤', label: 'Analisantes',   desc: 'Gerenciar e consultar',           screen: 'Patients'   },
  { id: 'search',   icon: '🔍', label: 'Buscador Dr.Sig',  desc: 'Pesquisa clínica inteligente',    screen: 'Search'     },
];

const HEADER_H       = 200;
const FREUD_SIZE     = 119;
const FREUD_OVERFLOW = 26;

function HeaderWaves() {
  const W = SW;
  const H = HEADER_H;
  return (
    <Svg width={W} height={H} style={StyleSheet.absoluteFill} viewBox={`0 0 ${W} ${H}`}>
      <Defs>
        <LinearGradient id="grad1" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0"  stopColor={COLORS.accent}     stopOpacity="1" />
          <Stop offset="1"  stopColor={COLORS.accentMid}  stopOpacity="1" />
        </LinearGradient>
        <LinearGradient id="grad2" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0"  stopColor={COLORS.accentMid}  stopOpacity="1" />
          <Stop offset="1"  stopColor={COLORS.accentSoft} stopOpacity="1" />
        </LinearGradient>
        <LinearGradient id="grad3" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0"  stopColor={COLORS.accentSoft} stopOpacity="1" />
          <Stop offset="1"  stopColor={COLORS.accentPale} stopOpacity="1" />
        </LinearGradient>
        <LinearGradient id="grad4" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0"  stopColor={COLORS.accentPale}  stopOpacity="1" />
          <Stop offset="1"  stopColor={COLORS.accentGhost} stopOpacity="1" />
        </LinearGradient>
      </Defs>
      <Path d={`M0,${H} L${W},${H} L${W},${H*0.62} C${W*0.78},${H*0.55} ${W*0.55},${H*0.70} ${W*0.38},${H*0.60} C${W*0.20},${H*0.50} ${W*0.10},${H*0.66} 0,${H*0.58} Z`} fill="url(#grad1)" />
      <Path d={`M0,${H} L${W},${H} L${W},${H*0.44} C${W*0.82},${H*0.38} ${W*0.60},${H*0.52} ${W*0.42},${H*0.44} C${W*0.25},${H*0.36} ${W*0.12},${H*0.50} 0,${H*0.42} Z`} fill="url(#grad2)" />
      <Path d={`M0,${H} L${W},${H} L${W},${H*0.26} C${W*0.75},${H*0.20} ${W*0.52},${H*0.34} ${W*0.35},${H*0.24} C${W*0.18},${H*0.14} ${W*0.09},${H*0.30} 0,${H*0.24} Z`} fill="url(#grad3)" />
      <Path d={`M0,0 L${W},0 L${W},${H*0.22} C${W*0.80},${H*0.16} ${W*0.58},${H*0.30} ${W*0.38},${H*0.20} C${W*0.20},${H*0.10} ${W*0.10},${H*0.26} 0,${H*0.20} Z`} fill="url(#grad4)" />
    </Svg>
  );
}

function DividerWave() {
  const W = SW; const H = 38;
  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <Path
        d={`M0,0 C${W*0.18},${H*0.9} ${W*0.35},${H*0.1} ${W*0.52},${H*0.6} C${W*0.68},${H*1.1} ${W*0.84},${H*0.2} ${W},${H*0.5} L${W},0 Z`}
        fill={COLORS.accentGhost}
      />
    </Svg>
  );
}

export default function HomeScreen({ navigation }) {
  const [sessoesHoje, setSessoesHoje] = useState(0);

  useFocusEffect(
    useCallback(() => {
      try { setSessoesHoje(getSessionsToday()); }
      catch { setSessoesHoje(0); }
    }, [])
  );

  const sessaoLabel =
    sessoesHoje === 0 ? 'Nenhuma sessão hoje'
    : sessoesHoje === 1 ? '1 sessão hoje'
    : `${sessoesHoje} sessões hoje`;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.accent} />

      <View style={s.headerWrapper}>
        <HeaderWaves />
        <View style={s.headerContent}>
          <View style={s.identity}>

            {/* ── TÍTULO PRINCIPAL ── */}
            <Text style={s.appName}>Dr.Sig</Text>

            {/* ── SUBTÍTULO em duas linhas ── */}
            <Text style={s.appSub}>O seu{'\n'}Assistente Clínico</Text>

            <View style={[s.sessionPill, { marginTop: 14 }]}>
              <View style={[s.sessionDot, sessoesHoje > 0 && s.sessionDotActive]} />
              <Text style={[s.sessionText, sessoesHoje > 0 && s.sessionTextActive]}>
                {sessaoLabel}
              </Text>
            </View>
          </View>

          <View style={s.freudWrap}>
            <Image
              source={require('../assets/freud.png')}
              style={s.freudImage}
              resizeMode="cover"
            />
          </View>
        </View>
        <View style={s.dividerWave}><DividerWave /></View>
      </View>

      <View style={s.grid}>
        {BUTTONS.map((btn) => (
          <TouchableOpacity
            key={btn.id}
            style={s.cell}
            activeOpacity={0.75}
            onPress={() => navigation.navigate(btn.screen)}
          >
            <Text style={s.cellIcon}>{btn.icon}</Text>
            <Text style={s.cellLabel}>{btn.label}</Text>
            <Text style={s.cellDesc}>{btn.desc}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: COLORS.bg },
  headerWrapper: { height: HEADER_H + FREUD_OVERFLOW, marginBottom: 8 },
  headerContent: {
    position: 'absolute', top: 0, left: 0, right: 0, height: HEADER_H,
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: 28, paddingTop: 28,
  },
  dividerWave: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  identity:    { flex: 1, paddingRight: FREUD_SIZE * 0.55, justifyContent: 'flex-start' },

  // ── Dr.Sig — dourado suave, quente, elegante sobre o azul ──
  appName: {
    fontSize: 40,
    fontWeight: '700',
    fontStyle: 'italic',
    color: '#8B5E3C',              // ← dourado acetinado, harmoniza com o azul
    letterSpacing: 1.5,
    lineHeight: 48,
    textShadowColor: 'rgba(0,0,0,0.40)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },

  // ── Subtítulo — champagne discreto, duas linhas ──
  appSub: {
    fontSize: 13,
    fontWeight: '700',
    color: '#A8734A',              // ← champagne claro, levemente mais claro que o título
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    lineHeight: 18,
    marginTop: 6,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  sessionPill: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.40)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, gap: 7,
  },
  sessionDot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.60)' },
  sessionDotActive:  { backgroundColor: '#7EEFC0' },
  sessionText:       { fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: '500' },
  sessionTextActive: { color: '#FFFFFF', fontWeight: '700' },

  freudWrap: {
    position: 'absolute', right: 0, top: 10,
    width: FREUD_SIZE, height: FREUD_SIZE + FREUD_OVERFLOW,
    borderRadius: FREUD_SIZE / 2, overflow: 'hidden',
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.30)',
    backgroundColor: COLORS.accentGhost,
    shadowColor: COLORS.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28, shadowRadius: 14, elevation: 12, zIndex: 10,
  },
  freudImage: { width: FREUD_SIZE, height: FREUD_SIZE + FREUD_OVERFLOW },

  grid: {
    flex: 1, flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 20, paddingTop: FREUD_OVERFLOW + 4, gap: 14,
  },
  cell: {
    width: '47%', backgroundColor: COLORS.accentMid,
    borderRadius: 20, padding: 22, justifyContent: 'flex-end', minHeight: 150,
    shadowColor: COLORS.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 6,
  },
  cellIcon:  { fontSize: 28, marginBottom: 12 },
  cellLabel: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', marginBottom: 4 },
  cellDesc:  { fontSize: 11, color: 'rgba(255,255,255,0.75)', lineHeight: 16 },
});