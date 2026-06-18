// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Inclure 'web' pour que Metro résolve les fichiers .web.ts / .web.js sur la plateforme web
// (ex. configStorage.web.ts au lieu de configStorage.ts qui utilise react-native-mmkv).
// Sans cela, le bundle web peut inclure des modules natifs et renvoyer une erreur 500 (MIME application/json).
if (config.resolver && Array.isArray(config.resolver.platforms)) {
  if (!config.resolver.platforms.includes('web')) {
    config.resolver.platforms = [...config.resolver.platforms, 'web'];
  }
}

// @supabase/supabase-js (build ESM/web) tente un import dynamique optionnel d'@opentelemetry/api
// (`import(OTEL_PKG).catch(() => null)`). Le paquet n'est pas installé (instrumentation facultative)
// → Metro échoue à le résoudre côté web et l'app affiche un écran blanc. On le résout en module vide :
// supabase gère déjà son absence (catch → null). Sans effet sur le natif (build CJS sans cet import).
const prevResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@opentelemetry/api') {
    return { type: 'empty' };
  }
  return prevResolveRequest
    ? prevResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
