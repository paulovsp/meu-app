// ─── Contexto de autenticação ──────────────────────────────────────────
// Escuta mudanças de sessão do Supabase Auth (login, logout, expiração de
// token) e expõe pro resto do app — substitui o padrão antigo de
// LoginScreen checar getUser() uma vez só e navegar manualmente.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { sincronizarTokenBiometrico } from '../services/biometria';

const AuthContext = createContext({ session: null, loading: true, sairLocalmente: () => {} });

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  // "Sair da conta" não chama supabase.auth.signOut() — isso revogaria o
  // refresh token no servidor, inclusive o guardado pra biometria (igual
  // app de banco: sair da tela não é a mesma coisa que desconfiar do
  // aparelho). Em vez disso, só escondemos a sessão localmente; o token
  // continua válido pra o atalho de digital funcionar depois. Qualquer
  // evento de auth novo (login manual ou via digital) limpa esse estado.
  const [ocultarSessao, setOcultarSessao] = useState(false);

  useEffect(() => {
    // O `.catch` não é zelo: `setLoading(false)` só acontecia no caminho
    // feliz. Se a leitura da sessão falhasse — armazenamento corrompido,
    // erro do SecureStore, qualquer coisa —, `loading` ficava `true` pra
    // sempre e o app parava no spinner, sem tela de login e sem saída a não
    // ser reinstalar. Falhar aqui tem que significar "não há sessão", que é
    // recuperável: a pessoa entra de novo.
    supabase.auth.getSession()
      .then(({ data }) => {
        setSession(data.session);
        sincronizarTokenBiometrico(data.session);
      })
      .catch(() => setSession(null))
      .finally(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, novaSessao) => {
      setSession(novaSessao);
      setOcultarSessao(false);
      // O Supabase rotaciona o refresh token a cada renovação. Sem
      // reescrever o valor guardado, o atalho de digital passa a apontar
      // pra um token já invalidado, falha no login seguinte e se desativa
      // sozinho — era por isso que o botão "não segurava" ligado.
      sincronizarTokenBiometrico(novaSessao);
    });

    return () => subscription.unsubscribe();
  }, []);

  function sairLocalmente() {
    setOcultarSessao(true);
  }

  return (
    <AuthContext.Provider value={{ session: ocultarSessao ? null : session, loading, sairLocalmente }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
