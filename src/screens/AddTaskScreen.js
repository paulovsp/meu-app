import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert
} from 'react-native';
import { addTask } from '../database/database';

export default function AddTaskScreen({ navigation }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const handleSave = () => {
    if (!title.trim()) {
      Alert.alert('Atenção', 'O título da tarefa é obrigatório!');
      return;
    }

    addTask(title.trim(), description.trim()); // sem callback
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Título *</Text>
      <TextInput
        style={styles.input}
        placeholder="Ex: Estudar React Native"
        value={title}
        onChangeText={setTitle}
      />

      <Text style={styles.label}>Descrição (opcional)</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Detalhes da tarefa..."
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={4}
      />

      <TouchableOpacity style={styles.button} onPress={handleSave}>
        <Text style={styles.buttonText}>💾 Salvar Tarefa</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  label: { fontSize: 15, fontWeight: 'bold', color: '#444', marginBottom: 6 },
  input: {
    backgroundColor: '#fff', borderRadius: 10, padding: 12,
    fontSize: 15, marginBottom: 16, elevation: 2, color: '#333'
  },
  textArea: { height: 100, textAlignVertical: 'top' },
  button: {
    backgroundColor: '#6200ee', borderRadius: 30, padding: 16,
    alignItems: 'center', marginTop: 10, elevation: 4
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});