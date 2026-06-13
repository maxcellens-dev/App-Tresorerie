/**
 * EAS Build post-install hook — fixes expo-modules-core Gradle 8.3 / AGP 8 incompatibility.
 *
 * In expo-modules-core@1.11.x, the `useExpoPublishing` Groovy closure uses
 * `components.release` inside `afterEvaluate`. Under Gradle 8.3 + AGP 8 this
 * throws "Could not get unknown property 'release'", which also prevents
 * `expo-module-gradle-plugin` from being registered, breaking ALL expo modules.
 *
 * Fix: replace `useExpoPublishing` with a no-op closure. Maven publishing is only
 * needed when distributing expo-modules-core as a library — never for app builds.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo-modules-core',
  'android',
  'ExpoModulesCorePlugin.gradle'
);

if (!fs.existsSync(filePath)) {
  console.log('[patch] ExpoModulesCorePlugin.gradle not found, skipping.');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

// Locate and neutralise the useExpoPublishing closure entirely.
// We replace its body with a no-op so it still exists (other callers won't crash)
// but no longer touches components.release.
const regex = /(ext\.useExpoPublishing\s*=\s*\{)([\s\S]*?)(\n\})/;
const match = content.match(regex);

if (!match) {
  console.log('[patch] WARNING: useExpoPublishing closure not found — patch skipped.');
  process.exit(0);
}

if (match[2].trim() === '// no-op: patched for Gradle 8 app build') {
  console.log('[patch] Already patched, nothing to do.');
  process.exit(0);
}

const patched = content.replace(
  regex,
  'ext.useExpoPublishing = {\n  // no-op: patched for Gradle 8 app build\n}'
);

fs.writeFileSync(filePath, patched, 'utf8');
console.log('[patch] SUCCESS: useExpoPublishing replaced with no-op for Gradle 8.3 compatibility.');
