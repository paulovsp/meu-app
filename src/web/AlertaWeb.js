// ─── Alert.alert na versão de computador ────────────────────────────────
//
// No navegador, o Alert.alert do React Native não faz nada: a janela de
// confirmação simplesmente não aparece, e o botão "Apagar" ou "Salvar"
// que dependia dela fica mudo. O app tem centenas de chamadas, então, em
// vez de mexer em cada tela, a versão web troca o Alert.alert por esta
// janela, desenhada no mesmo visual do app. No celular nada muda: a troca
// só acontece quando Platform.OS === 'web'.
import React, { useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { papel, salvia, semantica, sombra, tinta } from '../theme';

const fila = [];
let avisarHost = null;

export function instalarAlertaWeb() {
  if (Platform.OS !== 'web') return;
  Alert.alert = (titulo, mensagem, botoes, opcoes) => {
    fila.push({
      titulo: titulo ?? '',
      mensagem: mensagem ?? '',
      botoes: Array.isArray(botoes) && botoes.length ? botoes : [{ text: 'OK' }],
      opcoes: opcoes || {},
    });
    if (avisarHost) avisarHost();
  };
}

export function AlertaWebHost() {
  const [atual, setAtual] = useState(null);

  useEffect(() => {
    const proximo = () => setAtual((agora) => agora || fila.shift() || null);
    avisarHost = proximo;
    proximo();
    return () => { avisarHost = null; };
  }, []);

  function fechar(botao) {
    setAtual(fila.shift() || null);
    // Depois de fechar, como no celular: a ação pode abrir outro alerta.
    if (botao?.onPress) setTimeout(() => botao.onPress(), 0);
  }

  function cancelar() {
    if (!atual) return;
    const botaoCancelar = atual.botoes.find((b) => b.style === 'cancel');
    if (botaoCancelar) return fechar(botaoCancelar);
    if (atual.botoes.length === 1) return fechar(atual.botoes[0]);
    if (atual.opcoes.cancelable) {
      setAtual(fila.shift() || null);
      atual.opcoes.onDismiss?.();
    }
  }

  // Esc cancela, Enter confirma o último botão (o principal).
  useEffect(() => {
    if (!atual || typeof document === 'undefined') return undefined;
    const tecla = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancelar(); }
      if (e.key === 'Enter') { e.preventDefault(); fechar(atual.botoes[atual.botoes.length - 1]); }
    };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  });

  if (!atual) return null;
  const empilhar = atual.botoes.length > 2;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={cancelar}>
      <Pressable style={s.fundo} onPress={cancelar}>
        <Pressable style={s.caixa} onPress={() => {}}>
          {!!atual.titulo && <Text style={s.titulo}>{atual.titulo}</Text>}
          {!!atual.mensagem && <Text style={s.mensagem}>{atual.mensagem}</Text>}
          <View style={[s.botoes, empilhar && s.botoesEmpilhados]}>
            {atual.botoes.map((b, i) => {
              const principal = i === atual.botoes.length - 1 && b.style !== 'cancel';
              const destrutivo = b.style === 'destructive';
              return (
                <Pressable
                  key={`${i}-${b.text}`}
                  onPress={() => fechar(b)}
                  style={({ hovered }) => [
                    s.botao,
                    principal && s.botaoPrincipal,
                    principal && destrutivo && s.botaoDestrutivo,
                    hovered && s.botaoHover,
                  ]}
                >
                  <Text
                    style={[
                      s.textoBotao,
                      principal && s.textoPrincipal,
                      !principal && destrutivo && { color: semantica.erro.tinta },
                    ]}
                  >
                    {b.text}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  fundo: {
    flex: 1,
    backgroundColor: 'rgba(48,44,40,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  caixa: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: papel.puro,
    borderRadius: 16,
    padding: 24,
    ...sombra.e3,
  },
  titulo: { fontSize: 18, fontWeight: '600', color: tinta.t900, marginBottom: 8 },
  mensagem: { fontSize: 15, lineHeight: 22, color: tinta.t700 },
  botoes: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 20 },
  botoesEmpilhados: { flexDirection: 'column-reverse', alignItems: 'stretch' },
  botao: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, alignItems: 'center' },
  botaoPrincipal: { backgroundColor: salvia.tinta },
  botaoDestrutivo: { backgroundColor: semantica.erro.tinta },
  botaoHover: { opacity: 0.85 },
  textoBotao: { fontSize: 15, fontWeight: '600', color: salvia.tinta },
  textoPrincipal: { color: papel.puro },
});
