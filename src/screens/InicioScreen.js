import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  StatusBar, Dimensions, ScrollView, Animated, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { getResumoAgendaHoje, listarCompromissosAguardandoCheckin } from '../services/database';
import { processarEnviosFiscaisAutomaticos } from '../services/fiscalAutomatico';
import { obterRecebimentosAtrasados, verificarEEnviarAlertaAtraso } from '../services/alertaAtraso';
import { horarioJaPassou } from '../services/compromissoStatus';
import { perguntarCheckin } from '../services/checkinCompromisso';
import { useSwipeHorizontal } from '../hooks/useSwipeHorizontal';
import { registrarPushToken } from '../services/pushToken';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import MenuLateral from '../components/MenuLateral';
import { assinaturaEstaAtiva, MENSAGEM_ASSINATURA_INATIVA } from '../services/assinatura';
import MiniAfazeresBox from '../components/MiniAfazeresBox';
import MiniAgendaBox from '../components/MiniAgendaBox';
import Lavado from '../components/Lavado';
import { papel, tinta, salvia } from '../theme';
import { CLINICA_BUTTONS, ADMIN_BUTTONS } from '../constants/menuBotoes';

const { width: SW, height: SH } = Dimensions.get('window');

import FreudImage from '../../assets/freud.png';

const COLORS = {
  bg:          papel.base,
  surface:     papel.alto,
  border:      papel.linha,
  textDark:    tinta.t900,
  textMid:     tinta.t500,
  textLight:   tinta.t400,

  // As quatro faixas da onda do cabeçalho, do mais fundo ao mais claro.
  accent:      salvia.tinta,
  accentMid:   salvia.base,
  accentSoft:  salvia.suave,
  accentPale:  '#CADFD4',
  accentGhost: salvia.veu,

  marca:       salvia.funda,
  acao:        salvia.tinta,
  acaoClara:   '#4E7767',
  sombra:      '#4E4941',
};

// Paleta própria por botão (item E.11/B.6) — cada tela tem sua cor e seu
// ícone, tirados de uma paleta quente/fria equilibrada em vez de todo mundo
// caindo no mesmo cinza genérico "outros". O badge do Recebíveis usa ícone
// escuro em vez de branco porque #776746 é claro demais pro branco cumprir
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

// Item 2 (leva pós-v13): a conta de altura usava só Dimensions.get('window'),
// que é a tela INTEIRA — sem descontar a área segura (notch, barra de
// gestos), a grade calculada ficava maior do que o espaço realmente
// disponível dentro da SafeAreaView, e o ScrollView tinha que entrar pra
// cobrir a diferença. Isso é exatamente o que fazia "precisar rolar pra
// ver todos os botões" e atrapalhava o gesto de arrastar pros lados. Os
// insets reais só existem em tempo de render (useSafeAreaInsets), por isso
// esta conta agora é uma função pura chamada de dentro do componente, não
// mais uma constante de módulo.
const USER_BANNER_H = 66; // aproximado: avatar 32 + paddingVertical 8*2 + marginBottom 16
const WIDGETS_ROW_MARGIN_BOTTOM = 16;
const BUSCA_BTN_H = 64;

function calcularAlturasDaGrade(alturaUtil) {
  // Teto de altura — sem isso, em telas bem altas a conta acima dava
  // células enormes e quase vazias (só um ícone pequeno "flutuando" no
  // meio de um botão gigante). 190 dá espaço confortável pro ícone +
  // rótulo em até 2 linhas sem esticar além disso.
  const cellH = Math.min(
    190,
    Math.max(
      140,
      (alturaUtil - ESPACO_ACIMA_DA_GRADE - ESPACO_ABAIXO_DA_GRADE - GRID_ROW_GAP * (GRID_ROWS - 1)) / GRID_ROWS
    )
  );
  // Mesma lógica pra aba Início: Afazeres/Agenda de hoje crescem pra ocupar
  // o espaço vertical que sobrava, com o botão Busca Dr.Sig fixo na
  // parte mais baixa da tela.
  const widgetH = Math.max(
    150,
    alturaUtil - ESPACO_ACIMA_DA_GRADE - ESPACO_ABAIXO_DA_GRADE - USER_BANNER_H - WIDGETS_ROW_MARGIN_BOTTOM - BUSCA_BTN_H
  );
  return { cellH, widgetH };
}

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

  // Item 2 (leva pós-v13): altura de fato disponível dentro da área segura
  // — SH sozinho (Dimensions) inclui notch/barra de gestos, que a
  // SafeAreaView já desconta visualmente mas a conta de layout ignorava.
  const insets = useSafeAreaInsets();
  const { cellH, widgetH } = useMemo(
    () => calcularAlturasDaGrade(SH - insets.top - insets.bottom),
    [insets.top, insets.bottom]
  );

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

  // Item 7 (v13): nada no app muda um compromisso de 'agendado' pra outro
  // status sozinho quando o horário passa — sem isso, "Sessões sem relato"
  // fica praticamente vazia pra sempre, não por estar quebrada, mas porque
  // ninguém nunca confirma que a sessão aconteceu. Este popup pergunta um
  // por um, no início do app.
  // ⚠️ CORRIGIDO: antes só perguntava 1x por sessão do app (flag permanente
  // — "Fechar" suspendia o resto até reabrir o app do zero), o que
  // contradiz "o app precisa SEMPRE confirmar". Agora o gate só evita
  // disparar duas varreduras ao mesmo tempo (ex: foco duplo rápido) — toda
  // vez que a Início ganha foco de novo, os compromissos ainda não
  // respondidos (continuam 'agendado' — responder muda o status) voltam a
  // ser perguntados.
  const processandoCheckinRef = useRef(false);

  function processarFilaCheckin(fila, indice) {
    if (indice >= fila.length) {
      processandoCheckinRef.current = false;
      return;
    }
    const compromisso = fila[indice];
    const tipo = compromisso.tipo || 'sessao_individual';
    const eventoIndividual = tipo === 'sessao_individual' || tipo === 'supervisao_individual';
    let navegouPraRelato = false;

    perguntarCheckin(compromisso, {
      // Só oferece "adicionar relato" pra sessão/supervisão individual —
      // grupo, evento livre etc. não têm um prontuário único pra gravar.
      // Duas formas de relato contam igualmente (ver estaSemRelato em
      // database.js): gravar áudio (transcrito depois) ou escrever
      // diretamente em Novo Registro, com a data da sessão já preenchida.
      aoRealizada: eventoIndividual
        ? () => new Promise((resolve) => {
            Alert.alert(
              'Adicionar relato?',
              `Quer adicionar o relato de ${compromisso.patient_nome} agora?`,
              [
                { text: 'Depois', onPress: () => resolve() },
                {
                  text: 'Escrever registro',
                  onPress: () => {
                    navegouPraRelato = true;
                    navigation.navigate('AddRecord', {
                      patientId: compromisso.patient_id,
                      appointmentId: compromisso.id,
                      dataSessao: compromisso.date,
                    });
                    resolve();
                  },
                },
                {
                  text: 'Gravar áudio',
                  onPress: () => {
                    navegouPraRelato = true;
                    navigation.navigate('NewSession', {
                      patientId: compromisso.patient_id,
                      patientNome: compromisso.patient_nome,
                      platform: compromisso.modality,
                      appointmentId: compromisso.id,
                    });
                    resolve();
                  },
                },
              ]
            );
          })
        : undefined,
      // Ao navegar pra gravar/escrever, não insiste no resto da fila em
      // cima da tela nova — o resto continua 'agendado' e volta a ser
      // perguntado na próxima vez que a Início ganhar foco.
      aoConcluir: (info) => {
        if (navegouPraRelato || info?.fechado) {
          processandoCheckinRef.current = false;
          return;
        }
        processarFilaCheckin(fila, indice + 1);
      },
    });
  }

  async function perguntarCheckinsPendentes() {
    if (processandoCheckinRef.current) return;
    try {
      const candidatos = await listarCompromissosAguardandoCheckin();
      const pendentes = candidatos.filter((c) => horarioJaPassou(c.date, c.end_time));
      if (pendentes.length === 0) return;
      processandoCheckinRef.current = true;
      processarFilaCheckin(pendentes, 0);
    } catch (e) {
      console.error('Falha ao verificar compromissos pendentes de check-in:', e?.message || e);
    }
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
      perguntarCheckinsPendentes();
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
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

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
          <Ionicons name="menu-outline" size={24} color={COLORS.acao} />
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

      {/* Área com gesto de arraste — troca de modo ao arrastar para os lados.
          O panHandlers vai num View por FORA do ScrollView (não espalhado
          nele) — grudar um PanResponder externo direto num ScrollView disputa
          com o responder nativo de rolagem dele e o gesto fica "preso"
          (arrasta visualmente mas nunca solta pra trocar de aba), mesmo
          problema que o padrão usado em Agenda/Financeiro evita.
          Item 2 (leva pós-v13): scrollEnabled=false — a tela agora é
          calculada pra sempre caber (ver calcularAlturasDaGrade, com
          insets reais), então rolar verticalmente só existia como rede de
          segurança pra quando a conta errava a altura disponível — e
          competia com o gesto horizontal de trocar de aba. Continua um
          ScrollView (não vira View simples) só pelo contentContainerStyle
          já pronto; na prática não rola. */}
      <View style={{ flex: 1 }} {...panHandlers}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={false}
        bounces={false}
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
              <MiniAfazeresBox navigation={navigation} altura={widgetH} />
              <MiniAgendaBox navigation={navigation} altura={widgetH} />
            </View>

            <TouchableOpacity
              style={[s.buscaExterna, { height: BUSCA_BTN_H }]}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('Busca')}
            >
              <View style={s.buscaCentral}>
                <View style={s.buscaInterna}>
                  <Ionicons name="sparkles-outline" size={22} color="#675A9A" />
                  <Text style={s.buscaBtnText}>Busca Dr.Sig</Text>
                  <Ionicons name="chevron-forward" size={18} color={tinta.t400} />
                </View>
              </View>
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <Animated.View style={[s.grid, gridAnimatedStyle]}>
            {botoesAtivos.map((btn) => (
              // Moldura tripla: fina · grossa (3 dp ≈ 0,5 mm) · fina.
              // O fundo é o mesmo verde em todas as células; a cor da seção
              // vive só no medalhão.
              <TouchableOpacity
                key={btn.id}
                style={[s.cellExterna, { width: CELL_W, height: cellH }]}
                activeOpacity={0.8}
                onPress={() => abrirBotaoGrid(btn)}
              >
                <View style={s.cellCentral}>
                  <View style={s.cellInterna}>
                    <Lavado de={salvia.veuForte} para={papel.alto} parada={0.74} style={s.cellCampo}>
                      <View style={[s.cellMedalhao, { borderColor: btn.corBadge + '73' }]}>
                        <Ionicons name={btn.icon} size={24} color={btn.corBadge} />
                      </View>
                      <Text style={s.cellLabel} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85}>{btn.label}</Text>
                    </Lavado>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </Animated.View>
        )}
      </ScrollView>
      </View>

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
    elevation: 8,
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
    fontWeight: '600',
    fontStyle: 'italic',
    color: COLORS.marca,
    letterSpacing: -0.5,
    lineHeight: 40,
  },
  appSub: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.acaoClara,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    lineHeight: 16,
    marginTop: 4,
  },

  sessionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: papel.alto,
    borderWidth: 1,
    borderColor: '#D3E5DB',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 7,
  },
  sessionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: tinta.t300,
  },
  sessionDotActive: {
    backgroundColor: salvia.tinta,
  },
  sessionText: {
    fontSize: 11,
    color: tinta.t700,
    fontWeight: '400',
    lineHeight: 15,
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
    shadowColor: '#4E4941',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  toggleBtnActive: {
    backgroundColor: COLORS.acao,
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '500',
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
    shadowColor: '#4E4941',
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
    backgroundColor: COLORS.acao,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.acao,
    overflow: 'hidden',
  },
  userBannerAvatarImg: {
    width: '100%',
    height: '100%',
  },
  userBannerAvatarText: {
    fontSize: 12,
    fontWeight: '500',
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
    fontWeight: '500',
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

  // Mesma moldura tripla dos botões da grade e dos dois widgets — é o
  // gesto que amarra a tela inteira.
  buscaExterna: {
    marginHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: salvia.suave,
    padding: 2,
    shadowColor: COLORS.sombra,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 3,
  },
  buscaCentral: { flex: 1, borderRadius: 16, borderWidth: 3, borderColor: salvia.tinta, padding: 2 },
  buscaInterna: {
    flex: 1,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: salvia.suave,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
  },
  buscaBtnText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: tinta.t900,
    lineHeight: 20,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    paddingHorizontal: GRID_PADDING,
    columnGap: GRID_COL_GAP,
    rowGap: GRID_ROW_GAP,
  },
  cellExterna: {
    // width/height vêm inline (calcularAlturasDaGrade, com insets reais).
    backgroundColor: COLORS.surface,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: salvia.suave,
    padding: 2,
    shadowColor: COLORS.sombra,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 3,
  },
  cellCentral: { flex: 1, borderRadius: 18, borderWidth: 3, borderColor: salvia.tinta, padding: 2 },
  cellInterna: { flex: 1, borderRadius: 13, borderWidth: 1, borderColor: salvia.suave, overflow: 'hidden' },
  cellCampo: {
    flex: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  // Medalhão: círculo em papel com aro na cor da seção. O ícone vetorial
  // garante o mesmo bounding box para todos os glifos.
  cellMedalhao: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    backgroundColor: papel.alto,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: tinta.t900,
    lineHeight: 19,
    letterSpacing: -0.1,
    textAlign: 'center',
  },
});
