# PSICANÁLISE APP — STATUS DO PROJETO

## STACK TECNOLÓGICA
- React Native + Expo (Expo Go no celular)
- SQLite via expo-sqlite (openDatabaseSync)
- React Navigation: Bottom Tabs + Native Stack
- Editor: VS Code

## ESTRUTURA DE NAVEGAÇÃO ATUAL
- Stack principal: Main → NewSession, AddRecord, PatientForm
- Tabs: Início, Pacientes, Buscar

## TELAS EXISTENTES (arquivos criados)
- HomeScreen.js ✅ FUNCIONAL
- PatientsScreen.js ⚠️ BUG (item.nome deve ser item.name)
- PatientFormScreen.js ❌ TELA EM BRANCO — precisa ser construída
- NewSessionScreen.js ❌ TELA EM BRANCO — precisa ser construída
- AddRecordScreen.js ❌ TELA EM BRANCO — precisa ser construída
- SearchScreen.js ❌ TELA EM BRANCO — precisa ser construída

## BUG CRÍTICO IDENTIFICADO — PatientsScreen
- O banco salva coluna como `name` mas o código usa `item.nome`
- Afeta: avatar (charAt), cardName, cardSub, confirmarDelecao
- Correção: trocar TODAS ocorrências de item.nome por item.name

## BANCO DE DADOS (database.js) — COMPLETO E FUNCIONAL
Tabelas: patients, sessions, records
Funções prontas:
- listarPacientes, inserirPaciente, editarPaciente, deletarPaciente
- getSessions, addSession, updateSession, deleteSession
- getRecords, addRecord, deleteRecord
- searchTranscripts, searchRecords
ATENÇÃO: inserirPaciente recebe { nome, nascimento, data_inicio, telefone }
mas salva na coluna `name` — campo nome → coluna name

## NAVIGATION (AppNavigator.js) — FUNCIONAL
- PatientForm aceita params: { paciente } para edição ou vazio para novo

PSICOAPP — STATUS
✅ App.js — OK
✅ AppNavigator.js — OK (Stack: Main, NewSession, AddRecord, PatientForm)
✅ database.js — OK (patients usa coluna `name`, funções recebem `nome`)
✅ HomeScreen.js — OK
✅ PatientsScreen.js — CORRIGIDO (item.name, getParent navigation)
✅ PatientFormScreen.js — CONSTRUÍDO (cadastro + edição + máscaras)
❌ NewSessionScreen.js — TELA EM BRANCO
❌ AddRecordScreen.js — TELA EM BRANCO
❌ SearchScreen.js — TELA EM BRANCO

PRÓXIMO: construir NewSessionScreen
## COMO RETOMAR
Cole este arquivo e diga qual passo executar.