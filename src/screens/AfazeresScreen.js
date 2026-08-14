import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { listarAfazeres, adicionarAfazer, alternarAfazer, removerAfazer } from '../services/afazeres';
import { mensagemDeErro } from '../services/erros';

const COLORS = {
  bg: '#F7F6F3',
  surface: '#FFFFFF',
  border: '#E8E4DD',
  textDark: '#1C1C1E',
  textMid: '#6B6860',
  btnBlue: '#3D5A80',
};

export default function AfazeresScreen() {
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [texto, setTexto] = useState('');
  const [adicionando, setAdicionando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setItens(await listarAfazeres());
    } catch (err) {
      Alert.alert('Erro', mensagemDeErro(err));
    } finally {
      setCarregando(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  async function handleAdicionar() {
    if (!texto.trim()) return;
    setAdicionando(true);
    try {
      const novo = await adicionarAfazer(texto);
      setItens((atual) => [novo, ...atual]);
      setTexto('');
    } catch (err) {
      Alert.alert('Erro ao adicionar', mensagemDeErro(err));
    } finally {
      setAdicionando(false);
    }
  }

  async function handleAlternar(item) {
    const novoValor = !item.concluido;
    setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, concluido: novoValor } : i)));
    try {
      await alternarAfazer(item.id, novoValor);
    } catch (err) {
      setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, concluido: !novoValor } : i)));
      Alert.alert('Erro', mensagemDeErro(err));
    }
  }

  function handleRemover(item) {
    Alert.alert('Remover afazer', `Remover "${item.texto}" da lista?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          setItens((atual) => atual.filter((i) => i.id !== item.id));
          try {
            await removerAfazer(item.id);
          } catch (err) {
            Alert.alert('Erro', mensagemDeErro(err));
            carregar();
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {carregando ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={COLORS.btnBlue} />
          </View>
        ) : (
          <FlatList
            data={itens}
            keyExtractor={(item) => item.id}
            contentContainerStyle={s.lista}
            ListEmptyComponent={
              <Text style={s.vazio}>Nenhum afazer ainda. Adicione o primeiro abaixo.</Text>
            }
            renderItem={({ item }) => (
              <View style={s.linha}>
                <TouchableOpacity style={s.checkWrap} onPress={() => handleAlternar(item)}>
                  <Ionicons
                    name={item.concluido ? 'checkmark-circle' : 'ellipse-outline'}
                    size={24}
                    color={item.concluido ? COLORS.btnBlue : COLORS.textMid}
                  />
                </TouchableOpacity>
                <Text style={[s.texto, item.concluido && s.textoConcluido]}>{item.texto}</Text>
                <TouchableOpacity style={s.removerBtn} onPress={() => handleRemover(item)}>
                  <Ionicons name="trash-outline" size={18} color={COLORS.textMid} />
                </TouchableOpacity>
              </View>
            )}
          />
        )}

        <View style={s.addBar}>
          <TextInput
            style={s.addInput}
            value={texto}
            onChangeText={setTexto}
            placeholder="Novo afazer..."
            placeholderTextColor="#B0ADA6"
            onSubmitEditing={handleAdicionar}
            returnKeyType="done"
          />
          <TouchableOpacity
            style={[s.addBtn, (!texto.trim() || adicionando) && { opacity: 0.5 }]}
            onPress={handleAdicionar}
            disabled={!texto.trim() || adicionando}
          >
            {adicionando ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Ionicons name="add" size={24} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  lista: { padding: 16, paddingBottom: 8 },
  vazio: { textAlign: 'center', color: COLORS.textMid, fontSize: 14, marginTop: 40 },
  linha: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  checkWrap: { padding: 2 },
  texto: { flex: 1, fontSize: 15, color: COLORS.textDark },
  textoConcluido: { color: COLORS.textMid, textDecorationLine: 'line-through' },
  removerBtn: { padding: 4 },
  addBar: {
    flexDirection: 'row', gap: 10, padding: 16,
    borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  addInput: {
    flex: 1, backgroundColor: COLORS.bg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: COLORS.textDark, borderWidth: 1, borderColor: COLORS.border,
  },
  addBtn: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: COLORS.btnBlue,
    alignItems: 'center', justifyContent: 'center',
  },
});
