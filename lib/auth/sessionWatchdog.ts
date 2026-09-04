/**
 * VEILLEUR DE SESSION — savoir, et non plus supposer, quand une session est perdue.
 *
 * Une session qui disparaît toute seule ne laisse AUCUNE trace : supabase-js n'émet pas d'événement
 * (il n'a rien trouvé au démarrage, donc il n'y a rien à signaler), l'app affiche simplement
 * l'accueil, et côté serveur c'est indiscernable de « cette personne n'était pas connectée ». C'est
 * pour ça qu'une déconnexion de masse après une mise à jour ne peut ni se constater ni se mesurer :
 * on n'apprend son existence que par les utilisateurs qui se plaignent.
 *
 * Le principe est volontairement minimal : un marqueur LOCAL, non sensible, écrit quand une session
 * est bien là. Au démarrage suivant, s'il n'y a plus de session alors que le marqueur est présent
 * — et qu'aucune déconnexion volontaire ou expliquée n'a eu lieu — c'est une PERTE, et on la
 * remonte avec de quoi la comprendre : version de l'app et runtime d'AVANT vs MAINTENANT (donc :
 * est-ce que ça suit un OTA ou une nouvelle build ?) et l'état du coffre de session.
 *
 * Le marqueur ne contient aucun jeton : seulement des versions, un horodatage et l'identifiant
 * interne du compte (celui-là même qui figure déjà dans chaque ligne de la base), afin de pouvoir
 * mesurer l'ampleur d'un incident au lieu de la deviner.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_VERSION, BUNDLE_VERSION } from '../platform/appVersion';
import { reportError } from '../platform/errorReporting';
import { sessionStorageDiagnostics } from '../platform/secureStorage';

const KEY = 'relyka.auth.lastSession';

const _rv = (Constants.expoConfig as any)?.runtimeVersion;
const RUNTIME_VERSION = typeof _rv === 'string' ? _rv : '';

/**
 * `v` = version INSTALLÉE (le binaire), `b` = version du BUNDLE en cours (change à chaque OTA),
 * `rv` = runtime (change à chaque build).
 *
 * ⚠️ `b` n'est pas décoratif : depuis que `APP_VERSION` désigne le binaire et non le bundle
 * (cf. lib/platform/appVersion), une OTA ne fait plus bouger `v` — sans `b`, une session perdue
 * APRÈS une mise à jour OTA aurait été classée « cause inconnue », c'est-à-dire précisément le
 * diagnostic que ce veilleur existe pour poser.
 */
type Mark = { at: number; v: string; b?: string; rv: string; uid: string };

/** Une seule remontée par démarrage : ce n'est pas un compteur, c'est un signal. */
let reported = false;

function isNative(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/** Une session est en place : on note qu'elle existait, pour pouvoir constater sa disparition. */
export function markSessionAlive(userId: string): void {
  const mark: Mark = { at: Date.now(), v: APP_VERSION, b: BUNDLE_VERSION, rv: RUNTIME_VERSION, uid: userId };
  AsyncStorage.setItem(KEY, JSON.stringify(mark)).catch(() => {});
}

/**
 * Déconnexion VOULUE (bouton) ou EXPLIQUÉE (session révoquée, mot de passe changé) : ce n'est pas
 * une perte, on retire le marqueur pour ne pas crier au loup au prochain démarrage.
 */
export function clearSessionMark(): void {
  AsyncStorage.removeItem(KEY).catch(() => {});
}

async function readMark(): Promise<Mark | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as Mark;
    return m && typeof m.at === 'number' ? m : null;
  } catch {
    return null;
  }
}

/**
 * À appeler au démarrage quand `getSession()` n'a RIEN rendu. Si une session existait au dernier
 * lancement, c'est qu'elle a été perdue : on le remonte au Centre de sécurité (RPC ouverte à `anon`,
 * donc utilisable justement quand il n'y a plus de session), puis on retire le marqueur pour ne
 * remonter l'incident qu'une fois.
 *
 * Rien de bloquant, rien d'affiché : l'app démarre normalement.
 */
export async function reportSessionLossIfUnexpected(): Promise<void> {
  if (reported || !isNative()) return;
  const mark = await readMark();
  if (!mark) return;
  reported = true;
  clearSessionMark();

  const d = sessionStorageDiagnostics();
  // Une OTA ne change QUE le bundle : sans `mark.b`, elle passait pour « rien n'a bougé ».
  const bundleChanged = (mark.b ?? mark.v) !== BUNDLE_VERSION;
  const updated = mark.v !== APP_VERSION || mark.rv !== RUNTIME_VERSION || bundleChanged;
  // La cause probable, nommée : c'est elle qu'on lira dans le Centre de sécurité, pas une pile.
  const cause = d.readError ? 'coffre illisible'
    : d.incomplete ? 'morceaux incomplets'
    : d.secure === false ? 'coffre indisponible'
    : updated ? 'après mise à jour'
    : 'inconnue';

  await reportError(
    'error',
    `Session perdue au démarrage (${cause})`,
    null,
    {
      uid: mark.uid,
      // Ce qui répond à « est-ce que ça suit une mise à jour ? » : les versions d'avant et d'après.
      from_version: mark.v,
      from_bundle: mark.b ?? mark.v,
      from_runtime: mark.rv,
      to_version: APP_VERSION,
      to_bundle: BUNDLE_VERSION,
      to_runtime: RUNTIME_VERSION,
      after_update: updated,
      /* Une nouvelle BUILD change le runtime (et souvent la version installée) ; une OTA ne change
         que le bundle. On lit donc les deux, dans cet ordre. */
      kind: !updated ? 'same_version'
        : (mark.rv !== RUNTIME_VERSION || mark.v !== APP_VERSION) ? 'build'
        : 'ota',
      hours_since_last_session: Math.round((Date.now() - mark.at) / 36e5),
      storage: d,
    },
  );
}
