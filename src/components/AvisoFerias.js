// ─── "Você não deveria estar aqui" — o aviso das férias do analista ─────
//
// Pedido do Paulo (26/11/2026): durante as férias do analista o app fica
// em silêncio (nenhum lembrete, nenhuma pergunta sobre sessões) e, se a
// pessoa abrir o app mesmo assim, no lugar dos lembretes vem um aviso
// "destacado, colorido, divertido", brincando que ela nem deveria estar ali
// e que o Dr.Sig está de olho — sem sair da estética do app.
//
// Por isso a arte das férias (ArteFerias) no topo, as cores lavadas do
// tema, e o humor no texto, não no visual.
import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform, BackHandler } from 'react-native';
import ArteFerias from './ArteFerias';

const SERIFA = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });

// Um por dia, para não repetir sempre a mesma piada. `{fim}` = último dia
// de férias; `{volta}` = o dia seguinte.
export const RECADOS_DE_FERIAS = [
  {
    selo: 'Flagrei! 👀',
    titulo: 'Você não deveria estar aqui.',
    texto: 'Suas férias vão até {fim}, e eu estou de olho. Pode ir tranquilo: a agenda está pausada, o financeiro está em dia e nenhum lembrete vai te procurar.',
  },
  {
    selo: 'Psiu… férias! 🌊',
    titulo: 'Até Freud parava no verão.',
    texto: 'Ele passava meses longe do divã, e ninguém reclamou. O consultório fica em silêncio até {fim}. Nada vai fugir daqui.',
  },
  {
    selo: 'Opa, opa, opa ☀️',
    titulo: 'Associação livre, só com o mar.',
    texto: 'Feche o app sem culpa. Eu fico de vigia por aqui e te espero em {volta}.',
  },
  {
    selo: 'Você de novo? 🙈',
    titulo: 'Está tudo sob controle.',
    texto: 'Sessões em férias, cobranças certinhas, nenhuma pendência fugindo. Volte em {volta}, de preferência descansado.',
  },
];

function dataCurta(iso) {
  const [, m, d] = String(iso || '').split('-');
  return d && m ? `${d}/${m}` : '';
}

function diaSeguinte(iso) {
  const [a, m, d] = String(iso || '').split('-').map(Number);
  if (!a) return '';
  const dt = new Date(Date.UTC(a, m - 1, d + 1));
  return dataCurta(dt.toISOString().slice(0, 10));
}

/** Escolhe o recado do dia e preenche as datas. Pura, para ser testável. */
export function recadoDeFerias(ferias, hoje = new Date()) {
  const indice = (hoje.getFullYear() * 400 + hoje.getMonth() * 31 + hoje.getDate()) % RECADOS_DE_FERIAS.length;
  const r = RECADOS_DE_FERIAS[indice];
  const preencher = (t) => t.replace('{fim}', dataCurta(ferias?.data_fim)).replace('{volta}', diaSeguinte(ferias?.data_fim));
  return { ...r, texto: preencher(r.texto) };
}

export default function AvisoFerias({ visivel, ferias, onFechar }) {
  if (!ferias) return null;
  const recado = recadoDeFerias(ferias);

  function descansar() {
    onFechar?.();
    // No Android dá para sair de fato do app, que é a graça da brincadeira.
    // No iPhone o sistema não deixa; só fecha o aviso.
    if (Platform.OS === 'android') BackHandler.exitApp();
  }

  return (
    <Modal visible={visivel} transparent animationType="fade" onRequestClose={onFechar}>
      <View style={styles.fundo}>
        <View style={styles.cartao}>
          <View style={styles.arte}>
            <ArteFerias periodo={null} mensagem={null} style={{ borderRadius: 0 }} />
          </View>
          <View style={styles.selo}>
            <Text style={styles.seloTxt}>{recado.selo}</Text>
          </View>
          <View style={styles.corpo}>
            <Text style={styles.titulo}>{recado.titulo}</Text>
            <Text style={styles.texto}>{recado.texto}</Text>
            <TouchableOpacity style={styles.botao} onPress={descansar} activeOpacity={0.85}>
              <Text style={styles.botaoTxt}>Prometo descansar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.espiar} onPress={onFechar}>
              <Text style={styles.espiarTxt}>Só uma espiadinha</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: 'rgba(48,44,40,0.45)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  cartao: {
    width: '100%', maxWidth: 380, backgroundColor: '#FDFCFA', borderRadius: 22, overflow: 'hidden',
    shadowColor: '#4E4941', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 20, elevation: 8,
  },
  arte: { height: 190 },
  selo: {
    alignSelf: 'center', marginTop: -18, backgroundColor: '#F3C9A4', borderRadius: 18,
    paddingHorizontal: 16, paddingVertical: 7, borderWidth: 3, borderColor: '#FDFCFA',
  },
  seloTxt: { color: '#5C3B1E', fontWeight: '700', fontSize: 14, letterSpacing: 0.3, lineHeight: 19 },
  corpo: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 18, alignItems: 'center' },
  titulo: {
    fontFamily: SERIFA, fontStyle: 'italic', fontSize: 23, color: '#3A5C4F', textAlign: 'center', lineHeight: 30,
  },
  texto: { fontSize: 14.5, color: '#4E4941', textAlign: 'center', marginTop: 10, lineHeight: 21 },
  botao: {
    marginTop: 18, backgroundColor: '#497363', borderRadius: 14, paddingVertical: 13, alignSelf: 'stretch', alignItems: 'center',
  },
  botaoTxt: { color: '#FFFFFF', fontWeight: '600', fontSize: 15, lineHeight: 21 },
  espiar: { paddingVertical: 10, paddingHorizontal: 12, marginTop: 4 },
  espiarTxt: { color: '#8E7BAA', fontSize: 13.5, textDecorationLine: 'underline', lineHeight: 19 },
});
