import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  StatusBar, Dimensions, ScrollView, Animated, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { getResumoAgendaHoje } from '../services/database';
import { processarEnviosFiscaisAutomaticos } from '../services/fiscalAutomatico';
import { obterRecebimentosAtrasados, verificarEEnviarAlertaAtraso } from '../services/alertaAtraso';
import { useSwipeHorizontal } from '../hooks/useSwipeHorizontal';
import { registrarPushToken } from '../services/pushToken';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import MenuLateral from '../components/MenuLateral';
import { assinaturaEstaAtiva, MENSAGEM_ASSINATURA_INATIVA } from '../services/assinatura';
import MiniAfazeresBox from '../components/MiniAfazeresBox';
import MiniAgendaBox from '../components/MiniAgendaBox';
import { CLINICA_BUTTONS, ADMIN_BUTTONS } from '../constants/menuBotoes';

const { width: SW, height: SH } = Dimensions.get('window');

import FreudImage from '../../assets/freud.png';

const COLORS = {
  bg:          '#F7F6F3',
  surface:     '#FFFFFF',
  border:      '#E8E4DD',
  textDark:    '#1C1C1E',
  textMid:     '#6B6860',
  textLight:   '#A5A19A',

  accent:      '#6B9E8A',
  accentMid:   '#8FBFA8',
  accentSoft:  '#B5D4C4',
  accentPale:  '#C8DDD1',
  accentGhost: '#D4E8DC',

  btnBlue:     '#3D5A80',
  btnLight:    '#5B7FA6',
  btnShadow:   '#1A2D45',
};

// Paleta própria por botão (item E.11/B.6) — cada tela tem sua cor e seu
// ícone, tirados de uma paleta quente/fria equilibrada em vez de todo mundo
// caindo no mesmo cinza genérico "outros". O badge do Recebíveis usa ícone
// escuro em vez de branco porque #D9A441 é claro demais pro branco cumprir
// o contraste mínimo AA (WCAG 1.4.11, 3:1).
// CLINICA_BUTTONS/ADMIN_BUTTONS agora moraram pra src/constants/menuBotoes.js
// (reutilizados pelo MenuLateral.js em outras telas, não só aqui).

// Ordem das 3 abas no deslize — Início é a primeira/padrão. Usado tanto
// pelo deslize quanto pelo toggle de cima.
const ORDEM_MODOS = ['inicio', 'clinica', 'administrativa'];
const MODO_LABEL = { inicio: 'Início', clinica: 'Clínica', administrativa: 'Administrativo' };

// ⚠️ Reduzidos para caber tudo na tela sem precisar rolar na maioria dos aparelhos
const HEADER_H       = 172;
const FREUD_SIZE     = 108;
const FREUD_OVERFLOW = 22;

// Quanto o toggle "sobe" para sobrepor a faixa mais clara do fundo do header
const TOGGLE_OVERLAP = 34;

// Grade principal — a largura da caixa é calculada a partir da tela para
// caber exatamente 2 por linha sem sobra de pixel (antes usava '47%', que
// deixava um resto assimétrico de alguns pixels de um dos lados).
//
// A altura também é calculada (não é mais aspectRatio fixo) — com só 4
// botões em 2 linhas, uma altura fixa deixava uma faixa vazia embaixo da
// tela em aparelhos mais altos. TOGGLE_H é uma medida aproximada da barra
// Início/Clínica/Administrativo (padding + texto), não um valor exato do
// layout — se o toggle mudar de tamanho, reconferir aqui.
const GRID_PADDING = 20;
const GRID_COL_GAP = 14;
const GRID_ROW_GAP = 16;
const CELL_W = (SW - GRID_PADDING * 2 - GRID_COL_GAP) / 2;
const TOGGLE_H = 52;
const GRID_ROWS = 2;
const ESPACO_ACIMA_DA_GRADE =
  (HEADER_H + FREUD_OVERFLOW - TOGGLE_OVERLAP) + TOGGLE_H + 14 /* scrollContent.paddingTop */;
const ESPACO_ABAIXO_DA_GRADE = 20; // scrollContent.paddingBottom
const CELL_H = Math.max(
  140,
  (SH - ESPACO_ACIMA_DA_GRADE - ESPACO_ABAIXO_DA_GRADE - GRID_ROW_GAP * (GRID_ROWS - 1)) / GRID_ROWS
);

// Mesma lógica pra aba Início: Afazeres/Agenda de hoje crescem pra ocupar
// o espaço vertical que sobrava, com o botão Arquivo e Relatórios (agora
// fundo azul, igual aos outros botões — só Afazeres/Agenda mantêm a
// moldura com borda) fixo na parte mais baixa da tela.
const USER_BANNER_H = 66; // aproximado: avatar 32 + paddingVertical 8*2 + marginBottom 16
const WIDGETS_ROW_MARGIN_BOTTOM = 16;
const ARQUIVO_BTN_H = 64;
const WIDGET_H = Math.max(
  150,
  SH - ESPACO_ACIMA_DA_GRADE - ESPACO_ABAIXO_DA_GRADE - USER_BANNER_H - WIDGETS_ROW_MARGIN_BOTTOM - ARQUIVO_BTN_H
);

// Distância mínima de arraste horizontal para trocar de modo
const SWIPE_THRESHOLD = 45;

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
          <Stop offset="1"  stopColor={COLORS.accentPale}  stopOpacity="1" />
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
  const W = SW;
  const H = 34;
  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <Path
        d={`M0,0 C${W*0.18},${H*0.9} ${W*0.35},${H*0.1} ${W*0.52},${H*0.6} C${W*0.68},${H*1.1} ${W*0.84},${H*0.2} ${W},${H*0.5} L${W},0 Z`}
        fill={COLORS.accentGhost}
      />
    </Svg>
  );
}

function FreudAvatar() {
  return (
    <Image
      source={FreudImage}
      style={s.freudImage}
      resizeMode="cover"
    />
  );
}

export default function InicioScreen({ navigation }) {
  const { session } = useAuth();
  const [resumoAgenda, setResumoAgenda] = useState({ total: 0, concluidas: 0 });
  const [user, setUser] = useState(null);
  const [modo, setModo] = useState('inicio'); // 'inicio' | 'clinica' | 'administrativa'
  const [menuAberto, setMenuAberto] = useState(false);

  // Registra o token de push uma vez por sessão de app (não a cada vez que
  // a tela ganha foco de novo — ver useFocusEffect abaixo, que roda toda
  // hora que se volta pra Início).
  useEffect(() => {
    registrarPushToken();
  }, [session.user.id]);

  // ─── Deslize de verdade entre Início ⇄ Clínica ⇄ Administrativa ───────
  // Acompanha o dedo ao vivo durante o arraste (não só anima na soltura) —
  // ver src/hooks/useSwipeHorizontal.js. Toque nos botões de cima usa a
  // mesma transição de entrada, só sem o arraste. Início é a 1ª aba (mais à
  // esquerda) — só nela aparecem o banner do usuário e os widgets.
  const idxModo = ORDEM_MODOS.indexOf(modo);
  const { panHandlers, animatedStyle: gridAnimatedStyle, entrarDe } = useSwipeHorizontal({
    onSwipeLeft: () => trocarModo(ORDEM_MODOS[Math.min(idxModo + 1, ORDEM_MODOS.length - 1)]),
    onSwipeRight: () => trocarModo(ORDEM_MODOS[Math.max(idxModo - 1, 0)]),
    limiar: SWIPE_THRESHOLD,
    // Sem isso, deslizar de novo no limite reabria a mesma tela como se
    // houvesse mais uma (item E.14).
    podeEsquerda: idxModo < ORDEM_MODOS.length - 1,
    podeDireita: idxModo > 0,
  });

  function trocarModo(novoModo) {
    if (modo === novoModo) return;
    const indoParaFrente = ORDEM_MODOS.indexOf(novoModo) > idxModo;
    setModo(novoModo);
    entrarDe(indoParaFrente ? 46 : -46);
  }

  // Botões que levam pra uma tela de criação (bloqueiaSemAssinatura) checam
  // a assinatura ANTES de navegar — sem isso, a tela abriria e fecharia
  // sozinha (o mount-guard de lá é só uma rede de segurança pra quem chega
  // por outro caminho, ex: deep link). Sem banner fixo ocupando espaço —
  // o aviso só aparece como popup na hora que faz sentido.
  async function abrirBotaoGrid(btn) {
    if (btn.bloqueiaSemAssinatura && !(await assinaturaEstaAtiva())) {
      Alert.alert('Assinatura inativa', MENSAGEM_ASSINATURA_INATIVA);
      return;
    }
    navigation.navigate(btn.screen);
  }

  // Mostra no máximo 1x por sessão do app (não a cada vez que a tela ganha
  // foco de novo, senão vira um popup irritante toda hora que se volta
  // pra Início vindo de outra tela).
  const avisoAtrasoMostradoRef = useRef(false);

  async function avisarRecebimentosAtrasados() {
    if (avisoAtrasoMostradoRef.current) return;
    try {
      const atrasados = await obterRecebimentosAtrasados();
      if (atrasados.length === 0) return;
      avisoAtrasoMostradoRef.current = true;
      Alert.alert(
        atrasados.length === 1 ? 'Recebimento em atraso' : `${atrasados.length} recebimentos em atraso`,
        atrasados.map((a) => `${a.nome} — ${a.diasAtraso} dia${a.diasAtraso === 1 ? '' : 's'} de atraso`).join('\n'),
        [
          { text: 'Depois' },
          { text: 'Ver Recebíveis', onPress: () => navigation.navigate('Cobranca') },
        ]
      );
    } catch (e) {
      console.error('Falha ao verificar recebimentos atrasados:', e?.message || e);
    }
  }

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          setResumoAgenda(await getResumoAgendaHoje());
        } catch {
          setResumoAgenda({ total: 0, concluidas: 0 });
        }
      })();
      processarEnviosFiscaisAutomaticos().catch((e) => console.error('Falha no catch-up fiscal automático:', e?.message || e));
      verificarEEnviarAlertaAtraso().catch((e) => console.error('Falha no alerta de atraso:', e?.message || e));
      avisarRecebimentosAtrasados();
      let cancelado = false;
      supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()
        .then(({ data, error }) => {
          if (cancelado) return;
          if (error) console.error('Erro ao carregar profile (Home):', error.message, error);
          setUser(data || null);
        });
      return () => { cancelado = true; };
    }, [session.user.id])
  );

  const sessaoLabel =
    resumoAgenda.total === 0
      ? 'Nenhuma sessão hoje'
      : `${resumoAgenda.concluidas}/${resumoAgenda.total} sessões hoje`;

  const botoesAtivos = modo === 'clinica' ? CLINICA_BUTTONS : ADMIN_BUTTONS;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.accent} />

      <View style={s.headerWrapper}>
        <HeaderWaves />

        <View style={s.headerContent}>
          <View style={s.identity}>
            <Text style={s.appName}>Dr.Sig</Text>

            <Text style={s.appSub}>
              O seu{'\n'}Assistente Clínico
            </Text>

            <View style={[s.sessionPill, { marginTop: 10 }]}>
              <View
                style={[
                  s.sessionDot,
                  resumoAgenda.total > 0 && s.sessionDotActive,
                ]}
              />
              <Text style={s.sessionText}>
                {sessaoLabel}
              </Text>
            </View>
          </View>

          <View style={s.freudWrap}>
            <FreudAvatar />
          </View>
        </View>

        <View style={s.dividerWave}>
          <DividerWave />
        </View>

        {/* Renderizado por último (não dentro de headerContent) pra garantir
            que fique por cima do "Dr.Sig" no Android — dois irmãos absolutos
            sem elevation/zIndex explícito empilham por ordem de pintura, e
            headerContent vinha depois, cobrindo o botão. */}
        <TouchableOpacity
          style={s.menuBtn}
          activeOpacity={0.7}
          onPress={() => setMenuAberto(true)}
        >
          <Ionicons name="menu-outline" size={24} color={COLORS.btnBlue} />
        </TouchableOpacity>
      </View>

      {/* 🔀 Toggle Início / Clínica / Administrativa — sobrepõe a faixa mais
          clara do fundo do header */}
      <View style={s.toggleWrap}>
        {ORDEM_MODOS.map((m) => (
          <TouchableOpacity
            key={m}
            style={[s.toggleBtn, modo === m && s.toggleBtnActive]}
            activeOpacity={0.8}
            onPress={() => trocarModo(m)}
          >
            <Text style={[s.toggleText, modo === m && s.toggleTextActive]}>
              {MODO_LABEL[m]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Área com gesto de arraste — troca de modo ao arrastar para os lados */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        {...panHandlers}
      >
        {modo === 'inicio' ? (
          <Animated.View style={gridAnimatedStyle}>
            {/* Banner do usuário — só aparece na aba Início */}
            {user ? (
              <TouchableOpacity
                style={s.userBanner}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('UserProfile')}
              >
                <View style={s.userBannerLeft}>
                  <View style={s.userBannerAvatar}>
                    {user.avatar_url ? (
                      <Image source={{ uri: user.avatar_url }} style={s.userBannerAvatarImg} />
                    ) : (
                      <Text style={s.userBannerAvatarText}>
                        {user.nome
                          .split(' ')
                          .map(p => p[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase()}
                      </Text>
                    )}
                  </View>
                  <View style={s.userBannerInfo}>
                    <Text style={s.userBannerLabel}>Usuário</Text>
                    <Text style={s.userBannerName}>{user.nome}</Text>
                  </View>
                </View>
                <Text style={s.userBannerArrow}>›</Text>
              </TouchableOpacity>
            ) : null}

            <View style={s.widgetsRow}>
              <MiniAfazeresBox navigation={navigation} altura={WIDGET_H} />
              <MiniAgendaBox navigation={navigation} altura={WIDGET_H} />
            </View>

            <TouchableOpacity
              style={[s.arquivoBtnAzul, { height: ARQUIVO_BTN_H }]}
              activeOpacity={0.75}
              onPress={() => navigation.navigate('ArquivoRelatorios')}
            >
              <Ionicons name="folder-outline" size={24} color="#FFFFFF" />
              <Text style={s.arquivoBtnAzulText}>Arquivo e Relatórios</Text>
              <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <Animated.View style={[s.grid, gridAnimatedStyle]}>
            {botoesAtivos.map((btn) => (
              <TouchableOpacity
                key={btn.id}
                style={s.cell}
                activeOpacity={0.75}
                onPress={() => abrirBotaoGrid(btn)}
              >
                <View style={[s.cellIconBadge, { backgroundColor: btn.corBadge }]}>
                  <Ionicons name={btn.icon} size={32} color={btn.corIcone || '#FFFFFF'} />
                </View>
                <Text style={s.cellLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{btn.label}</Text>
              </TouchableOpacity>
            ))}
          </Animated.View>
        )}
      </ScrollView>

      <MenuLateral
        visible={menuAberto}
        onClose={() => setMenuAberto(false)}
        navigation={navigation}
        clinicaButtons={CLINICA_BUTTONS}
        adminButtons={ADMIN_BUTTONS}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  headerWrapper: {
    height: HEADER_H + FREUD_OVERFLOW,
  },
  menuBtn: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 20,
    elevation: 20,
    padding: 10,
  },
  headerContent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: HEADER_H,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 24,
  },
  dividerWave: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },

  identity: {
    flex: 1,
    paddingRight: FREUD_SIZE * 0.55,
    justifyContent: 'flex-start',
  },
  appName: {
    fontSize: 34,
    fontWeight: '700',
    fontStyle: 'italic',
    color: COLORS.btnBlue,
    letterSpacing: 1.2,
    lineHeight: 40,
  },
  appSub: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.btnLight,
    letterSpacing: 2,
    textTransform: 'uppercase',
    lineHeight: 16,
    marginTop: 4,
  },

  sessionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: COLORS.btnBlue,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 7,
  },
  sessionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.50)',
  },
  sessionDotActive: {
    backgroundColor: COLORS.accentSoft,
  },
  sessionText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '500',
  },

  freudWrap: {
    position: 'absolute',
    right: 0,
    top: 6,
    width: FREUD_SIZE,
    height: FREUD_SIZE + FREUD_OVERFLOW,
    borderRadius: FREUD_SIZE / 2,
    overflow: 'hidden',
    zIndex: 10,
  },
  freudImage: {
    width: '100%',
    height: '100%',
  },

  // ⚠️ NOVO: fora do ScrollView, com margem negativa para sobrepor a faixa
  // mais clara do fundo do header. elevation garante que fique por cima
  // no Android; sombra própria para "descolar" visualmente do header.
  toggleWrap: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: -TOGGLE_OVERLAP,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
    zIndex: 5,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  toggleBtnActive: {
    backgroundColor: COLORS.btnBlue,
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMid,
  },
  toggleTextActive: {
    color: '#FFFFFF',
  },

  scrollContent: {
    paddingTop: 14,
    paddingBottom: 20,
  },

  userBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  userBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  userBannerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.btnBlue,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.btnBlue,
    overflow: 'hidden',
  },
  userBannerAvatarImg: {
    width: '100%',
    height: '100%',
  },
  userBannerAvatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  userBannerInfo: {
    gap: 0,
  },
  userBannerLabel: {
    fontSize: 10,
    color: COLORS.textLight,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  userBannerName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  userBannerArrow: {
    fontSize: 22,
    color: COLORS.textLight,
    fontWeight: '300',
  },

  widgetsRow: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 20,
    marginBottom: 16,
  },

  // Fundo azul sólido, igual ao tom dos botões das outras abas — só
  // Afazeres/Agenda (acima) mantêm a moldura com borda.
  arquivoBtnAzul: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    backgroundColor: COLORS.btnBlue,
    borderRadius: 15,
    paddingHorizontal: 18,
  },
  arquivoBtnAzulText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    paddingHorizontal: GRID_PADDING,
    columnGap: GRID_COL_GAP,
    rowGap: GRID_ROW_GAP,
  },
  cell: {
    width: CELL_W,
    height: CELL_H,
    backgroundColor: COLORS.btnBlue,
    borderRadius: 22,
    paddingVertical: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.35)',
    shadowColor: COLORS.btnShadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
  // Selo de tamanho fixo para o ícone — usar @expo/vector-icons (em vez de
  // emoji) garante que cada glifo tenha exatamente o mesmo bounding box,
  // eliminando a inconsistência de alinhamento entre ícones diferentes.
  cellIconBadge: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  cellLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 21,
    textAlign: 'center',
  },
});
