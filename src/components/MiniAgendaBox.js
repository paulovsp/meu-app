import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, AppState,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getPreviaDaAgenda } from '../services/agendaResumo';
import { papel, tinta, salvia } from '../theme';

const COLORS = {
  surface: papel.alto,
  moldura: salvia.tinta,
  molduraFina: salvia.suave,
  textDark: tinta.t900,
  textMid: tinta.t500,
};

/**
 * Prévia do dia (verde = livre, cor do tipo de evento = ocupado), numa
 * pilha vertical compacta. O widget INTEIRO é um botão só — os blocos de
 * horário aqui dentro são só visuais, nunca tocáveis individualmente: cada
 * bloco tem a mesma posição/formato de um botão real da Agenda, e deixar
 * cada um navegar por conta própria fazia o toque "coincidir" com a grade
 * de verdade da tela Agenda, abrindo direto o compromisso daquele horário
 * em vez de só levar pra Agenda — o widget é prévia, não uma réplica
 * interativa da Agenda. Tocar em qualquer lugar do card leva só pra Agenda.
 */
export default function MiniAgendaBox({ navigation, altura }) {
  const [previa, setPrevia] = useState(null);
  const [carregando, setCarregando] = useState(true);
  // Sem isso, um toque duplo (comum quando a pessoa não vê nenhum sinal de
  // que o primeiro toque "pegou") podia disparar navigation.navigate mais
  // de uma vez em sequência rápida, empilhando navegação por cima da
  // própria transição. Trava no primeiro toque; destrava quando a Início
  // ganha foco de novo.
  const navegandoRef = useRef(false);
  const viradaRef = useRef(null);
  const montadoRef = useRef(true);

  const carregar = useCallback(async () => {
    try {
      const p = await getPreviaDaAgenda(new Date());
      if (montadoRef.current) setPrevia(p);
    } catch (_) {
      if (montadoRef.current) setPrevia({ rotulo: 'Hoje', blocos: [] });
    } finally {
      if (montadoRef.current) setCarregando(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      montadoRef.current = true;
      navegandoRef.current = false;
      setCarregando(true);
      carregar();
      return () => { montadoRef.current = false; };
    }, [carregar])
  );

  // Duas coisas mantêm a prévia viva sem ficar consultando à toa:
  //
  // 1. Voltar do segundo plano. O celular passa a noite guardado; ao ser
  //    desbloqueado de manhã, o dia mudou e a prévia precisa mudar junto.
  //
  // 2. Um despertador para o instante EXATO da virada — uma hora depois do
  //    fim do último compromisso. Melhor que perguntar de minuto em minuto:
  //    dispara uma vez, na hora certa, e só se a tela estiver aberta.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') carregar();
    });
    return () => sub.remove();
  }, [carregar]);

  useEffect(() => {
    clearTimeout(viradaRef.current);
    const quando = previa?.viradaEm;
    if (!quando) return undefined;
    const faltam = new Date(quando).getTime() - Date.now();
    // `setTimeout` acima de ~24 dias estoura o limite de 32 bits e dispara
    // na hora; a virada é sempre no mesmo dia, mas o limite fica explícito.
    if (faltam <= 0 || faltam > 86400000) return undefined;
    viradaRef.current = setTimeout(carregar, faltam + 1000);
    return () => clearTimeout(viradaRef.current);
  }, [previa?.viradaEm, carregar]);

  const itens = previa?.blocos || [];
  const rotulo = previa?.rotulo || 'Hoje';

  function abrirAgenda() {
    if (navegandoRef.current) return;
    navegandoRef.current = true;
    navigation.navigate('Agenda');
  }

  return (
    // Moldura tripla: fina, grossa (3 dp ≈ 0,5 mm) e fina de novo. O card
    // inteiro é um único TouchableOpacity — ver comentário acima.
    <TouchableOpacity style={s.molduraExterna} activeOpacity={0.85} onPress={abrirAgenda}>
      <View style={s.molduraCentral}>
        <View style={s.molduraInterna}>
          <View style={[s.caixa, altura ? { height: altura } : null]}>
            <View style={s.header}>
              <Ionicons name="calendar-outline" size={16} color={salvia.tinta} />
              <Text style={s.titulo} numberOfLines={1}>Agenda</Text>
              {/* O dia mostrado nem sempre é hoje — depois do último
                  compromisso a prévia salta pro próximo dia com algo. Sem
                  dizer qual é, a informação vira adivinhação. */}
              {!carregando && <Text style={s.rotuloDia} numberOfLines={1}>{rotulo}</Text>}
              {carregando && (
                <ActivityIndicator size="small" color={salvia.tinta} style={s.spinner} />
              )}
            </View>

            {carregando && itens.length === 0 ? null : itens.length === 0 ? (
              <Text style={s.vazio}>Nada marcado nas próximas semanas</Text>
            ) : (
              // Barras finas, uma abaixo da outra, dividindo a altura
              // disponível — todas cabem sem rolar, com qualquer quantidade
              // de horários do dia. A cor original do tipo (tiposEvento.js)
              // vive na borda; o preenchimento fica em papel, senão o widget
              // inteiro vira um bloco de cor. Puramente visual — sem onPress.
              <View style={s.pilha}>
                {itens.map((item) => (
                  <View key={item.key} style={[s.slotExterno, { borderColor: item.cor + '44' }]}>
                    <View style={[s.slotCentral, { borderColor: item.cor }]}>
                      <View style={[s.slotInterno, { borderColor: item.cor + '44' }]}>
                        <Text style={s.slotHora} numberOfLines={1}>{item.startTime?.slice(0, 5)}</Text>
                        <Text style={s.slotNome} numberOfLines={1}>{item.nome}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  molduraExterna: {
    flex: 1,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: COLORS.molduraFina,
    padding: 2,
    backgroundColor: COLORS.surface,
    shadowColor: '#4E4941',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 3,
  },
  molduraCentral: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: COLORS.moldura,
    padding: 2,
  },
  molduraInterna: {
    flex: 1,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: COLORS.molduraFina,
    overflow: 'hidden',
  },
  caixa: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    // altura fixa (não só mínimo) + corte — a Início não rola, então o
    // widget nunca pode crescer além do espaço reservado.
    overflow: 'hidden',
    minHeight: 150,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  rotuloDia: {
    fontSize: 11.5, fontWeight: '600', color: tinta.t500, lineHeight: 15,
    marginLeft: 'auto', letterSpacing: 0.2,
  },
  titulo: { fontSize: 13.5, fontWeight: '500', color: COLORS.textDark, lineHeight: 18 },
  spinner: { marginLeft: 'auto' },
  vazio: { fontSize: 13, color: COLORS.textMid, fontStyle: 'italic', lineHeight: 19 },

  pilha: { flex: 1, gap: 5 },
  slotExterno: {
    flex: 1,
    minHeight: 19,
    maxHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    padding: 1,
  },
  slotCentral: { flex: 1, borderRadius: 6, borderWidth: 2, padding: 1 },
  slotInterno: {
    flex: 1,
    borderRadius: 3,
    borderWidth: 1,
    backgroundColor: papel.alto,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 5,
    overflow: 'hidden',
  },
  slotHora: { fontSize: 10.5, fontWeight: '500', color: tinta.t900, lineHeight: 14 },
  slotNome: { flex: 1, fontSize: 10, color: tinta.t500, lineHeight: 13 },
});
