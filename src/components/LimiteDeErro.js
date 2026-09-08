// A rede embaixo do trapézio.
//
// Um erro durante o render derruba a árvore inteira do React. Sem um limite
// como este, o resultado é uma tela branca: sem mensagem, sem botão, sem
// saída a não ser fechar e reabrir — e, se o erro voltar na mesma tela, nem
// isso resolve. Num app que a pessoa abre para começar uma sessão, isso é
// a diferença entre um tropeço e uma sessão perdida.
//
// Precisa ser componente de classe: `componentDidCatch` e
// `getDerivedStateFromError` não têm equivalente em hook. É o único da base.
//
// O erro também vai para o servidor (`erros_app`, migration 0081), porque o
// contrário de "tela branca" não é só avisar quem está usando — é alguém
// ficar sabendo. Só mensagem, pilha, tela e versão; nenhum dado clínico.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { papel, tinta, salvia, semantica } from '../theme';

export default class LimiteDeErro extends React.Component {
  constructor(props) {
    super(props);
    this.state = { erro: null };
  }

  static getDerivedStateFromError(erro) {
    return { erro };
  }

  componentDidCatch(erro, info) {
    // Nunca deixar o registro do erro virar um segundo erro: tudo aqui é
    // best-effort e silencioso em caso de falha.
    (async () => {
      try {
        const { supabase } = require('../services/supabase');
        const { data: { session } } = await supabase.auth.getSession();
        await supabase.from('erros_app').insert({
          user_id: session?.user?.id ?? null,
          mensagem: String(erro?.message || erro).slice(0, 500),
          pilha: String(erro?.stack || '').slice(0, 4000),
          tela: String(info?.componentStack || '').trim().split('\n')[0]?.slice(0, 200) || null,
          versao: String(Constants.expoConfig?.version || '') || null,
          plataforma: Platform.OS,
        });
      } catch (_) {}
    })();
  }

  tentarDeNovo = () => {
    this.setState({ erro: null });
  };

  render() {
    if (!this.state.erro) return this.props.children;

    return (
      <View style={s.fundo}>
        <ScrollView contentContainerStyle={s.conteudo}>
          <Text style={s.titulo}>Alguma coisa quebrou aqui</Text>
          <Text style={s.texto}>
            O Dr.Sig encontrou um erro inesperado e parou esta tela para não
            corromper nada. Nenhum dado seu foi perdido — tudo que já estava
            salvo continua salvo.
          </Text>
          <Text style={s.texto}>
            Já avisamos a equipe automaticamente. Tente de novo; se voltar a
            acontecer, feche e abra o app.
          </Text>

          <TouchableOpacity style={s.botao} onPress={this.tentarDeNovo}>
            <Text style={s.botaoTexto}>Tentar de novo</Text>
          </TouchableOpacity>

          {/* O detalhe técnico fica no fim, discreto e selecionável: serve
              pra pessoa copiar e mandar no suporte, não pra ser lido. */}
          <Text style={s.detalheRotulo}>Detalhe técnico</Text>
          <Text style={s.detalhe} selectable>
            {String(this.state.erro?.message || this.state.erro)}
          </Text>
        </ScrollView>
      </View>
    );
  }
}

const s = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: papel.base },
  conteudo: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  titulo: {
    fontSize: 22, fontWeight: '600', color: tinta.t900, lineHeight: 30,
    marginBottom: 14, letterSpacing: -0.4,
  },
  texto: { fontSize: 15, color: tinta.t700, lineHeight: 23, marginBottom: 12 },
  botao: {
    marginTop: 16, backgroundColor: salvia.tinta, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center',
  },
  botaoTexto: { color: '#FFFFFF', fontWeight: '500', fontSize: 15.5, lineHeight: 22 },
  detalheRotulo: {
    fontSize: 11, fontWeight: '500', letterSpacing: 1.5, textTransform: 'uppercase',
    color: tinta.t400, lineHeight: 14, marginTop: 34, marginBottom: 6,
  },
  detalhe: {
    fontSize: 12, color: semantica.erro.tinta, lineHeight: 18,
    backgroundColor: semantica.erro.veu, borderRadius: 9, padding: 11,
  },
});
