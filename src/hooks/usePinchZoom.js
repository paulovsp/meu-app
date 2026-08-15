// ─── Zoom por pinça (2 dedos) ───────────────────────────────────────────
// Mesmo padrão do useSwipeHorizontal: a escala acompanha o gesto ao vivo
// via Animated.Value (sem re-render a cada frame do pinch) e só "assenta"
// num número real de state ao soltar os dedos — daí sim quem usa o hook
// recalcula tamanhos com precisão (texto nítido, sem ficar esticado pela
// transformação usada só durante o gesto).
import { useRef, useState } from 'react';
import { Animated, PanResponder } from 'react-native';

function distanciaEntreToques(touches) {
  const [a, b] = touches;
  const dx = a.pageX - b.pageX;
  const dy = a.pageY - b.pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

export function usePinchZoom({ min = 0.6, max = 2.2, inicial = 1 } = {}) {
  const [escala, setEscala] = useState(inicial);
  const escalaRef = useRef(inicial);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const distanciaInicialRef = useRef(null);

  const panResponder = useRef(
    PanResponder.create({
      // Só captura quando o gesto já chega (ou passa a ter) 2 dedos — um
      // toque/arraste de 1 dedo continua livre pro PanResponder de swipe,
      // pro ScrollView vertical de cada coluna e pro toque nos horários.
      onStartShouldSetPanResponderCapture: (evt) => evt.nativeEvent.touches.length === 2,
      onMoveShouldSetPanResponderCapture: (evt) => evt.nativeEvent.touches.length === 2,
      onPanResponderGrant: (evt) => {
        if (evt.nativeEvent.touches.length === 2) {
          distanciaInicialRef.current = distanciaEntreToques(evt.nativeEvent.touches);
        }
      },
      onPanResponderMove: (evt) => {
        if (evt.nativeEvent.touches.length !== 2 || !distanciaInicialRef.current) return;
        const atual = distanciaEntreToques(evt.nativeEvent.touches);
        const fatorBruto = atual / distanciaInicialRef.current;
        const alvo = Math.min(max, Math.max(min, escalaRef.current * fatorBruto));
        scaleAnim.setValue(alvo / escalaRef.current);
      },
      onPanResponderRelease: () => {
        const tinhaPinca = !!distanciaInicialRef.current;
        distanciaInicialRef.current = null;
        if (!tinhaPinca) return;
        scaleAnim.stopAnimation((fatorFinal) => {
          const nova = Math.min(max, Math.max(min, escalaRef.current * fatorFinal));
          escalaRef.current = nova;
          setEscala(nova);
          scaleAnim.setValue(1);
        });
      },
      onPanResponderTerminate: () => {
        distanciaInicialRef.current = null;
        scaleAnim.setValue(1);
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  return { escala, panHandlers: panResponder.panHandlers, scaleAnim };
}
