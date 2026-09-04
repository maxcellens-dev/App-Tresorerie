import Constants from 'expo-constants';

/**
 * QUELLE VERSION DE L'APP TOURNE SUR CE TÉLÉPHONE ?
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 * La question a DEUX réponses, et les confondre a fait mentir l'app :
 *
 *   • la version INSTALLÉE — celle du binaire posé par le store (1.0.7). C'est elle qu'on affiche,
 *     et c'est elle qu'il faut comparer à la dernière version publiée pour dire « une mise à jour
 *     est disponible » ;
 *   • la version du BUNDLE JS en cours — celle déclarée par app.json au moment où l'OTA a été
 *     publiée (1.0.8). Elle change à chaque OTA, sans que rien ne bouge côté store.
 *
 * `Constants.expoConfig.version` donne la SECONDE : c'est le manifeste du bundle qui tourne, pas
 * celui de l'application installée. L'app annonçait donc « version installée v1.0.8 » à quelqu'un
 * qui n'avait jamais quitté la 1.0.7 — et pire, elle en concluait « tu es à jour » alors qu'une
 * vraie mise à jour l'attendait sur le store.
 *
 * La version installée ne peut venir que du NATIF (`expo-application`).
 *
 * ⚠️ CHARGEMENT DÉFENSIF, ET C'EST INDISPENSABLE. Une OTA atteint aussi les binaires PLUS ANCIENS
 * (le runtime est volontairement figé pour que les mises à jour touchent tout le monde), qui
 * n'embarquent pas encore ce module natif : `require` lèverait alors au démarrage. On retombe dans
 * ce cas sur l'ancien comportement — la version du bundle — au lieu de faire planter l'app. Même
 * blindage que NetInfo dans app/_layout. Le jour où tout le parc est passé sur une build qui
 * embarque `expo-application`, ce repli ne sert plus qu'au web.
 */
let nativeVersion: string | null = null;
let nativeBuild: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Application = require('expo-application');
  const v = Application?.nativeApplicationVersion;
  const b = Application?.nativeBuildVersion;
  if (typeof v === 'string' && v) nativeVersion = v;
  if (typeof b === 'string' && b) nativeBuild = b;
} catch {
  /* Module natif absent (binaire antérieur) ou plateforme sans version native (web). */
}

/** Version déclarée par le BUNDLE en cours d'exécution (change à chaque OTA). */
export const BUNDLE_VERSION: string = Constants.expoConfig?.version ?? '1.0.1';

/**
 * Version RÉELLEMENT INSTALLÉE sur l'appareil — la seule à afficher et à comparer au store.
 * Repli sur la version du bundle quand le natif ne peut pas la donner (voir l'en-tête).
 */
export const APP_VERSION: string = nativeVersion ?? BUNDLE_VERSION;

/** Numéro de build natif (versionCode Android / build iOS), `null` si indisponible. */
export const APP_BUILD: string | null = nativeBuild;

/** true si la version installée vient bien du natif (et n'est donc pas un repli). */
export const NATIVE_VERSION_KNOWN: boolean = nativeVersion != null;

/**
 * L'app tourne-t-elle sur un bundle DIFFÉRENT de son binaire ? (une OTA plus récente est appliquée)
 * Sert à l'afficher sans ambiguïté : « v1.0.7 · mise à jour 1.0.8 ».
 */
export const RUNNING_NEWER_BUNDLE: boolean = NATIVE_VERSION_KNOWN && BUNDLE_VERSION !== APP_VERSION;

/**
 * Mention de copyright — l'année vient de l'HORLOGE, jamais d'une constante.
 *
 * Elle était écrite en dur (« © 2026 ») dans la page « À propos » et le menu profil : chaque
 * 1ᵉʳ janvier, l'app affichait une année périmée jusqu'à ce que quelqu'un pense à la corriger.
 */
export function copyrightNotice(suffix = ''): string {
  return `© ${new Date().getFullYear()} Relyka${suffix}`;
}
