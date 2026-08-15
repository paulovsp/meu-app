import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Alert, Dimensions, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { excluirConta } from '../services/conta';
import { mensagemDeErro } from '../services/erros';
import { useAuth } from '../contexts/AuthContext';
import { desativarLoginBiometrico } from '../services/biometria';

const { width: SW } = Dimensions.get('window');
const PANEL_W = Math.round(SW * 0.78);

export default function MenuLateral({ visible, onClose, navigation, clinicaButtons, adminButtons, contextual }) {
  const { sairLocalmente } = useAuth();
  const [excluindo, setExcluindo] = useState(false);

  function irPara(screen) {
    onClose();
    navigation.navigate(screen);
  }

  function executarContextual(onPress) {
    onClose();
    onPress();
  }

  function sair() {
    Alert.alert('Sair', 'Tem certeza que deseja sair da sua conta?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: () => {
          onClose();
          sairLocalmente();
        },
      },
    ]);
  }

  function excluirContaHandler() {
    Alert.alert(
      'Excluir conta permanentemente',
      'Isso apaga sua conta e TODOS os dados ligados a ela — analisantes, sessões, registros, agenda, financeiro e relatórios. Não tem como desfazer. Confirma?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir permanentemente',
          style: 'destructive',
          onPress: async () => {
            // Não fecha o menu aqui — a exclusão é destrutiva e demorada
            // (3 chamadas em sequência); fechar antes escondia qualquer
            // feedback de que algo estava acontecendo. Em caso de sucesso o
            // signOut troca a stack de navegação sozinho, então não precisa
            // de onClose(); em caso de erro o menu segue aberto pra tentar de novo.
            setExcluindo(true);
            try {
              await excluirConta();
              await desativarLoginBiometrico();
              await supabase.auth.signOut();
            } catch (e) {
              setExcluindo(false);
              Alert.alert('Erro ao excluir conta', mensagemDeErro(e));
            }
          },
        },
      ]
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />

        <View style={s.painel}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.painelConteudo}>
            <Text style={s.titulo}>Dr.Sig</Text>

            {contextual?.itens?.length > 0 && (
              <>
                <Text style={s.secaoLabel}>{contextual.titulo || 'Nesta tela'}</Text>
                {contextual.itens.map((item, i) => (
                  <TouchableOpacity key={i} style={s.item} onPress={() => executarContextual(item.onPress)}>
                    <Ionicons name={item.icon || 'ellipse-outline'} size={20} color="#3D5A80" />
                    <Text style={s.itemTexto}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
                <View style={s.divisoria} />
              </>
            )}

            <Text style={s.secaoLabel}>Clínica</Text>
            {clinicaButtons.map((btn) => (
              <TouchableOpacity key={btn.id} style={s.item} onPress={() => irPara(btn.screen)}>
                <Ionicons name={btn.icon} size={20} color="#3D5A80" />
                <Text style={s.itemTexto}>{btn.label}</Text>
              </TouchableOpacity>
            ))}

            <View style={s.divisoria} />

            <Text style={s.secaoLabel}>Administrativo</Text>
            {adminButtons.map((btn) => (
              <TouchableOpacity key={btn.id} style={s.item} onPress={() => irPara(btn.screen)}>
                <Ionicons name={btn.icon} size={20} color="#3D5A80" />
                <Text style={s.itemTexto}>{btn.label}</Text>
              </TouchableOpacity>
            ))}

            <View style={s.divisoria} />

            <TouchableOpacity style={s.item} onPress={() => irPara('UserProfile')}>
              <Ionicons name="person-circle-outline" size={20} color="#3D5A80" />
              <Text style={s.itemTexto}>Meu Perfil</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.itemSair} onPress={sair}>
              <Ionicons name="log-out-outline" size={20} color="#C0392B" />
              <Text style={s.itemSairTexto}>Sair da conta</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.itemSair} onPress={excluirContaHandler} disabled={excluindo}>
              {excluindo ? (
                <>
                  <ActivityIndicator size="small" color="#C0392B" />
                  <Text style={s.itemSairTexto}>Excluindo conta...</Text>
                </>
              ) : (
                <>
                  <Ionicons name="trash-outline" size={20} color="#C0392B" />
                  <Text style={s.itemSairTexto}>Excluir minha conta</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, flexDirection: 'row' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  painel: {
    position: 'absolute', top: 0, bottom: 0, left: 0, width: PANEL_W,
    backgroundColor: '#fff',
    elevation: 12, shadowColor: '#000', shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.2, shadowRadius: 10,
  },
  painelConteudo: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 40 },
  titulo: {
    fontSize: 26, fontWeight: '700', fontStyle: 'italic', color: '#3D5A80',
    marginBottom: 24,
  },
  secaoLabel: {
    fontSize: 12, fontWeight: '700', color: '#888', textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: 8,
  },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12,
  },
  itemTexto: { fontSize: 15, fontWeight: '600', color: '#1A1A2E' },
  divisoria: { height: 1, backgroundColor: '#E0E4EA', marginVertical: 16 },
  itemSair: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, marginTop: 8,
  },
  itemSairTexto: { fontSize: 15, fontWeight: '700', color: '#C0392B' },
});
