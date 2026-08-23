import React, { useState } from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import CabecalhoTela from '../components/CabecalhoTela';

// ⚠️ NOVO: Labels de autor
const AUTHOR_LABELS = {
  analyst:   { icon: 'medkit-outline',        label: 'Analista',       color: '#4D6B88', bg: '#E3EAF1' },
  analysand: { icon: 'chatbubble-outline',    label: 'Analisante',     color: '#7D6540', bg: '#F2E9DC' },
  alternado: { icon: 'swap-horizontal-outline', label: 'Alternado (A:/P:)', color: '#675A9A', bg: '#E2DFEF' },
};

export default function DetalheRegistroScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const { record } = route.params;
  const { width } = useWindowDimensions();
  const [loading, setLoading] = useState(false);
  const [webViewHeight, setWebViewHeight] = useState(300);

  const authorInfo = AUTHOR_LABELS[record.author] || AUTHOR_LABELS.analyst;

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

  // Registros criados antes da correção do editor (NovoRegistroScreen.js)
  // ainda têm marcação markdown solta (**negrito**, _itálico_, __sublinhado__,
  // ~~tachado~~) salva como texto literal — sem essa conversão apareceriam os
  // asteriscos/underscores crus na tela. Registros novos já vêm com tags HTML
  // reais e passam por aqui sem sofrer nenhuma mudança.
  const conteudoHtml = (record.content || '')
    .replace(/~~([\s\S]+?)~~/g, '<s>$1</s>')
    .replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>')
    .replace(/__([\s\S]+?)__/g, '<u>$1</u>')
    .replace(/_([\s\S]+?)_/g, '<i>$1</i>');

  const injectedJS = `
    setTimeout(() => {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ height: document.body.scrollHeight })
      );
    }, 100);
  `;

  const renderTypeBadge = () => {
    const tipos = {
      text:  { label: 'Texto',   icon: 'document-text-outline', color: '#497363' },
      file:  { label: 'Arquivo', icon: 'attach-outline',        color: '#497363' },
      image: { label: 'Imagem',  icon: 'image-outline',         color: '#44745B' },
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
        <ActivityIndicator size="large" color="#497363" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <CabecalhoTela
        titulo={record.title || 'Registro'}
        onVoltar={() => navigation.goBack()}
        acoes={(
          <>
            <TouchableOpacity
              style={styles.headerAcaoBtn}
              onPress={() => navigation.navigate('AddRecord', { record, patientId: record.patient_id })}
            >
              <Ionicons name="pencil-outline" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerAcaoBtn} onPress={handleDelete}>
              <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </>
        )}
      />
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
      {/* Cabeçalho */}
      <View style={styles.header}>
        <Text style={styles.title}>{record.title || 'Sem título'}</Text>
        <View style={styles.metaRow}>
          {renderTypeBadge()}
          {/* ⚠️ NOVO: Badge de autor */}
          <View style={[styles.badge, { backgroundColor: authorInfo.bg }]}>
            <Text style={[styles.badgeText, { color: authorInfo.color }]}>
              <Ionicons name={authorInfo.icon} size={11} color={authorInfo.color} />{' '}{authorInfo.label}
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
Este registro contém falas alternadas entre analista (A:) e analisante (P:).
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
                        color: #302C28;
                        line-height: 1.65;
                        padding: 0;
                        word-wrap: break-word;
                        overflow-wrap: break-word;
                        white-space: pre-wrap;
                        -webkit-text-size-adjust: 100%;
                      }
                      p { margin-bottom: 10px; }
                      b, strong { font-weight: 700; }
                      i, em { font-style: italic; }
                      u { text-decoration: underline; }
                      s, strike { text-decoration: line-through; }
                      ul, ol { padding-left: 24px; margin-bottom: 10px; }
                      li { margin-bottom: 4px; line-height: 1.5; }
                      br { line-height: 0.8; }
                      span { font-size: 16px; color: #302C28; line-height: 1.65; }
                    </style>
                  </head>
                  <body>
                    ${conteudoHtml}
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
            <Ionicons name="document-attach-outline" size={24} color="#497363" />
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
          <Ionicons name="archive-outline" size={48} color="#DDD6CA" />
          <Text style={styles.emptyText}>Nenhum conteúdo neste registro.</Text>
        </View>
      ) : null}
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F7F5F0' },
  content:      { padding: 20, paddingBottom: 40 },
  centered:     { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerAcaoBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  header:       { marginBottom: 12 },
  title:        { fontSize: 22, fontWeight: '500', color: '#302C28', marginBottom: 8 },
  metaRow:      { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  badge:        { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 12, fontWeight: '600', lineHeight: 17 },
  date: { fontSize: 13, color: '#756E66', lineHeight: 19 },
  divider:      { height: 1, backgroundColor: '#EAE5DC', marginVertical: 16 },
  section:      { marginBottom: 24 },
  sectionLabel: { fontSize: 12, fontWeight: '500', color: '#8C857B', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, lineHeight: 17 },

  // ⚠️ NOVO
  alternadoHint: {
    backgroundColor: '#E2DFEF', borderRadius: 8, padding: 10,
    borderLeftWidth: 3, borderLeftColor: '#675A9A', marginBottom: 12,
  },
  alternadoHintText: { fontSize: 12, color: '#675A9A', fontStyle: 'italic', lineHeight: 17 },

  webviewContainer: {
    borderRadius: 12, overflow: 'hidden', backgroundColor: '#FDFCFA',
    borderWidth: 1, borderColor: '#EAE5DC',
  },
  image:        { width: '100%', height: 300, borderRadius: 12, backgroundColor: '#EAE5DC', marginBottom: 12 },
  fileBox:      { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#E3EAF1', borderRadius: 10, padding: 14, marginBottom: 12 },
  fileUri: { flex: 1, fontSize: 13, color: '#497363', lineHeight: 19 },
  btnAbrir:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#497363', borderRadius: 10, padding: 14 },
  btnAbrirTxt: { color: '#fff', fontWeight: '500', fontSize: 15, lineHeight: 22 },
  emptyBox:     { alignItems: 'center', marginTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: '#8C857B', lineHeight: 22 },
});