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

module.exports = config;
