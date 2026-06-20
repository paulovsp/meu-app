import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { initDatabase } from './src/services/database';

export default function App() {
  const [dbPronto, setDbPronto] = useState(false);

  useEffect(() => {
    try {
      initDatabase();
    } catch (e) {
      console.error('Erro ao inicializar banco:', e);
    } finally {
      setDbPronto(true);
    }
  }, []);

  if (!dbPronto) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#4A90D9" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}