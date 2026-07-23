# Migration Expo SDK 52 → 54 (Play Console : API 36 · edge-to-edge · 16 Ko · APIs dépréciées)

> ## ✅ EXÉCUTÉE le 23/07/2026 — ce document est désormais l'historique de ce qui a été fait
>
> Déclencheur : Google Play a **refusé** l'App Bundle (versionCode 38) avec l'erreur bloquante
> « Votre appli ne prend pas en charge les tailles de page de mémoire de 16 ko ».
> Confirmé côté Expo : **le support 16 Ko exige React Native ≥ 0.77, donc SDK ≥ 53. Aucun
> contournement par configuration n'existe en SDK 52** (les `.so` précompilés de RN — `libreactnative.so`,
> `libhermes.so` — y sont alignés sur 4 Ko).
>
> **État réel après exécution :**
> - `expo` 52 → **54.0.36** · `react-native` 0.76.9 → **0.81.5** · `react` 18.3.1 → **19.1.0**
> - `expo-router` 4 → **6.0.24** · `react-native-screens` → 4.16 · `safe-area-context` → 5.6.2
> - `react-native-edge-to-edge` 1.4.3 → **1.6.2 — NE PAS DÉPASSER**. Cette lib n'est PAS gérée par le
>   SDK 54 (absente de `bundledNativeModules.json`), donc `expo install --fix` ne la corrige pas. À partir
>   de la **1.7.0**, ses thèmes héritent de `Theme.Material3Expressive.*`, fournis uniquement par
>   Material Components **1.13+** — que la lib ne déclare pas en dépendance. Résultat avec RN 0.81 :
>   le build échoue à `:app:processReleaseResources` sur « resource style/Theme.Material3Expressive…
>   not found ». La 1.6.2 hérite de `Theme.AppCompat.*`, toujours disponible. · `@expo/vector-icons` **installé explicitement**
>   (il n'est plus fourni par le paquet `expo` en SDK 54)
> - `react-native-reanimated` **volontairement gardé en v3.19.5** (la v4 est New-Arch only) et verrouillé
>   via `expo.install.exclude` dans `package.json`
> - `compileSdkVersion` / `targetSdkVersion` **35 → 36** (lève aussi l'avertissement API 36)
> - `runtimeVersion` **1.0.3 → 1.0.4** — OBLIGATOIRE : le natif change entièrement, garder 1.0.3
>   enverrait ce JS SDK 54 aux builds SDK 52 existants = crash immédiat pour tout le monde
>
> **Corrections de code rendues nécessaires :**
> - `components/Carousel.tsx` : `useRef()` sans argument (interdit en React 19) + typage du timer
> - `lib/pushNotifications.native.ts` : `shouldShowAlert` (déprécié) scindé en `shouldShowBanner` + `shouldShowList`
>
> **Vérifications passées :** `tsc --noEmit` 0 erreur · 180/180 tests · bundle Android **et** web exportés ·
> `expo-doctor` 17/18 (seul écart = le pin Reanimated v3, volontaire) · `expo prebuild` génère un projet
> Android cohérent (Legacy Arch conservée, thème `Theme.EdgeToEdge`, splash et JitPack préservés).
>
> **Reste à faire :** build EAS, puis **vérifier l'AAB avec `node scripts/check-16kb.js <fichier.aab>`
> AVANT de l'uploader** sur Play.

But : lever les **4 avertissements Google Play** d'un coup. Tous découlent de la version RN/Expo :
RN 0.81 (SDK 54) cible **Android 16 / API 36**, active l'**edge-to-edge** nativement, est **compatible 16 Ko**,
et embarque les versions de `react-native-screens` / `react-native-edge-to-edge` / `react-native-keyboard-controller`
qui **n'utilisent plus** `Window.set*BarColor` ni `LAYOUT_IN_DISPLAY_CUTOUT_MODE_*`.

> ⚠️ **Cette migration = nouveau binaire natif.** Pas d'OTA : il faut un build EAS + soumission Play.
> Bumper `runtimeVersion` (les anciens clients ne prendront pas cette update OTA — c'est voulu).

---

## Décision d'architecture — on reste en **Legacy Architecture** (Path B)

SDK 54 est la **dernière** version supportant l'ancienne architecture. On **garde `newArchEnabled: false`** :
c'est le chemin le moins risqué et il suffit à corriger les 4 avertissements.

Pourquoi ne PAS activer la New Architecture maintenant :
- `react-native-mmkv@2` **ne supporte pas** la New Arch (il faudrait passer en **v3** → migration MMKV).
- `react-native-reanimated` v4 est **New-Arch only** → on **reste en Reanimated v3** (compatible RN 0.81 + legacy).
- `react-native-purchases`, `react-native-calendars`, etc. demanderaient une validation New-Arch complète.

➡️ **New Architecture = chantier séparé, obligatoire au passage SDK 55** (voir § dernier). On le fera plus tard,
isolément, avec son propre cycle de test.

---

## Étape 1 — Dépendances (via `expo install`, PAS à la main)

On **n'édite pas** les 20 versions RN à la main (risque d'incohérence). On ancre `expo` puis on laisse
`expo install --fix` résoudre l'ensemble aux versions mutuellement compatibles de SDK 54.

```bash
# Node ≥ 20.19.4 requis (nvm use 20)
rm -rf node_modules
npm i expo@^54.0.0
npx expo install --fix            # aligne TOUTES les deps Expo/RN sur SDK 54
```

Puis **épingler les exceptions** (legacy arch) :

```bash
# Reanimated reste en v3 (v4 = New Arch only). Worklets NON requis en v3.
npx expo install react-native-reanimated@~3.19.0
# edge-to-edge n'est plus tiré par `expo` en SDK 54 → dépendance directe (déjà présente ici, on la garde alignée)
npx expo install react-native-edge-to-edge
```

**Versions cibles attendues après `--fix`** (à vérifier dans `package.json`) :

| Package | SDK 52 (actuel) | SDK 54 (cible) |
|---|---|---|
| `expo` | ~52.0.0 | ~54.0.0 |
| `react` / `react-dom` | 18.3.1 | 19.1.0 |
| `react-native` | 0.76.9 | 0.81.x |
| `react-native-screens` | ~4.4.0 | ~4.16.0 |
| `react-native-safe-area-context` | 4.12.0 | ~5.6.0 |
| `react-native-reanimated` | ~3.16.1 | **~3.19.x** (pin legacy) |
| `react-native-keyboard-controller` | 1.16.8 | dernière SDK54 (via --fix) |
| `expo-router` | ~4.0.22 | ~6.x |
| `expo-notifications` | ~0.29.14 | ~0.32.x |
| `react-native-mmkv` | ^2.12.2 | **rester en v2** (legacy) |

> Ne PAS forcer `react-native-mmkv@3` : v3 = New Arch. On reste en v2 tant qu'on est en legacy.

---

## Étape 2 — `app.json`

```jsonc
{
  "expo": {
    // ...
    "runtimeVersion": "2.0.0",            // BUMP (nouveau binaire natif ; coupe l'OTA des anciens)
    "android": {
      // versionCode sera auto-incrémenté par EAS (autoIncrement:true en production)
    },
    "plugins": [
      "./plugins/withJitpackAuth",
      "expo-router",
      ["expo-notifications", { "icon": "./assets/notification-icon.png", "color": "#0D2E2A" }],
      ["expo-splash-screen", { "image": "./assets/logo.png", "imageWidth": 96, "resizeMode": "contain", "backgroundColor": "#F4EFE6" }],
      ["expo-build-properties", {
        "android": {
          "minSdkVersion": 24,
          "compileSdkVersion": 36,        // 35 → 36
          "targetSdkVersion": 36,         // 35 → 36
          "enableProguardInReleaseBuilds": true,   // R8 : minify
          "enableShrinkResourcesInReleaseBuilds": true  // R8 : shrink resources
        }
      }],
      ["react-native-edge-to-edge", { "android": { "parentTheme": "Default", "enforceNavigationBarContrast": false } }]
    ]
  }
}
```

Notes :
- **R8** s'active via `enableProguardInReleaseBuilds` + `enableShrinkResourcesInReleaseBuilds` (managed → pas de `build.gradle` à éditer).
- **`newArchEnabled`** reste `false` (ou absent). NE PAS le passer à `true` (cf. décision ci-dessus).
- L'edge-to-edge est **de toute façon forcé** par RN 0.81 sous API 36 ; on garde le plugin pour le contrôle des insets.

---

## Étape 3 — Règles R8 / ProGuard

Le fichier `proguard-rules.pro` est **généré par prebuild** (managed). Expo + autolinking fournissent
les règles `-keep` pour RN, Hermes, Reanimated, etc. **Ne rien ajouter par défaut.** Si un crash release
apparaît (classe absente en release, pas en debug), ajouter une règle ciblée via le plugin
`expo-build-properties` → `android.extraProguardRules`, ex. :

```jsonc
["expo-build-properties", { "android": { "extraProguardRules": "-keep class com.relyka.** { *; }" } }]
```

À vérifier en priorité en release (libs à natif/reflection) : `react-native-purchases`, `react-native-mmkv`,
`react-native-svg`, `xlsx-js-style`. Tester un **build release réel** avant de publier.

---

## Étape 4 — Ajustements de code (React 19 + RN 0.81)

À passer en revue après `--fix` (souvent aucun changement, mais à contrôler) :

1. **`<SafeAreaView>` de `react-native`** = déprécié. Le projet utilise déjà `react-native-safe-area-context`
   partout → OK. Vérifier qu'aucun écran n'importe `SafeAreaView` depuis `react-native`.
   ```bash
   grep -rn "SafeAreaView" --include=*.tsx app components | grep "from 'react-native'"
   ```
2. **React 19** : `ref` peut être une prop ; `propTypes`/`defaultProps` sur fonctions supprimés ;
   `React.FC` implicites OK. Vérifier les libs qui patchent React (peu probable ici).
3. **expo-notifications ~0.32** : exports dépréciés retirés. Vérifier `lib/pushNotifications.ts` /
   `systemNotifications.ts` (API `addNotificationReceivedListener`, `getDevicePushTokenAsync` OK).
4. **`expo-splash-screen`** : API `setOptions({ fade })` conservée. Revalider le raccord splash natif → JS.
5. **Edge-to-edge** : l'app dessine derrière les barres. Contrôler les écrans à barre épinglée
   (`useKeyboardOverlap`, `HeaderWithProfile`, `ImpersonationBanner`, `UpdateBanner`, `SecurityGate`) :
   les `insets` de `safe-area-context` doivent gérer haut/bas. C'est le point le plus visuel à tester.
6. **`metro`/`metro-resolver` overrides** : s'il y en avait pour expo-router, les retirer (plus nécessaires).

---

## Étape 5 — Build & tests (obligatoire, non testable en local ici)

```bash
npx expo-doctor                       # 0 problème avant build
npx expo prebuild --clean             # (si on veut inspecter le natif généré)
eas build --profile preview --platform android    # APK/AAB interne
```

Checklist de validation :
- [ ] `expo-doctor` : aucun avertissement de version.
- [ ] Build **release** (R8 actif) : pas de crash au lancement ni sur les écrans clés.
- [ ] **Android 15 et 16** (émulateur API 35/36) : rien de caché sous la status bar / nav bar (edge-to-edge).
- [ ] Clavier (chat IA, saisie) : pas de chevauchement (keyboard-controller + insets).
- [ ] Achats RevenueCat, MMKV (thème/cache), notifications push, calendrier : OK.
- [ ] **Play Console** : vérifier l'AAB → alignement 16 Ko, target API 36, plus d'API dépréciée signalée.
- [ ] Bumper `versionCode`/`version` (EAS `autoIncrement`), publier en test interne d'abord.

---

## Plus tard — New Architecture (obligatoire en SDK 55)

Chantier séparé, à planifier :
- `newArchEnabled: true`
- `react-native-mmkv` **v2 → v3**
- `react-native-reanimated` **v3 → v4** (+ `react-native-worklets`)
- Re-tester TOUTES les libs natives sous Fabric/TurboModules.

À faire quand SDK 55 sortira / avant la prochaine deadline Play, isolément de cette migration.
