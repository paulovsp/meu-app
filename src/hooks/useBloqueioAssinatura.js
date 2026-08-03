import { useEffect } from 'react';
import { Alert } from 'react-native';
import { assinaturaEstaAtiva, MENSAGEM_ASSINATURA_INATIVA } from '../services/assinatura';

// Bloqueia telas de criação/edição quando a assinatura não está ativa —
// a RLS do banco (migration 0025) já impede a escrita de verdade; isto é
// só a experiência de avisar antes, em vez de deixar a pessoa preencher um
// formulário inteiro pra levar um erro de permissão no final.
export function useBloqueioAssinatura(navigation) {
  useEffect(() => {
    let cancelado = false;
    assinaturaEstaAtiva().then((ativa) => {
      if (cancelado || ativa) return;
      Alert.alert('Assinatura inativa', MENSAGEM_ASSINATURA_INATIVA, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    });
    return () => { cancelado = true; };
  }, []);
}
