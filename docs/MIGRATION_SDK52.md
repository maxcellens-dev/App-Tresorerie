# Migration Expo SDK 50 → 52 (RN 0.76)

But : corriger les alertes Google Play Console liées à Android 15 —
**#1 incompat Kotlin `removeFirst/removeLast`** et **#4 alignement 16 Ko** — qui viennent
gratuitement des binaires natifs de React Native 0.76 (NDK 27).

Choix de migration (voir l'historique de décision) :
- **SDK 52 / RN 0.76 / React 18** (pas React 19 → casse minimale).
- **Ancienne architecture RN conservée** (`newArchEnabled: false`) → mmkv v2, etc. inchangés.
- **targetSdk/compileSdk 35** conservés (conforme Play jusqu'au 31/08/2026).
- **edge-to-edge NON activé** dans cette passe (alertes #2/#3, non bloquantes) : à traiter
  dans une itération testable ultérieure (risque visuel non testable avant la build).

## Ce qui a été fait (côté JS, validé hors build native)

- `package.json` : toutes les deps alignées sur les versions épinglées SDK 52
  (`bundledNativeModules.json`). Ajout des sous-paquets Expo requis par l'outillage et
  non hoistés automatiquement : `expo-asset`, `expo-font`, `expo-file-system`,
  `expo-keep-awake`, `expo-splash-screen`.
- **TypeScript 5.3 → 5.6** : `@tanstack/react-query` 5.101 (remonté via `^5.59.0`) utilise
  le `NoInfer` natif de TS 5.4+. Sans ce bump, ~250 erreurs implicit-any (générique non résolu).
  TS est une devDep → zéro impact sur la build native.
- `app.json` : `newArchEnabled: false`.
- Suppression du patch obsolète `scripts/eas-build-post-install.js` (+ script npm associé) :
  il forçait expo-modules-core 1.11.x (SDK 50) à compiler en compileSdk 35 ; SDK 52 le gère nativement.
- `tsconfig.json` : ajout `moduleResolution: "bundler"` (honore le champ `exports` des paquets modernes).
- Correctif de typage `boutique.tsx` (narrowing TS 5.6 sur `.filter(c !== 'premium')`).
- `metro.config.js` : résolution d'`@opentelemetry/api` en module vide. `@supabase/supabase-js`
  (remonté en 2.108) tente un import dynamique optionnel d'OTel dans son build ESM/web → Metro
  échouait à bundler le web (écran blanc). Sans effet sur le natif (build CJS sans cet import).

## Validations effectuées (sans consommer de build EAS)

- `npx tsc --noEmit` → **0 erreur**.
- `npx expo config --type public` → OK (tous les plugins se résolvent, dont `withJitpackAuth`).
- `npx expo export --platform android` → **bundle Hermes généré sans erreur** (tout le graphe
  d'import natif compile : expo-router v4, hooks, écrans, modules natifs).
- `npx expo-doctor` → 14/18 (les 4 échecs sont uniquement réseau/TLS dans l'environnement de dev,
  pas des problèmes projet).

## À FAIRE le 1er juillet (build EAS — quota dispo)

1. `npx expo-doctor` (en ligne) pour confirmer l'alignement des versions.
2. `eas build --platform android --profile production`.
3. Vérifier dans le rapport pré-lancement Play Console que **#1 (Kotlin)** et **#4 (16 Ko)**
   ont disparu.
4. Tester sur appareil : démarrage, navigation, achats (RevenueCat), notifications, MMKV,
   et le rendu **thème clair** (nouveau défaut) sur les écrans clés.

## Suivi ultérieur (non bloquant)

- **edge-to-edge** (`react-native-edge-to-edge`) pour solder les alertes #2/#3 — à faire avec
  un build de dev pour vérifier les insets (écrans à `SafeAreaView edges={[]}` + en-têtes custom).
- **API 36 / Android 16** : cible à monter avant le **31/08/2026** (prochaine migration, testable).
