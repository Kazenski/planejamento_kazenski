import { supabase } from './supabase.js';
import { DRIVE_SCOPE, SCOPES_LOGIN } from './config.js';

function urlRetorno() {
  return location.origin + location.pathname;
}

export async function getSessao() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function aoMudarSessao(callback) {
  supabase.auth.onAuthStateChange((_evento, sessao) => callback(sessao));
}

export function entrarComGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: urlRetorno(), scopes: SCOPES_LOGIN }
  });
}

// Autoriza o Drive separadamente, só quando o professor pedir.
export function conectarDrive() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: urlRetorno() + '#/materiais',
      scopes: `${SCOPES_LOGIN} ${DRIVE_SCOPE}`,
      queryParams: { access_type: 'offline', prompt: 'consent' }
    }
  });
}

// TEMPORÁRIO: login de teste por e-mail e senha. Remover antes do uso final.
export function entrarComSenha(email, senha) {
  return supabase.auth.signInWithPassword({ email, password: senha });
}

export function sair() {
  return supabase.auth.signOut();
}
