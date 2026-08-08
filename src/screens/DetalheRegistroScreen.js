import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Image,
  TouchableOpacity,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { useNavigation, useRoute } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { deleteRecord } from '../services/database';
import { mensagemDeErro } from '../services/erros';

// ⚠️ NOVO: Labels de autor
const AUTHOR_LABELS = {
  analyst:   { icon: '🧑‍⚕️', label: 'Analista',       color: '#4A90D9', bg: '#EBF3FB' },
  analysand: { icon: '🗣️', label: 'Analisante',     color: '#F57C00', bg: '#FFF8E1' },
  alternado: { icon: '🔄', label: 'Alternado (A:/P:)', color: '#7C3AED', bg: '#F0E8FF' },
};

export default function DetalheRegistroScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { record } = route.params;
  const { width } = useWindowDimensions();
  const [loading, setLoading] = useState(false);
  const [webViewHeight, setWebViewHeight] = useState(300);

  const authorInfo = AUTHOR_LABELS[record.author] || AUTHOR_LABELS.analyst;

  useEffect(() => {
    navigation.setOptions({
      title: record.title || 'Registro',
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 12, marginRight: 16 }}>
          <TouchableOpacity
            onPress={() => navigation.navigate('AddRecord', { record, patientId: record.patient_id })}
          >
            <Ionicons name="pencil-outline" size={22} color="#4A90D9" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDelete}>
            <Ionicons name="trash-outline" size={22} color="#e53e3e" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, []);

  const handleDelete = () => {
    Alert.alert('Excluir Registro', 'Tem certeza que deseja excluir este registro?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir', style: 'destructive',
        onPress: async () => {
          setLoading(true);
          try {
            await deleteRecord(record.id);
            navigation.goBack();
          } catch (e) {
            Alert.alert('Erro', mensagemDeErro(e, 'Não foi possível excluir o registro.'));
          } finally { setLoading(false); }
        },
      },
    ]);
  };

  const abrirArquivo = async (uri, mime, nome) => {
    try {
      const disponivel = await Sharing.isAvailableAsync();
      if (!disponivel) {
        Alert.alert('Indisponível', 'Não é possível abrir arquivos neste dispositivo.');
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: mime || '*/*', dialogTitle: nome || 'Arquivo' });
    } catch (e) {
      Alert.alert('Erro', 'Não foi possível abrir o arquivo.\n' + e.message);
    }
  };

  const injectedJS = `
    setTimeout(() => {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ height: document.body.scrollHeight })
      );
    }, 100);
  `;

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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6c63ff" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Cabeçalho */}
      <View style={styles.header}>
        <Text style={styles.title}>{record.title || 'Sem título'}</Text>
        <View style={styles.metaRow}>
          {renderTypeBadge()}
          {/* ⚠️ NOVO: Badge de autor */}
          <View style={[styles.badge, { backgroundColor: authorInfo.bg }]}>
            <Text style={[styles.badgeText, { color: authorInfo.color }]}>
              {authorInfo.icon} {authorInfo.label}
            </Text>
          </View>
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

      {/* Conteúdo HTML */}
      {record.content ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Conteúdo</Text>
          {/* ⚠️ NOVO: indicador visual quando conteúdo é alternado */}
          {record.author === 'alternado' && (
            <View style={styles.alternadoHint}>
              <Text style={styles.alternadoHintText}>
                🔄 Este registro contém falas alternadas entre analista (A:) e analisante (P:).
              </Text>
            </View>
          )}
          <View style={styles.webviewContainer}>
            <WebView
              originWhitelist={['*']}
              source={{
                html: `
                  <!DOCTYPE html>
                  <html>
                  <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
                    <style>
                      * { margin: 0; padding: 0; box-sizing: border-box; }
                      body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                        font-size: 16px;
                        color: #2d3748;
                        line-height: 1.65;
                        padding: 0;
                        word-wrap: break-word;
                        overflow-wrap: break-word;
                        -webkit-text-size-adjust: 100%;
                      }
                      p { margin-bottom: 10px; }
                      b, strong { font-weight: 700; }
                      i, em { font-style: italic; }
                      u { text-decoration: underline; }
                      ul, ol { padding-left: 24px; margin-bottom: 10px; }
                      li { margin-bottom: 4px; line-height: 1.5; }
                      br { line-height: 0.8; }
                      span { font-size: 16px; color: #2d3748; line-height: 1.65; }
                    </style>
                  </head>
                  <body>
                    ${record.content}
                  </body>
                  </html>
                `
              }}
              style={{ height: webViewHeight }}
              scrollEnabled={false}
              javaScriptEnabled={true}
              injectedJavaScript={injectedJS}
              onMessage={(event) => {
                try {
                  const data = JSON.parse(event.nativeEvent.data);
                  if (data.height && data.height > 0) setWebViewHeight(data.height);
                } catch (_) {}
              }}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </View>
      ) : null}

      {/* Imagem */}
      {record.file_uri && record.type === 'image' ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Imagem</Text>
          <Image source={{ uri: record.file_uri }} style={styles.image} resizeMode="contain" />
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
  metaRow:      { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  badge:        { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText:    { fontSize: 12, fontWeight: '600' },
  date:         { fontSize: 13, color: '#718096' },
  divider:      { height: 1, backgroundColor: '#e2e8f0', marginVertical: 16 },
  section:      { marginBottom: 24 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#a0aec0', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },

  // ⚠️ NOVO
  alternadoHint: {
    backgroundColor: '#F0E8FF', borderRadius: 8, padding: 10,
    borderLeftWidth: 3, borderLeftColor: '#7C3AED', marginBottom: 12,
  },
  alternadoHintText: { fontSize: 12, color: '#5B21B6', fontStyle: 'italic' },

  webviewContainer: {
    borderRadius: 12, overflow: 'hidden', backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  image:        { width: '100%', height: 300, borderRadius: 12, backgroundColor: '#e2e8f0', marginBottom: 12 },
  fileBox:      { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#ebf8ff', borderRadius: 10, padding: 14, marginBottom: 12 },
  fileUri:      { flex: 1, fontSize: 13, color: '#2b6cb0' },
  btnAbrir:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#3182ce', borderRadius: 10, padding: 14 },
  btnAbrirTxt:  { color: '#fff', fontWeight: '700', fontSize: 15 },
  emptyBox:     { alignItems: 'center', marginTop: 60, gap: 12 },
  emptyText:    { fontSize: 15, color: '#a0aec0' },
});