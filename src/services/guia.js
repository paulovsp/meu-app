// ─── Os dois guias ──────────────────────────────────────────────────────
//
// São guias diferentes porque as pessoas que os recebem estão em situações
// opostas.
//
// Quem entra no consultório de demonstração já tem um consultório montado
// na frente: 15 fichas, agenda cheia, sessões transcritas. O que falta é
// saber que aquilo tudo existe. O guia dessa conta é um PASSEIO — leva a
// pessoa por cada tela e diz o que ela faz.
//
// Quem acabou de assinar tem o oposto: o app inteiro funcionando e nenhum
// dado dentro. Mostrar telas vazias não convence ninguém. O guia dessa
// pessoa é um ROTEIRO DE PREENCHIMENTO — cada passo destrava uma função, e
// diz qual.
//
// Ambos navegam de verdade pelo app enquanto explicam. Guia que descreve a
// tela sem abrir a tela é manual, e ninguém lê manual.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const GUIA_DEMONSTRACAO = 'demonstracao';
export const GUIA_PRIMEIRO_USO = 'primeiro-uso';

const CHAVE = (qual) => `drsig.guia.${qual}`;

/**
 * Passos do passeio pelo consultório de demonstração.
 *
 * A ordem não é a do menu: é a do dia de trabalho. Começa pela agenda
 * (a primeira coisa que se abre de manhã), passa pelo atendimento, pelo
 * registro, e termina no administrativo — que é o que a maioria dos apps
 * não faz e é metade do problema de quem tem consultório.
 */
export const PASSOS_DEMONSTRACAO = [
  {
    rota: 'Home',
    titulo: 'Este consultório é fictício',
    texto:
      'Você está no consultório do Sigmund Freud: 15 analisantes e supervisionandos, '
      + 'agenda de quatro semanas, 67 registros de sessão e três sessões transcritas. '
      + 'Tudo inventado, e nada aqui pode ser alterado — é a mesma amostra para todo mundo.\n\n'
      + 'Vou levar você pelas telas principais. Dá para sair a qualquer momento.',
  },
  {
    rota: 'Agenda',
    titulo: 'A agenda, com os horários fixos',
    texto:
      'Cada analisante tem horário fixo na semana, e a agenda se repete sozinha a partir '
      + 'dele — não é preciso remarcar toda semana.\n\n'
      + 'Repare que há faltas e cancelamentos: o app registra o que não aconteceu, porque é '
      + 'disso que dependem a cobrança e o controle de frequência.',
  },
  {
    rota: 'Patients',
    titulo: 'Analisantes e supervisionandos',
    texto:
      'A mesma tela guarda os dois, em abas separadas. Ferenczi e Stekel aparecem nas duas: '
      + 'estão em análise e em supervisão, em dias diferentes.\n\n'
      + 'Toque em qualquer ficha para ver o histórico completo da pessoa.',
  },
  {
    rota: 'SessoesStatus',
    titulo: 'O que já aconteceu, e o que ficou sem relato',
    texto:
      'Esta tela responde à pergunta que atrapalha todo fim de semana: quais sessões já '
      + 'aconteceram e ainda não têm registro?\n\n'
      + 'Dali você abre direto o registro que falta, sem procurar na agenda.',
  },
  {
    rota: 'Busca',
    titulo: 'Busca Dr.Sig — pergunta em vez de procura',
    texto:
      'Em vez de abrir ficha por ficha, você pergunta. "Em que sessões a Anna O. falou do pai?" '
      + 'ou "o que mudou no Pequeno Hans desde junho?".\n\n'
      + 'A busca lê os registros dos analisantes que você selecionar e responde citando as '
      + 'sessões. Aqui na demonstração ela está desligada — é o recurso que consome crédito de IA.',
  },
  {
    rota: 'Relatorios',
    titulo: 'Relatórios prontos para quem pede',
    titulo_curto: 'Relatórios',
    texto:
      'Relatório de evolução, declaração de comparecimento, encaminhamento. Alguns são '
      + 'calculados dentro do app, sem custo; os que usam IA mostram o preço estimado antes '
      + 'de gerar, e você decide.',
  },
  {
    rota: 'Cobranca',
    titulo: 'Cobrança: quem está devendo, sem planilha',
    texto:
      'O app cruza as sessões realizadas com os pagamentos recebidos e mostra o que está em '
      + 'aberto, por pessoa. Dá para mandar a cobrança por WhatsApp com o texto que você '
      + 'escreveu uma vez e não precisa reescrever.',
  },
  {
    rota: 'Financeiro',
    titulo: 'Entradas, saídas e o mês fechado',
    texto:
      'Quanto entrou, quanto saiu, e quanto falta entrar — por dia, semana ou mês. As despesas '
      + 'do consultório entram aqui, e o resultado já sai pronto para o contador.',
  },
  {
    rota: 'Fiscal',
    titulo: 'Nota fiscal, inclusive automática',
    texto:
      'Emissão de recibo e nota, uma a uma ou em lote. Dá para deixar automático: toda semana '
      + 'ou todo dia do mês, para os analisantes que você marcar.',
  },
  {
    rota: 'Cursos',
    titulo: 'Aulas e supervisão de grupo',
    texto:
      'Aulas e grupos entram aqui, com gravação e transcrição como nas sessões. A Sociedade '
      + 'Psicológica das Quartas-Feiras, na agenda, é uma supervisão de grupo com cinco '
      + 'participantes.',
  },
  {
    rota: 'UserProfile',
    titulo: 'E o consultório em números',
    texto:
      'No seu perfil ficam os dados do consultório, a chave Pix, o contador, os créditos de '
      + 'IA e o seu plano.\n\n'
      + 'É isso. Quando quiser o seu próprio consultório aqui dentro, saia da demonstração e '
      + 'crie sua conta — o cadastro leva dois minutos.',
    ultimo: true,
  },
];

/**
 * Passos do primeiro uso de quem assinou.
 *
 * Cada passo existe porque DESTRAVA alguma coisa. A ordem é a de
 * dependência real: sem analisante não há agenda, sem agenda não há
 * sessão, sem sessão não há cobrança nem nota.
 *
 * `verificar` diz se o passo já está cumprido — quem já cadastrou um
 * analisante antes de abrir o guia não deve ser mandado cadastrar de novo.
 */
export const PASSOS_PRIMEIRO_USO = [
  {
    rota: 'Home',
    titulo: 'Bem-vinda ao seu consultório',
    texto:
      'O app já está liberado. Faltam quatro informações para que ele funcione inteiro — '
      + 'cada uma destrava uma parte.\n\n'
      + 'Leva uns cinco minutos, e dá para parar no meio e continuar depois.',
    chave: null,
  },
  {
    rota: 'PatientForm',
    titulo: '1. Cadastre seu primeiro analisante',
    texto:
      'É o cadastro que sustenta todo o resto: agenda, sessões, registros, cobrança e nota '
      + 'fiscal partem daqui.\n\n'
      + 'O essencial é nome, valor da sessão e dia de pagamento. O resto pode ficar para depois. '
      + 'Se ele também for supervisionando, marque as duas caixas.',
    chave: 'analisante',
  },
  {
    rota: 'EditarHorario',
    titulo: '2. Marque o horário dele na semana',
    texto:
      'Horário fixo semanal: o app repete sozinho e a agenda se preenche sem você remarcar '
      + 'nada.\n\n'
      + 'É o horário que faz a sessão aparecer para registrar, a falta ser contabilizada e a '
      + 'cobrança saber o que cobrar.',
    chave: 'horario',
  },
  {
    rota: 'UserProfile',
    titulo: '3. Sua chave Pix e seus dados',
    texto:
      'A chave Pix entra automaticamente nas mensagens de cobrança — sem ela, você digita a '
      + 'chave toda vez.\n\n'
      + 'Aproveite e confira endereço e registro profissional: é o que aparece nos recibos e '
      + 'declarações.',
    chave: 'pix',
  },
  {
    rota: 'UserProfile',
    titulo: '4. Os dados do seu contador',
    texto:
      'Com o contador cadastrado, o app manda os recibos direto para ele, no fechamento que '
      + 'você escolher — semanal ou mensal.\n\n'
      + 'Sem isso, a parte fiscal funciona, mas o envio fica manual.',
    chave: 'contador',
  },
  {
    rota: 'Home',
    titulo: 'Pronto',
    texto:
      'Seu consultório está de pé. A partir daqui:\n\n'
      + '• grave ou escreva o relato de uma sessão\n'
      + '• pergunte à Busca Dr.Sig o que já registrou\n'
      + '• acompanhe o que está em aberto em Cobrança\n\n'
      + 'Este guia fica em Meu Perfil se você quiser rever.',
    chave: null,
    ultimo: true,
  },
];

/** Já mostramos este guia para esta pessoa? */
export async function guiaJaVisto(qual) {
  try {
    return (await AsyncStorage.getItem(CHAVE(qual))) === 'visto';
  } catch (_) {
    // Falha de leitura não pode virar guia aparecendo toda vez que o app
    // abre — irrita muito mais do que nunca ter aparecido.
    return true;
  }
}

export async function marcarGuiaVisto(qual) {
  try {
    await AsyncStorage.setItem(CHAVE(qual), 'visto');
  } catch (_) { /* sem storage: o guia aparece de novo, e só */ }
}

export async function esquecerGuia(qual) {
  try {
    await AsyncStorage.removeItem(CHAVE(qual));
  } catch (_) {}
}
