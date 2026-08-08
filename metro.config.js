const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @supabase/supabase-js (via @supabase/auth-js) quebra a resolução de
// "package exports" mais nova do Metro no Windows — o resolvedor tenta
// caminhos absurdos (ex: "index.js.ts") em vez de achar o dist/main/index.js
// que existe de verdade. Desativar esse modo faz o Metro voltar a resolver
// pelos campos main/browser tradicionais, que funcionam certinho aqui.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
