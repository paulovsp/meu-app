// ─── Deslize horizontal com acompanhamento ao vivo do dedo ─────────────
// Diferente de um swipe que só reage na soltura do toque, aqui o conteúdo
// se move JUNTO com o dedo durante o arraste (onPanResponderMove atualiza a
// posição a cada frame) — e só ao soltar é que decide: se passou do
// limiar, termina de deslizar pra fora e chama onSwipeLeft/onSwipeRight
// (quem usa decide o que muda — dia, período, modo etc.); se não passou,
// volta com uma mola pro lugar. Usado por Início, Agenda e Financeiro pra
// dar a mesma sensação de swipe nativo em vários lugares.
import { useRef, useEffect } from 'react';
import { Animated, PanResponder, Dimensions } from 'react-native';

const { width: SW } = Dimensions.get('window');
const LIMIAR_PADRAO = 45;

export function useSwipeHorizontal({
  onSwipeLeft, onSwipeRight, limiar = LIMIAR_PADRAO, ativo = true,
  // Quando existe um número fixo de telas (ex: Início tem Início ⇄ Clínica
  // ⇄ Administrativa), passar podeEsquerda/podeDireita = false no limite
  // evita reabrir a mesma tela como se houvesse mais uma — em vez do
  // slide completo, o dedo sente resistência (arraste amortecido) e solta
  // com uma mola de volta, sem chamar onSwipeLeft/onSwipeRight.
  podeEsquerda = true, podeDireita = true,
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  // O PanResponder abaixo é criado UMA vez (useRef só usa o valor inicial
  // do argumento — reavaliações em renders seguintes são descartadas). Sem
  // isso, os callbacks internos (onPanResponderMove/Release) ficariam
  // presos aos valores de onSwipeLeft/onSwipeRight/podeEsquerda/podeDireita
  // do primeiro render pra sempre — quem muda de tela mais de uma vez (ex:
  // 3 modos em sequência, não só 2) veria o limite errado ou o callback
  // errado disparando. As refs abaixo são atualizadas a cada render e lidas
  // dentro do closure congelado, então o closure sempre enxerga o valor
  // atual na hora que o gesto realmente acontece.
  const onSwipeLeftRef = useRef(onSwipeLeft);
  const onSwipeRightRef = useRef(onSwipeRight);
  const podeEsquerdaRef = useRef(podeEsquerda);
  const podeDireitaRef = useRef(podeDireita);
  const limiarRef = useRef(limiar);
  const ativoRef = useRef(ativo);
  useEffect(() => { onSwipeLeftRef.current = onSwipeLeft; }, [onSwipeLeft]);
  useEffect(() => { onSwipeRightRef.current = onSwipeRight; }, [onSwipeRight]);
  useEffect(() => { podeEsquerdaRef.current = podeEsquerda; }, [podeEsquerda]);
  useEffect(() => { podeDireitaRef.current = podeDireita; }, [podeDireita]);
  useEffect(() => { limiarRef.current = limiar; }, [limiar]);
  useEffect(() => { ativoRef.current = ativo; }, [ativo]);

  // Chamada tanto ao terminar um swipe quanto ao trocar de modo por toque
  // num botão (sem gesto nenhum) — sempre a mesma sensação de entrada.
  function entrarDe(origemPx) {
    translateX.setValue(origemPx);
    opacity.setValue(0.4);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 10, tension: 60 }),
    ]).start();
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: (_evt, gestureState) => {
        if (!ativoRef.current) return false;
        return (
          Math.abs(gestureState.dx) > 18 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5
        );
      },
      onPanResponderMove: (_evt, gestureState) => {
        const noLimite = (gestureState.dx < 0 && !podeEsquerdaRef.current) || (gestureState.dx > 0 && !podeDireitaRef.current);
        translateX.setValue(noLimite ? gestureState.dx * 0.3 : gestureState.dx);
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const indoEsquerda = gestureState.dx <= -limiarRef.current && podeEsquerdaRef.current;
        const indoDireita = gestureState.dx >= limiarRef.current && podeDireitaRef.current;

        if (indoEsquerda || indoDireita) {
          const saidaPx = indoEsquerda ? -SW : SW;
          Animated.timing(translateX, {
            toValue: saidaPx,
            duration: 160,
            useNativeDriver: true,
          }).start(() => {
            if (indoEsquerda) onSwipeLeftRef.current?.();
            else onSwipeRightRef.current?.();
            entrarDe(indoEsquerda ? SW * 0.5 : -SW * 0.5);
          });
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 9 }).start();
        }
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  return {
    panHandlers: panResponder.panHandlers,
    animatedStyle: { opacity, transform: [{ translateX }] },
    entrarDe,
  };
}
