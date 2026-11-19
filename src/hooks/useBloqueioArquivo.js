import { useEffect } from 'react';
import { Alert } from 'react-native';
import { arquivoLiberado, MENSAGEM_SO_NA_VERSAO_COMPLETA } from '../services/versao';

// Fecha a porta das telas que só existem na versão completa (Novo registro,
// Busca Dr.Sig) pra quem está na versão Agenda — inclusive quem chega por
// outro caminho que não a grade da Clínica (menu lateral, Agenda, check-in).
// O banco já impede a escrita (migration 0112); isto é só o aviso na porta.
export function useBloqueioArquivo(navigation) {
  useEffect(() => {
    let cancelado = false;
    arquivoLiberado()
      .then((liberado) => {
        if (cancelado || liberado) return;
        Alert.alert(
          'Só na versão completa',
          MENSAGEM_SO_NA_VERSAO_COMPLETA,
          [{ text: 'Entendi', onPress: () => navigation.goBack() }],
          { cancelable: false },
        );
      })
      .catch(() => {});
    return () => { cancelado = true; };
  }, []);
}
