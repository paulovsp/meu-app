// ─── Client do Supabase ────────────────────────────────────────────────
// Backend real (Postgres + Auth + RLS). `persistSession: false` de
// propósito — dado clínico sensível, o app deve sempre pedir login de novo
// quando reaberto depois de fechado de verdade (não persiste a sessão em
// disco). Continua ativa normalmente enquanto o app só vai pra segundo
// plano sem ser encerrado pelo sistema/usuário.
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
// Exportada porque o envio de áudio pra transcrição não passa pelo client do
// Supabase: sobe o arquivo direto por FileSystem.uploadAsync (streaming), e
// aí os cabeçalhos de autenticação precisam ser montados na mão. Ver
// src/services/gravacaoEmBlocos.js.
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: false,
    detectSessionInUrl: false,
  },
});
