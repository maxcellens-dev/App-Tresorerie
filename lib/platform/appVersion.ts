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
 * `a` est-elle une version PLUS RÉCENTE que `b` ? (« 1.0.10 » > « 1.0.9 », comparé nombre à nombre)
 *
 * Définition UNIQUE : elle vivait en deux copies — dans le bandeau de mise à jour et dans les
 * réglages — qui décidaient toutes deux d'un même message (« une nouvelle version est disponible »).
 * Deux copies d'une comparaison, c'est deux écrans qui finissent par ne plus dire la même chose.
 */
export function isNewerVersion(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = String(a ?? '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b ?? '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/**
 * Faut-il proposer la mise à jour du STORE ? Réponse partagée par le bandeau et les réglages.
 *
 * ⚠️ LE CAS QUI FAISAIT TOUT RATER : quand la version installée n'est pas connue du natif
 * (`NATIVE_VERSION_KNOWN` faux), `APP_VERSION` retombe sur celle du BUNDLE — qui monte à chaque
 * OTA. Comparer là-dessus concluait « pas de mise à jour » d'autant plus sûrement que
 * l'utilisateur recevait des OTA : le bandeau ne s'affichait JAMAIS sur le parc existant.
 *
 * Or cette ignorance est elle-même un renseignement : un binaire qui n'embarque pas
 * `expo-application` est forcément ANTÉRIEUR à la build qui l'a introduit, donc antérieur à la
 * dernière version publiée. On propose donc la mise à jour — sans jamais la rendre OBLIGATOIRE sur
 * une déduction (cf. `min_version`, qui exige, lui, une version installée connue).
 */
export function shouldOfferStoreUpdate(latestVersion: string | null | undefined): boolean {
  if (!latestVersion) return false;                 // rien de publié en configuration
  if (!NATIVE_VERSION_KNOWN) return true;           // binaire antérieur (cf. ci-dessus)
  return isNewerVersion(latestVersion, APP_VERSION);
}

/**
 * Mention de copyright — l'année vient de l'HORLOGE, jamais d'une constante.
 *
 * Elle était écrite en dur (« © 2026 ») dans la page « À propos » et le menu profil : chaque
 * 1ᵉʳ janvier, l'app affichait une année périmée jusqu'à ce que quelqu'un pense à la corriger.
 */
export function copyrightNotice(suffix = ''): string {
  return `© ${new Date().getFullYear()} Relyka${suffix}`;
}
