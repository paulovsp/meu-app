import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Autenticação
import LoginScreen from '../screens/LoginScreen';

// Principal
import InicioScreen from '../screens/InicioScreen';

// Analisantes
import AnalisantesScreen from '../screens/AnalisantesScreen';
import BuscaScreen from '../screens/BuscaScreen';
import FormularioAnalisanteScreen from '../screens/FormularioAnalisanteScreen';
import DetalheAnalisanteScreen from '../screens/DetalheAnalisanteScreen';
import PerfilPsicossomaticoScreen from '../screens/PerfilPsicossomaticoScreen';

// Sessões
import DetalheSessaoScreen from '../screens/DetalheSessaoScreen';
import NovaSessaoScreen from '../screens/NovaSessaoScreen';

// Registros
import NovoRegistroScreen from '../screens/NovoRegistroScreen';
import DetalheRegistroScreen from '../screens/DetalheRegistroScreen';

// Imagens
import RecorteImagemScreen from '../screens/RecorteImagemScreen';

// Perfil
import PerfilScreen from '../screens/PerfilScreen';

// Administrativo
import AgendaScreen from '../screens/AgendaScreen';
import FinanceiroScreen from '../screens/FinanceiroScreen';
import CobrancaScreen from '../screens/CobrancaScreen';
import FiscalScreen from '../screens/FiscalScreen';
import EditarHorarioScreen from '../screens/DisponibilidadeScreen';
import DetalheCompromissoScreen from '../screens/DetalheCompromissoScreen';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Login"
      screenOptions={{
        headerStyle: {
          backgroundColor: '#fff',
        },
        headerTintColor: '#1a202c',
        headerTitleStyle: {
          fontWeight: '700',
        },
        headerShadowVisible: false,
      }}
    >
      {/* Login */}
      <Stack.Screen
        name="Login"
        component={LoginScreen}
        options={{ headerShown: false }}
      />

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
        name="Search"
        component={BuscaScreen}
        options={{ title: 'Buscar' }}
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

      <Stack.Screen
        name="PerfilPsicossomatico"
        component={PerfilPsicossomaticoScreen}
        options={{ title: 'Perfil Psicossomático' }}
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

      {/* Imagem */}
      <Stack.Screen
        name="ImageCropper"
        component={RecorteImagemScreen}
        options={{
          headerShown: false,
          presentation: 'modal',
        }}
      />

      {/* Perfil */}
      <Stack.Screen
        name="UserProfile"
        component={PerfilScreen}
        options={{ title: 'Meu Perfil' }}
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
        options={{ title: 'Recebimentos' }}
      />

      <Stack.Screen
        name="Fiscal"
        component={FiscalScreen}
        options={{ title: 'Fiscal' }}
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