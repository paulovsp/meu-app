// ─── Check-in de um compromisso passado ainda 'agendado' ───────────────────
// Nada no app muda o status de um compromisso sozinho quando o horário
// passa — alguém precisa confirmar se aconteceu. Essa confirmação (e a
// pergunta de cobrança que vem junto, no caso de pagamento por sessão) era
// só feita dentro de DetalheCompromissoScreen.js; extraída aqui pra ser
// reaproveitada também pelo popup global de check-in na Início (item 7, v13),
// que precisa da mesma lógica de cobrança sem duplicá-la.
import { Alert } from 'react-native';
import {
  updateAppointmentStatus, parsePreco, converterParaBRL,
  confirmarPagamentoSessao as confirmarPagamentoSessaoDB,
} from './database';
import { dispararFiscalPorSessao } from './fiscalAutomatico';
import { ehTipoGrupo } from './tiposEvento';
import { mensagemDeErro } from './erros';

// Nome a exibir — paciente único (individual), lista de participantes (em
// grupo) ou o título livre ("Outros"), item J.23.
export function nomeExibicaoCompromisso(compromisso) {
  const tipo = compromisso.tipo || 'sessao_individual';
  if (tipo === 'outros') return compromisso.titulo || 'Outros';
  if (ehTipoGrupo(tipo)) {
    const nomes = (compromisso.participantes || []).map((p) => p.nome).filter(Boolean);
    return nomes.length > 0 ? nomes.join(', ') : 'Grupo';
  }
  return compromisso.patient_nome || 'Analisante';
}

// Cobrança "por sessão": pergunta se o pagamento já foi recebido logo após
// marcar a sessão como realizada (ou como falta, que continua sendo
// cobrada). Resolve a Promise só depois que a analisante escolhe uma opção
// (ou de imediato, se a cobrança for mensal), pra quem chama poder aguardar
// antes de seguir pro próximo passo.
export function perguntarPagamentoSessao(compromisso) {
  return new Promise((resolve) => {
    if (compromisso.patient_tipo_cobranca !== 'por_sessao') {
      resolve();
      return;
    }
    Alert.alert(
      'Pagamento da sessão',
      `O pagamento desta sessão de ${compromisso.patient_nome} já foi recebido?`,
      [
        { text: 'Ainda não', onPress: () => resolve() },
        {
          text: 'Sim, recebido',
          onPress: async () => {
            try {
              const valor = await converterParaBRL(parsePreco(compromisso.patient_preco), compromisso.patient_preco_moeda);
              await confirmarPagamentoSessaoDB(compromisso.id, compromisso.patient_id, compromisso.date, valor);
              dispararFiscalPorSessao(compromisso.patient_id, compromisso.date, valor);
            } catch (e) {
              Alert.alert('Erro ao confirmar pagamento', mensagemDeErro(e));
            } finally {
              resolve();
            }
          },
        },
      ]
    );
  });
}

// Sessão não aconteceu: precisa saber se foi cancelada com antecedência
// (cobrança cancelada — não dispara pergunta de pagamento) ou se foi uma
// falta sem aviso (cobrança segue normalmente — dispara a mesma pergunta
// de pagamento usada quando a sessão é realizada). `aoConcluir` roda depois
// de toda a sequência (inclusive a pergunta de pagamento, se houver).
export function perguntarTipoNaoRealizada(compromisso, aoConcluir) {
  Alert.alert(
    'Foi cancelada ou falta?',
    `${nomeExibicaoCompromisso(compromisso)} não aconteceu. Foi cancelada com antecedência, ou foi uma falta (sem aviso)?`,
    [
      {
        text: 'Cancelada',
        onPress: async () => {
          try {
            await updateAppointmentStatus(compromisso.id, 'cancelado');
            Alert.alert('Cancelamento registrado', 'Essa sessão foi marcada como cancelada — a cobrança dela foi cancelada.');
          } catch (e) {
            Alert.alert('Erro ao atualizar', mensagemDeErro(e));
          } finally {
            aoConcluir?.();
          }
        },
      },
      {
        text: 'Falta',
        onPress: async () => {
          try {
            await updateAppointmentStatus(compromisso.id, 'nao_realizado');
            Alert.alert('Falta registrada', 'Essa sessão foi marcada como falta — a cobrança dela segue normalmente.');
            await perguntarPagamentoSessao(compromisso);
          } catch (e) {
            Alert.alert('Erro ao atualizar', mensagemDeErro(e));
          } finally {
            aoConcluir?.();
          }
        },
      },
      { text: 'Fechar', style: 'cancel', onPress: () => aoConcluir?.({ fechado: true }) },
    ]
  );
}

/** Pergunta se um compromisso passado (ainda 'agendado') aconteceu, e
 * encadeia a pergunta de cobrança e o "cancelada ou falta?" conforme a
 * resposta — é o ponto de entrada único do fluxo de check-in, usado tanto
 * ao abrir um compromisso específico (DetalheCompromissoScreen.js) quanto
 * no popup global da Início que varre todos os pendentes (item 7, v13).
 *  - aoRealizada(compromisso): chamado depois de marcar como realizado (e
 *    responder a pergunta de pagamento, se houver) — quem chama decide se
 *    oferece "adicionar relato agora".
 *  - aoConcluir(): chamado ao fim de qualquer caminho, inclusive se a
 *    pessoa tocar em "Fechar" sem responder. */
export function perguntarCheckin(compromisso, { aoRealizada, aoConcluir } = {}) {
  Alert.alert(
    'A sessão aconteceu?',
    `O horário de ${nomeExibicaoCompromisso(compromisso)} já passou. A sessão foi realizada?`,
    [
      {
        text: 'Não foi realizada',
        onPress: () => perguntarTipoNaoRealizada(compromisso, aoConcluir),
      },
      {
        text: 'Sim, foi realizada',
        onPress: async () => {
          try {
            await updateAppointmentStatus(compromisso.id, 'realizado');
            await perguntarPagamentoSessao(compromisso);
            await aoRealizada?.(compromisso);
          } catch (e) {
            Alert.alert('Erro ao atualizar', mensagemDeErro(e));
          } finally {
            aoConcluir?.();
          }
        },
      },
      { text: 'Fechar', style: 'cancel', onPress: () => aoConcluir?.({ fechado: true }) },
    ]
  );
}
