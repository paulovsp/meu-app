// ─── Aviso dentro do app: transcrição pronta ──────────────────────────
//
// A transcrição termina no servidor, minutos ou horas depois da sessão. Até
// aqui o único aviso era o push — e quem tivesse o push desligado (ou a
// permissão do Android negada) não ficava sabendo de nada: a sessão ficava
// pronta e a pessoa só descobria abrindo a sessão por acaso.
//
// Este é o canal "App" da matriz de notificações: ao abrir o aplicativo,
// diz o que ficou pronto desde a última vez que avisamos.
//
// A marca de "já avisei" fica no aparelho, não no perfil, e é de propósito:
// o aviso é sobre esta tela, neste celular. Se a pessoa usar dois
// aparelhos, cada um mostra uma vez — o que é melhor do que um deles nunca
// mostrar porque o outro marcou primeiro.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const CHAVE = 'aviso_transcricao_ultimo';

/** Sessões cuja transcrição terminou (ou falhou) desde o último aviso. */
export async function obterTranscricoesConcluidas() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) return [];

  const desde = await AsyncStorage.getItem(CHAVE);
  let q = supabase
    .from('sessions')
    // Sem `transcript`: a lista só precisa de nome e estado, e essas
    // transcrições são o maior texto do banco — trazer todas encheria a
    // memória por um alerta de duas linhas.
    .select('id, date, transcricao_status, patients(nome)')
    .eq('user_id', session.user.id)
    .in('transcricao_status', ['concluida', 'erro'])
    .order('updated_at', { ascending: false })
    .limit(20);
  // Sem marca (primeira vez neste aparelho) não despeja o histórico
  // inteiro: quem instala o app hoje não quer saber de transcrição de
  // três meses atrás. Marca a partir de agora e avisa da próxima.
  if (!desde) {
    await AsyncStorage.setItem(CHAVE, new Date().toISOString());
    return [];
  }
  q = q.gt('updated_at', desde);

  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((s) => ({
    id: s.id,
    date: s.date,
    falhou: s.transcricao_status === 'erro',
    nome: s.patients?.nome || 'Analisante',
  }));
}

/** Marca o momento do aviso — daqui pra frente só o que for mais novo. */
export async function marcarTranscricoesAvisadas() {
  await AsyncStorage.setItem(CHAVE, new Date().toISOString());
}

/** Texto do alerta. Separado pra ser testável sem tela nem banco. */
export function resumirTranscricoes(itens) {
  const prontas = itens.filter((i) => !i.falhou);
  const falhas = itens.filter((i) => i.falhou);

  const titulo = itens.length === 1
    ? (itens[0].falhou ? 'Uma transcrição falhou' : 'Transcrição pronta')
    : `${itens.length} transcrições`;

  const linhas = [];
  if (prontas.length > 0) {
    linhas.push(prontas.length === 1
      ? `Pronta: ${prontas[0].nome}`
      : `Prontas: ${prontas.map((p) => p.nome).join(', ')}`);
  }
  if (falhas.length > 0) {
    linhas.push(falhas.length === 1
      ? `Falhou: ${falhas[0].nome}`
      : `Falharam: ${falhas.map((f) => f.nome).join(', ')}`);
  }
  return { titulo, mensagem: linhas.join('\n') };
}
