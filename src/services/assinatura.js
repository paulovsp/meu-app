// Estado da assinatura — única fonte de verdade é a função SQL
// `assinatura_ativa` (ver migration 0025), consultada aqui via RPC. Nunca
// replica a regra (ativa/cortesia + ainda dentro da validade) em JS: se a
// regra mudar no banco, este arquivo não precisa mudar.
import { supabase } from './supabase';

// Texto único, usado em todo canto que precisa avisar a psicanalista sobre
// assinatura inativa (banner, telas de criação bloqueadas, erro do
// ia-busca) — política do Google Play proíbe qualquer link, preço ou
// instrução de pagamento nas telas do app; a ponte pro site é só o e-mail.
export const MENSAGEM_ASSINATURA_INATIVA =
  'Sua conta está sem assinatura ativa. Você continua com acesso a tudo que já ' +
  'registrou, e pode exportar seus dados quando quiser. Enviamos um e-mail com ' +
  'os próximos passos.';

export async function assinaturaEstaAtiva() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;
  const { data, error } = await supabase.rpc('assinatura_ativa', { uid: session.user.id });
  if (error) {
    console.error('Erro ao checar assinatura:', error.message);
    // Falha aberta: um erro de rede aqui não deve travar quem já está com
    // assinatura ativa — a RLS do banco é a checagem real e continua
    // valendo em qualquer tentativa de escrita, mesmo que este aviso falhe.
    return true;
  }
  return !!data;
}
