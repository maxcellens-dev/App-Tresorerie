/**
 * Config plugin — authentifie Gradle auprès de jitpack.io.
 *
 * Certaines dépendances natives (expo-blur → BlurView, expo-image-picker → Android-Image-Cropper)
 * ne sont disponibles QUE sur jitpack.io. Sans authentification, jitpack rate-limite l'IP des
 * serveurs EAS et renvoie des 403 → la build Gradle échoue à la résolution des dépendances.
 *
 * Ce plugin ajoute, dans le build.gradle racine, un hook qui pose un token (variable
 * d'environnement JITPACK_TOKEN) sur TOUTES les repositories jitpack — les requêtes
 * authentifiées ne sont pas rate-limitées. No-op si le token est absent (build inchangée).
 */
const { withProjectBuildGradle } = require('@expo/config-plugins');

const MARKER = 'withJitpackAuth';

const SNIPPET = `
// >>> ${MARKER} : authentification jitpack (évite les 403 rate-limit sur EAS)
allprojects {
  repositories {
    all { repo ->
      try {
        def repoUrl = repo.hasProperty('url') ? (repo.url?.toString() ?: '') : ''
        if (repoUrl.contains('jitpack.io')) {
          def jitpackToken = System.getenv('JITPACK_TOKEN')
          if (jitpackToken != null && jitpackToken.trim().length() > 0) {
            repo.credentials { username = jitpackToken.trim() }
          }
        }
      } catch (ignored) { }
    }
  }
}
// <<< ${MARKER}
`;

module.exports = function withJitpackAuth(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg;
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += SNIPPET;
    }
    return cfg;
  });
};
