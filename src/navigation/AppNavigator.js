import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from '../screens/HomeScreen';
import PatientsScreen from '../screens/PatientsScreen';
import SearchScreen from '../screens/SearchScreen';
import PatientFormScreen from '../screens/PatientFormScreen';
import PatientDetailScreen from '../screens/PatientDetailScreen';
import SessionDetailScreen from '../screens/SessionDetailScreen';
import NewSessionScreen from '../screens/NewSessionScreen';
import AddRecordScreen from '../screens/AddRecordScreen';
import RecordDetailScreen from '../screens/RecordDetailScreen';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#fff' },
        headerTintColor: '#1a202c',
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Patients" component={PatientsScreen} options={{ title: 'Analisantes' }} />
      <Stack.Screen name="Search" component={SearchScreen} options={{ title: 'Buscar' }} />
      <Stack.Screen name="NewSession" component={NewSessionScreen} options={{ title: 'Nova Sessão' }} />
      <Stack.Screen name="AddRecord" component={AddRecordScreen} options={{ title: 'Adicionar Registro' }} />
      <Stack.Screen name="PatientForm" component={PatientFormScreen} options={{ title: 'Paciente' }} />
      <Stack.Screen name="PatientDetail" component={PatientDetailScreen} options={{ headerShown: false }} />
      <Stack.Screen name="SessionDetail" component={SessionDetailScreen} options={{ headerShown: false }} />
      <Stack.Screen name="RecordDetail" component={RecordDetailScreen} options={{ title: 'Registro' }} />
    </Stack.Navigator>
  );
}