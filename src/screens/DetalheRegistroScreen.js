import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, Image, TouchableOpacity, Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { useNavigation, useRoute } from '@react-navigation/native';
import { deleteRecord } from '../services/database';

export default function RecordDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { record } = route.params;
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      title: record.title || 'Registro',
      headerRight: () => (
        <TouchableOpacity onPress={handleDelete} style={{ marginRight: 16 }}>
          <Ionicons name="trash-outline" size={22} color="#e53e3e" />
        </TouchableOpacity>
      ),
    });
  }, []);

  const handleDelete = () => {
    Alert.alert(
      'Excluir Registro',
      'Tem certeza que deseja excluir este registro?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await deleteRecord(record.id);
              navigation.goBack();
            } catch (e) {
              Alert.alert('Erro', 'Não foi possível excluir o registro.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const abrirArquivo = async (uri, mime, nome) => {
    try {
      const disponivel = await Sharing.isAvailableAsync();
      if (!disponivel) {
        Alert.alert('Indisponível', 'Não é possível abrir arquivos neste dispositivo.');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: mime || '*/*',
        dialogTitle: nome || 'Arquivo',
      });
    } catch (e) {
      Alert.alert('Erro', 'Não foi possível abrir o arquivo.\n' + e.message);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6c63ff" />
      </View>
    );
  }

  const renderTypeBadge = () => {
    const tipos = {
      text:  { label: 'Texto',   icon: 'document-text-outline', color: '#6c63ff' },
      file:  { label: 'Arquivo', icon: 'attach-outline',        color: '#3182ce' },
      image: { label: 'Imagem',  icon: 'image-outline',         color: '#38a169' },
    };
    const tipo = tipos[record.type] || tipos.text;
    return (
      <View style={[styles.badge, { backgroundColor: tipo.color + '20' }]}>
        <Ionicons name={tipo.icon} size={14} color={tipo.color} />
        <Text style={[styles.badgeText, { color: tipo.color }]}>{tipo.label}</Text>
      </View>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Cabeçalho */}
      <View style={styles.header}>
        <Text style={styles.title}>{record.title || 'Sem título'}</Text>
        <View style={styles.metaRow}>
          {renderTypeBadge()}
          <Text style={styles.date}>
            {record.date
              ? new Date(record.date).toLocaleDateString('pt-BR', {
                  day: '2-digit', month: 'long', year: 'numeric',
                })
              : '—'}
          </Text>
        </View>
      </View>

      <View style={styles.divider} />

      {/* Conteúdo de texto */}
      {record.content ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Conteúdo</Text>
          <Text style={styles.contentText}>{record.content}</Text>
        </View>
      ) : null}

      {/* Imagem */}
      {record.file_uri && record.type === 'image' ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Imagem</Text>
          <Image
            source={{ uri: record.file_uri }}
            style={styles.image}
            resizeMode="contain"
          />
          <TouchableOpacity
            style={styles.btnAbrir}
            onPress={() => abrirArquivo(record.file_uri, 'image/jpeg', record.title)}
          >
            <Ionicons name="share-outline" size={18} color="#fff" />
            <Text style={styles.btnAbrirTxt}>Compartilhar imagem</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Arquivo */}
      {record.file_uri && record.type === 'file' ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Arquivo vinculado</Text>
          <View style={styles.fileBox}>
            <Ionicons name="document-attach-outline" size={24} color="#3182ce" />
            <Text style={styles.fileUri} numberOfLines={2}>{record.file_uri}</Text>
          </View>
          <TouchableOpacity
            style={styles.btnAbrir}
            onPress={() => abrirArquivo(record.file_uri, '*/*', record.title)}
          >
            <Ionicons name="open-outline" size={18} color="#fff" />
            <Text style={styles.btnAbrirTxt}>Abrir / Compartilhar arquivo</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Sem conteúdo */}
      {!record.content && !record.file_uri ? (
        <View style={styles.emptyBox}>
          <Ionicons name="archive-outline" size={48} color="#cbd5e0" />
          <Text style={styles.emptyText}>Nenhum conteúdo neste registro.</Text>
        </View>
      ) : null}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f7f8fc' },
  content:      { padding: 20, paddingBottom: 40 },
  centered:     { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header:       { marginBottom: 12 },
  title:        { fontSize: 22, fontWeight: '700', color: '#1a202c', marginBottom: 8 },
  metaRow:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge:        { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText:    { fontSize: 12, fontWeight: '600' },
  date:         { fontSize: 13, color: '#718096' },
  divider:      { height: 1, backgroundColor: '#e2e8f0', marginVertical: 16 },
  section:      { marginBottom: 24 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#a0aec0', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  contentText:  { fontSize: 16, color: '#2d3748', lineHeight: 26 },
  image:        { width: '100%', height: 300, borderRadius: 12, backgroundColor: '#e2e8f0', marginBottom: 12 },
  fileBox:      { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#ebf8ff', borderRadius: 10, padding: 14, marginBottom: 12 },
  fileUri:      { flex: 1, fontSize: 13, color: '#2b6cb0' },
  btnAbrir:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#3182ce', borderRadius: 10, padding: 14 },
  btnAbrirTxt:  { color: '#fff', fontWeight: '700', fontSize: 15 },
  emptyBox:     { alignItems: 'center', marginTop: 60, gap: 12 },
  emptyText:    { fontSize: 15, color: '#a0aec0' },
});