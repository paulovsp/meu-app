import 'react-native-gesture-handler';

import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';

import AppNavigator from './src/navigation/AppNavigator';
import { navigationRef } from './src/navigation/navigationRef';
import { AuthProvider } from './src/contexts/AuthContext';
import LimiteDeErro from './src/components/LimiteDeErro';

export default function App() {
  return (
    // O limite de erro fica POR FORA de tudo, inclusive da navegação: um
    // erro no provider de autenticação ou no próprio navegador precisa cair
    // aqui também. Por dentro, a tela branca não teria quem a segurasse.
    //
    // O SafeAreaProvider fica por fora dele porque a tela de erro também
    // precisa respeitar o entalhe do aparelho.
    <SafeAreaProvider>
      <LimiteDeErro>
        <AuthProvider>
          <NavigationContainer ref={navigationRef}>
            <AppNavigator />
          </NavigationContainer>
        </AuthProvider>
      </LimiteDeErro>
    </SafeAreaProvider>
  );
}
