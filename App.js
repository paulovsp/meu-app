import 'react-native-gesture-handler';

import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';

import AppNavigator from './src/navigation/AppNavigator';
import { navigationRef } from './src/navigation/navigationRef';
import { AuthProvider } from './src/contexts/AuthContext';
import LimiteDeErro from './src/components/LimiteDeErro';

// ─── Atualização OTA na PRIMEIRA abertura, não na segunda ───────────────
//
// Com `fallbackToCacheTimeout: 0` (app.json), o app abre sempre com o
// código que já tem e baixa a atualização por trás — que só vale na
// abertura SEGUINTE. Na prática: a pessoa abre o app depois de uma
// correção publicada, e vê o defeito corrigido... de novo. Foi assim que
// um guia "não abriu" e um aviso já retirado ainda chegou.
//
// Aqui a splash fica na tela enquanto se pergunta se há atualização; se
// houver, ela é baixada e aplicada AGORA, antes de qualquer tela. O teto
// de tempo é curto de propósito: rede lenta não pode virar app que não
// abre — nesse caso vale o comportamento antigo, e a atualização entra na
// próxima abertura.
const TETO_ATUALIZACAO_MS = 6000;

SplashScreen.preventAutoHideAsync().catch(() => {});

async function aplicarAtualizacaoPendente() {
  if (__DEV__ || !Updates.isEnabled) return;
  try {
    const baixou = await Promise.race([
      (async () => {
        const conferida = await Updates.checkForUpdateAsync();
        if (!conferida.isAvailable) return false;
        await Updates.fetchUpdateAsync();
        return true;
      })(),
      new Promise((resolver) => setTimeout(() => resolver(false), TETO_ATUALIZACAO_MS)),
    ]);
    if (baixou) await Updates.reloadAsync();
  } catch (_) {
    // Sem rede, ou servidor de atualização fora: abre com o que tem.
  }
}

export default function App() {
  useEffect(() => {
    aplicarAtualizacaoPendente().finally(() => {
      SplashScreen.hideAsync().catch(() => {});
    });
  }, []);

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
