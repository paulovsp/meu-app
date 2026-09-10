import { useEffect } from 'react';
import { Alert } from 'react-native';
import { getSituacaoIA, MOTIVO_ASSINATURA, MENSAGEM_SEM_CREDITOS } from '../services/usoDeIA';
import { MENSAGEM_ASSINATURA_INATIVA } from '../services/assinatura';

// Fecha a porta de telas que SÓ existem pra usar IA paga — hoje a Busca
// Dr.Sig. Sem isto, a pessoa entrava, escolhia analisantes, escrevia a
// pergunta inteira e só então descobria que a conta estava inativa ou sem
// crédito: o trabalho todo perdido no último clique.
//
// Vale só pra tela que não tem nada a mostrar sem IA. Relatórios, por
// exemplo, NÃO usa isto: lá é preciso poder ler os relatórios já gerados
// mesmo com a conta inativa — o que já é seu continua seu. Naquela tela o
// bloqueio fica no botão de gerar, não na entrada.
export function useBloqueioIA(navigation) {
  useEffect(() => {
    let cancelado = false;
    getSituacaoIA()
      .then(({ pode, motivo }) => {
        if (cancelado || pode) return;
        const ehAssinatura = motivo === MOTIVO_ASSINATURA;
        Alert.alert(
          ehAssinatura ? 'Assinatura inativa' : 'Créditos de IA esgotados',
          ehAssinatura ? MENSAGEM_ASSINATURA_INATIVA : MENSAGEM_SEM_CREDITOS,
          [{ text: 'Entendi', onPress: () => navigation.goBack() }],
          { cancelable: false },
        );
      })
      .catch(() => {});
    return () => { cancelado = true; };
  }, []);
}
