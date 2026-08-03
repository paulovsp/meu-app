import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';

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

// Administrativo
import AgendaScreen from '../screens/AgendaScreen';
import FinanceiroScreen from '../screens/FinanceiroScreen';
import CobrancaScreen from '../screens/CobrancaScreen';
import FiscalScreen from '../screens/FiscalScreen';
import ConfiguracaoFiscalAutomaticaScreen from '../screens/ConfiguracaoFiscalAutomaticaScreen';
import EditarHorarioScreen from '../screens/DisponibilidadeScreen';
import DetalheCompromissoScreen from '../screens/DetalheCompromissoScreen';

const Stack = createNativeStackNavigator();

const screenOptions = {
  headerStyle: { backgroundColor: '#fff' },
  headerTintColor: '#1a202c',
  headerTitleStyle: { fontWeight: '700' },
  headerShadowVisible: false,
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
  return (
    <Stack.Navigator initialRouteName="Home" screenOptions={screenOptions}>
      {/* Home */}
      <Stack.Screen
        name="Home"
        component={InicioScreen}
        options={{ headerShown: false }}
      />

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

      <Stack.Screen
        name="PatientForm"
        component={FormularioAnalisanteScreen}
        options={{ title: 'Paciente' }}
      />

      <Stack.Screen
        name="PatientDetail"
        component={DetalheAnalisanteScreen}
        options={{ headerShown: false }}
      />

      {/* Sessões */}
      <Stack.Screen
        name="NewSession"
        component={NovaSessaoScreen}
        options={{ title: 'Nova Sessão' }}
      />

      <Stack.Screen
        name="SessionDetail"
        component={DetalheSessaoScreen}
        options={{ headerShown: false }}
      />

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
        name="DetalheCompromisso"
        component={DetalheCompromissoScreen}
        options={{ title: 'Compromisso' }}
      />
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
        <ActivityIndicator size="large" color="#4A90D9" />
      </View>
    );
  }

  if (!session && !politicaAceita) {
    return <AvisoPrivacidadeScreen onAceitar={aceitarPolitica} />;
  }

  return session ? <AppStackNavigator /> : <AuthStackNavigator />;
}
