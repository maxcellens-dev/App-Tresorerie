/**
 * EAS Build post-install hook — corrige deux incompatibilités d'expo-modules-core@1.11.x
 * lorsqu'on build avec Gradle 8.3 / AGP 8 en ciblant Android 15 (compileSdk 35).
 *
 * Patch 1 — Gradle 8.3 / AGP 8 :
 *   La closure Groovy `useExpoPublishing` utilise `components.release` dans `afterEvaluate`.
 *   Sous Gradle 8.3 + AGP 8 → « Could not get unknown property 'release' », ce qui empêche
 *   l'enregistrement d'`expo-module-gradle-plugin` et casse TOUS les modules expo.
 *   → On remplace `useExpoPublishing` par un no-op (Maven publishing inutile pour un build d'app).
 *
 * Patch 2 — compileSdk 35 (Android 15) :
 *   `PackageInfo.requestedPermissions` est devenu nullable (`Array<String>?`) en API 35.
 *   `PermissionsService.kt:166` fait `requestedPermissions.contains(...)` sans null-check
 *   → erreur Kotlin « Only safe (?.) calls are allowed on a nullable receiver ».
 *   → On rend l'appel null-safe.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'node_modules', 'expo-modules-core', 'android');

/** Patch 1 — neutralise useExpoPublishing. */
function patchExpoPublishing() {
  const file = path.join(root, 'ExpoModulesCorePlugin.gradle');
  if (!fs.existsSync(file)) {
    console.log('[patch1] ExpoModulesCorePlugin.gradle introuvable, ignoré.');
    return;
  }
  const content = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const regex = /(ext\.useExpoPublishing\s*=\s*\{)([\s\S]*?)(\n\})/;
  const match = content.match(regex);
  if (!match) {
    console.log('[patch1] WARNING: closure useExpoPublishing non trouvée — ignoré.');
    return;
  }
  if (match[2].trim() === '// no-op: patched for Gradle 8 app build') {
    console.log('[patch1] Déjà patché.');
    return;
  }
  fs.writeFileSync(
    file,
    content.replace(regex, 'ext.useExpoPublishing = {\n  // no-op: patched for Gradle 8 app build\n}'),
    'utf8'
  );
  console.log('[patch1] SUCCESS: useExpoPublishing remplacé par un no-op (Gradle 8.3).');
}

/** Patch 2 — rend requestedPermissions null-safe (compileSdk 35). */
function patchPermissionsService() {
  const file = path.join(root, 'src', 'main', 'java', 'expo', 'modules', 'adapters', 'react', 'permissions', 'PermissionsService.kt');
  if (!fs.existsSync(file)) {
    console.log('[patch2] PermissionsService.kt introuvable, ignoré.');
    return;
  }
  const content = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const target = 'return requestedPermissions.contains(permission)';
  const replacement = 'return requestedPermissions?.contains(permission) ?: false';
  if (content.includes(replacement)) {
    console.log('[patch2] Déjà patché.');
    return;
  }
  if (!content.includes(target)) {
    console.log('[patch2] WARNING: ligne requestedPermissions.contains non trouvée — ignoré.');
    return;
  }
  fs.writeFileSync(file, content.replace(target, replacement), 'utf8');
  console.log('[patch2] SUCCESS: requestedPermissions rendu null-safe (compileSdk 35).');
}

patchExpoPublishing();
patchPermissionsService();
