// Versão de computador do quadro de assinatura: um <canvas> simples, que
// aceita mouse, caneta e toque. Mesmo contrato do componente do celular
// (ver QuadroAssinatura.js) para a AssinaturaScreen não precisar mudar.
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';
import { tinta } from '../theme';

const QuadroAssinatura = forwardRef(function QuadroAssinatura({ onOK, onEmpty }, ref) {
  const canvasRef = useRef(null);
  const caixaRef = useRef(null);
  const desenhou = useRef(false);
  const ultimo = useRef(null);

  // Ajusta o tamanho real do canvas à caixa (e à nitidez da tela).
  useEffect(() => {
    const canvas = canvasRef.current;
    const caixa = caixaRef.current;
    if (!canvas || !caixa) return undefined;
    const ajustar = () => {
      const escala = window.devicePixelRatio || 1;
      const { width, height } = caixa.getBoundingClientRect();
      const copia = desenhou.current ? canvas.toDataURL() : null;
      canvas.width = Math.max(1, Math.round(width * escala));
      canvas.height = Math.max(1, Math.round(height * escala));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(escala, 0, 0, escala, 0, 0);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = tinta.t900;
      if (copia) {
        const img = new window.Image();
        img.onload = () => ctx.drawImage(img, 0, 0, width, height);
        img.src = copia;
      }
    };
    ajustar();
    const observador = new ResizeObserver(ajustar);
    observador.observe(caixa);
    return () => observador.disconnect();
  }, []);

  function ponto(e) {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function comecar(e) {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    ultimo.current = ponto(e);
  }

  function mover(e) {
    if (!ultimo.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const p = ponto(e);
    ctx.beginPath();
    ctx.moveTo(ultimo.current.x, ultimo.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ultimo.current = p;
    desenhou.current = true;
  }

  function parar() { ultimo.current = null; }

  useImperativeHandle(ref, () => ({
    clearSignature() {
      const canvas = canvasRef.current;
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      desenhou.current = false;
    },
    readSignature() {
      if (!desenhou.current) { onEmpty?.(); return; }
      onOK?.(canvasRef.current.toDataURL('image/png'));
    },
  }));

  return (
    <View style={{ flex: 1 }}>
      <div ref={caixaRef} style={{ width: '100%', height: '100%', minHeight: 220 }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={comecar}
          onPointerMove={mover}
          onPointerUp={parar}
          onPointerLeave={parar}
          onPointerCancel={parar}
        />
      </div>
    </View>
  );
});

export default QuadroAssinatura;
