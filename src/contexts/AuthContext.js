// ─── Contexto de autenticação ──────────────────────────────────────────
// Escuta mudanças de sessão do Supabase Auth (login, logout, expiração de
// token) e expõe pro resto do app — substitui o padrão antigo de
// LoginScreen checar getUser() uma vez só e navegar manualmente.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

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
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, novaSessao) => {
      setSession(novaSessao);
      setOcultarSessao(false);
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
