import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { papel, salvia } from '../theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';
import { navigationRef } from './navigationRef';

// Autenticação
import LoginScreen from '../screens/LoginScreen';
import CadastroScreen from '../screens/CadastroScreen';
import AvisoPrivacidadeScreen from '../screens/AvisoPrivacidadeScreen';

const CHAVE_POLITICA_ACEITA = '@drsig_politica_privacidade_aceita_v1';

// Principal
import InicioScreen from '../screens/InicioScreen';

// Analisantes
import AnalisantesScreen from '../screens/AnalisantesScreen';
import BuscaScreen from '../screens/BuscaScreen';
import FormularioAnalisanteScreen from '../screens/FormularioAnalisanteScreen';
import DetalheAnalisanteScreen from '../screens/DetalheAnalisanteScreen';

// Sessões
import DetalheSessaoScreen from '../screens/DetalheSessaoScreen';
import NovaSessaoScreen from '../screens/NovaSessaoScreen';

// Registros
import NovoRegistroScreen from '../screens/NovoRegistroScreen';
import DetalheRegistroScreen from '../screens/DetalheRegistroScreen';

// Imagens

// Perfil
import PerfilScreen from '../screens/PerfilScreen';
import AssinaturaScreen from '../screens/AssinaturaScreen';
import MensagensPersonalizadasScreen from '../screens/MensagensPersonalizadasScreen';
import CursosScreen from '../screens/CursosScreen';
import FormularioCursoScreen from '../screens/FormularioCursoScreen';

// Administrativo
import AgendaScreen from '../screens/AgendaScreen';
import FinanceiroScreen from '../screens/FinanceiroScreen';
import CobrancaScreen from '../screens/CobrancaScreen';
import FiscalScreen from '../screens/FiscalScreen';
import PagamentosScreen from '../screens/PagamentosScreen';
import ConfiguracaoFiscalAutomaticaScreen from '../screens/ConfiguracaoFiscalAutomaticaScreen';
import EditarHorarioScreen from '../screens/DisponibilidadeScreen';
import EditarHorarioUnicoScreen from '../screens/EditarHorarioUnicoScreen';
import DetalheCompromissoScreen from '../screens/DetalheCompromissoScreen';

// Início — afazeres e relatórios
import AfazeresScreen from '../screens/AfazeresScreen';
import RelatoriosScreen from '../screens/RelatoriosScreen';
import DetalheRelatorioScreen from '../screens/DetalheRelatorioScreen';
import SessoesStatusScreen from '../screens/SessoesStatusScreen';

const Stack = createNativeStackNavigator();

// Header nativo desligado pra tudo — sob o edge-to-edge do Android no
// Expo SDK 54, o header do @react-navigation/native-stack não reserva o
// espaço real que ocupa (desenha por cima do conteúdo em vez de empurrar
// pra baixo), cortando o topo de várias telas. Cada tela agora desenha o
// próprio cabeçalho com <CabecalhoTela/> (src/components/CabecalhoTela.js),
// que calcula sua altura sozinho — determinístico, sem depender de como o
// Android decide posicionar o header nativo.
const screenOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: papel.base },
  animation: 'slide_from_right',
};

function AuthStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Cadastro" component={CadastroScreen} />
    </Stack.Navigator>
  );
}

function AppStackNavigator() {
  // Toque numa notificação push de transcrição pronta abre a sessão certa —
  // navigationRef (não useNavigation) porque este componente é o próprio
  // navegador raiz, não uma tela dentro dele.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const dados = response.notification.request.content.data || {};
      if (!navigationRef.isReady()) return;
      if (dados.sessionId) {
        navigationRef.navigate('SessionDetail', { sessionId: dados.sessionId });
      } else if (dados.cursoId) {
        navigationRef.navigate('FormularioCurso', { cursoId: dados.cursoId });
      }
    });
    return () => subscription.remove();
  }, []);

  return (
    <Stack.Navigator initialRouteName="Home" screenOptions={screenOptions}>
      {/* Home */}
      <Stack.Screen name="Home" component={InicioScreen} />

      {/* Pacientes */}
      <Stack.Screen
        name="Patients"
        component={AnalisantesScreen}
        options={{ title: 'Analisantes' }}
      />

      <Stack.Screen
        name="Busca"
        component={BuscaScreen}
        options={{ title: 'Busca Dr.Sig' }}
      />

      <Stack.Screen name="PatientForm" component={FormularioAnalisanteScreen} />

      <Stack.Screen name="PatientDetail" component={DetalheAnalisanteScreen} />

      {/* Sessões */}
      <Stack.Screen
        name="NewSession"
        component={NovaSessaoScreen}
        options={{ title: 'Nova Sessão' }}
      />

      <Stack.Screen name="SessionDetail" component={DetalheSessaoScreen} />

      {/* Registros */}
      <Stack.Screen
        name="AddRecord"
        component={NovoRegistroScreen}
        options={{ title: 'Adicionar Registro' }}
      />

      <Stack.Screen
        name="RecordDetail"
        component={DetalheRegistroScreen}
        options={{ title: 'Registro' }}
      />

      {/* Perfil */}
      <Stack.Screen
        name="UserProfile"
        component={PerfilScreen}
        options={{ title: 'Meu Perfil' }}
      />

      <Stack.Screen
        name="Assinatura"
        component={AssinaturaScreen}
        options={{ title: 'Assinatura' }}
      />

      <Stack.Screen
        name="MensagensPersonalizadas"
        component={MensagensPersonalizadasScreen}
        options={{ title: 'Mensagens personalizadas' }}
      />

      <Stack.Screen
        name="Cursos"
        component={CursosScreen}
        options={{ title: 'Meus cursos' }}
      />

      <Stack.Screen
        name="FormularioCurso"
        component={FormularioCursoScreen}
        options={{ title: 'Curso' }}
      />

      {/* Início */}
      <Stack.Screen
        name="Afazeres"
        component={AfazeresScreen}
        options={{ title: 'Afazeres' }}
      />

      <Stack.Screen
        name="Relatorios"
        component={RelatoriosScreen}
        options={{ title: 'Relatórios' }}
      />

      <Stack.Screen
        name="DetalheRelatorio"
        component={DetalheRelatorioScreen}
        options={{ title: 'Relatório' }}
      />

      {/* Administrativo */}
      <Stack.Screen
        name="Agenda"
        component={AgendaScreen}
        options={{ title: 'Agenda' }}
      />

      <Stack.Screen
        name="Financeiro"
        component={FinanceiroScreen}
        options={{ title: 'Financeiro' }}
      />

      <Stack.Screen
        name="Cobranca"
        component={CobrancaScreen}
        options={{ title: 'Recebíveis' }}
      />

      <Stack.Screen
        name="Fiscal"
        component={FiscalScreen}
        options={{ title: 'Fiscal' }}
      />

      <Stack.Screen
        name="Pagamentos"
        component={PagamentosScreen}
        options={{ title: 'Pagamentos' }}
      />

      <Stack.Screen
        name="ConfiguracaoFiscalAutomatica"
        component={ConfiguracaoFiscalAutomaticaScreen}
        options={{ title: 'Envio automático' }}
      />

      <Stack.Screen
        name="EditarHorario"
        component={EditarHorarioScreen}
        options={{ title: 'Editar Horário' }}
      />

      <Stack.Screen
        name="EditarHorarioUnico"
        component={EditarHorarioUnicoScreen}
        options={{ title: 'Editar só este horário' }}
      />

      <Stack.Screen
        name="DetalheCompromisso"
        component={DetalheCompromissoScreen}
        options={{ title: 'Compromisso' }}
      />

      <Stack.Screen name="SessoesStatus" component={SessoesStatusScreen} />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const { session, loading } = useAuth();
  const [politicaAceita, setPoliticaAceita] = useState(null);

  useEffect(() => {
    AsyncStorage.getItem(CHAVE_POLITICA_ACEITA).then((valor) => {
      setPoliticaAceita(valor === 'true');
    });
  }, []);

  function aceitarPolitica() {
    AsyncStorage.setItem(CHAVE_POLITICA_ACEITA, 'true');
    setPoliticaAceita(true);
  }

  if (loading || politicaAceita === null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={salvia.tinta} />
      </View>
    );
  }

  if (!session && !politicaAceita) {
    return <AvisoPrivacidadeScreen onAceitar={aceitarPolitica} />;
  }

  return session ? <AppStackNavigator /> : <AuthStackNavigator />;
}
