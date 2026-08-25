/**
 * Stockage de la session Supabase sur natif.
 *  • Build RÉCENTE (module natif expo-secure-store présent) → session CHIFFRÉE (Keychain/Keystore),
 *    découpée en morceaux (<2048 o) pour dépasser la limite de taille.
 *  • Build ANCIENNE reçue par OTA (module natif ABSENT) → REPLI sur AsyncStorage (comme avant),
 *    pour NE PAS déconnecter l'utilisateur ni crasher l'app.
 *
 * ⚠️ IMPORTANT (OTA vers d'anciennes builds) : on charge `expo-secure-store` en REQUIRE PARESSEUX
 * protégé par try/catch. Un import direct en tête de fichier LÈVE « Cannot find native module » sur
 * une build qui n'a pas le module natif → l'app ne démarrerait pas. Ici, si le module manque, on
 * bascule silencieusement sur AsyncStorage. Un même bundle JS marche donc sur TOUTES les builds.
 *
 * ── POURQUOI UNE ÉCRITURE PAR GÉNÉRATIONS (et pas « j'efface puis je réécris ») ────────────────
 * La version précédente faisait, à CHAQUE rafraîchissement de jeton (~1×/h) :
 *     effacer tous les morceaux  →  puis écrire les nouveaux.
 * Entre les deux, la session n'existait plus. Toute interruption dans cette fenêtre — l'OS qui tue
 * l'app, une mise à jour OTA appliquée au lancement, un crash, l'utilisateur qui balaie l'app —
 * laissait un jeu de morceaux INCOMPLET. Or la lecture rendait `null` dès qu'un seul morceau
 * manquait, et la copie de secours en clair avait été supprimée à la migration : au redémarrage,
 * supabase-js concluait « pas de session » et l'utilisateur devait se reconnecter, sans un mot.
 *
 * Ici, l'écriture ne détruit JAMAIS ce qui est lisible :
 *   1. les nouveaux morceaux sont écrits sous une NOUVELLE génération (`<clé>.g<gen>.<i>`) ;
 *   2. l'index (`<clé>.__i`) bascule sur cette génération — écriture UNIQUE, donc atomique : c'est
 *      le point de bascule, avant lui l'ancienne session reste intégralement valide ;
 *   3. l'ancienne génération est effacée après coup (et, si ça échoue, au prochain démarrage).
 * Une interruption à n'importe quel instant laisse donc une session complète et lisible.
 *
 * Formats lus (compatibilité descendante — ne JAMAIS retirer, sous peine de déconnecter tout le
 * monde à la mise à jour) : `<clé>.__i` (courant), `<clé>.__n` + `<clé>.<i>` (chunké historique),
 * `<clé>` nu (valeur courte historique), AsyncStorage en clair (avant le chiffrement).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// Chargement paresseux + protégé : `null` si le module natif n'est pas dans la build.
let SecureStore: any = null;
try { SecureStore = require('expo-secure-store'); } catch { SecureStore = null; }

const CHUNK = 1800; // marge sous la limite ~2048
/** Au-delà, on considère que ce n'est pas une session (garde-fou de boucle sur le nettoyage). */
const MAX_CHUNKS = 32;
const safe = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, '_');

const idxKey = (k: string) => `${safe(k)}.__i`;
const genKey = (k: string, g: number, i: number) => `${safe(k)}.g${g}.${i}`;
// Format historique (à lire, plus jamais à écrire).
const oldCountKey = (k: string) => `${safe(k)}.__n`;
const oldPartKey = (k: string, i: number) => `${safe(k)}.${i}`;

type Index = { g: number; n: number; p?: number; pn?: number };

/**
 * Ce que le stockage a vécu depuis le démarrage. Sert au diagnostic remonté par le veilleur de
 * session (lib/auth/sessionWatchdog) quand une session disparaît sans déconnexion volontaire :
 * sans ça, une perte de session est indiscernable d'un « il n'était pas connecté ».
 */
export type SessionStorageDiagnostics = {
  /** Coffre natif réellement utilisable (null = pas encore résolu). */
  secure: boolean | null;
  /** Un jeu de morceaux existait mais était incomplet (écriture interrompue / effacement partiel). */
  incomplete: boolean;
  /** Le coffre a levé à la lecture (Keystore/Keychain inaccessible ou corrompu). */
  readError: string | null;
  /** Le coffre a levé à l'écriture (on est alors retombé sur AsyncStorage). */
  writeError: string | null;
  /** Format d'où la valeur a été récupérée à la dernière lecture réussie. */
  readFrom: 'indexed' | 'legacy-chunked' | 'legacy-plain' | 'clear-async' | 'async' | null;
};

const diag: SessionStorageDiagnostics = {
  secure: null, incomplete: false, readError: null, writeError: null, readFrom: null,
};

export function sessionStorageDiagnostics(): SessionStorageDiagnostics {
  return { ...diag };
}

// Disponibilité RÉELLE du module natif, résolue une seule fois.
let securePromise: Promise<boolean> | null = null;
function secureAvailable(): Promise<boolean> {
  if (!securePromise) {
    securePromise = (async () => {
      if (!SecureStore || typeof SecureStore.setItemAsync !== 'function') return false;
      try {
        if (typeof SecureStore.isAvailableAsync === 'function') return await SecureStore.isAvailableAsync();
        // Sonde : une écriture/lecture témoin. Si le natif manque, ça lève → indisponible.
        await SecureStore.setItemAsync('relyka.__probe', '1');
        await SecureStore.deleteItemAsync('relyka.__probe');
        return true;
      } catch {
        return false;
      }
    })();
    securePromise.then((ok) => { diag.secure = ok; }).catch(() => { diag.secure = false; });
  }
  return securePromise;
}

async function readIndex(key: string): Promise<Index | null> {
  const raw = await SecureStore.getItemAsync(idxKey(key));
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as Index;
    const g = Number(parsed?.g), n = Number(parsed?.n);
    if (!Number.isFinite(g) || !Number.isFinite(n) || n <= 0 || n > MAX_CHUNKS) return null;
    return { g, n, p: parsed?.p, pn: parsed?.pn };
  } catch {
    return null;
  }
}

/**
 * `undefined` = ce format n'est pas utilisé pour cette clé (rien à en tirer, on passe au suivant).
 * `null`      = il y avait bien quelque chose, mais c'est ILLISIBLE — à ne pas confondre avec
 *               « pas de session » : c'est précisément ce qui déconnecte les gens en silence.
 */
async function readIndexed(key: string): Promise<string | null | undefined> {
  const idx = await readIndex(key);
  if (!idx) return undefined;
  let out = '';
  for (let i = 0; i < idx.n; i++) {
    const part = await SecureStore.getItemAsync(genKey(key, idx.g, i));
    if (part == null) { diag.incomplete = true; return null; }
    out += part;
  }
  // Ménage différé : morceaux de la génération précédente qu'un arrêt brutal a laissés derrière.
  // En arrière-plan, sans `await` — le démarrage ne doit pas payer pour du ménage.
  if (idx.p !== undefined && idx.pn) void dropGeneration(key, idx.p, idx.pn);
  return out;
}

async function readLegacyChunked(key: string): Promise<string | null | undefined> {
  const nRaw = await SecureStore.getItemAsync(oldCountKey(key));
  if (nRaw == null) {
    const plain = await SecureStore.getItemAsync(safe(key));
    return plain == null ? undefined : plain;
  }
  const n = parseInt(nRaw, 10);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_CHUNKS) return null;
  let out = '';
  for (let i = 0; i < n; i++) {
    const part = await SecureStore.getItemAsync(oldPartKey(key, i));
    if (part == null) { diag.incomplete = true; return null; }
    out += part;
  }
  return out;
}

async function dropGeneration(key: string, g: number, n: number): Promise<void> {
  for (let i = 0; i < Math.min(n, MAX_CHUNKS); i++) {
    await SecureStore.deleteItemAsync(genKey(key, g, i)).catch(() => {});
  }
}

async function dropLegacy(key: string): Promise<void> {
  const nRaw = await SecureStore.getItemAsync(oldCountKey(key)).catch(() => null);
  await SecureStore.deleteItemAsync(safe(key)).catch(() => {});
  if (nRaw != null) {
    const n = Math.min(parseInt(nRaw, 10) || 0, MAX_CHUNKS);
    for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(oldPartKey(key, i)).catch(() => {});
    await SecureStore.deleteItemAsync(oldCountKey(key)).catch(() => {});
  }
}

/** Écriture atomique par génération (cf. en-tête). Lève si le coffre refuse : l'appelant replie. */
async function writeIndexed(key: string, value: string): Promise<void> {
  const prev = await readIndex(key);
  const gen = (((prev?.g ?? -1) + 1) % 1000 + 1000) % 1000;
  const n = Math.max(1, Math.ceil(value.length / CHUNK));
  if (n > MAX_CHUNKS) throw new Error('session trop volumineuse pour le coffre');
  for (let i = 0; i < n; i++) {
    await SecureStore.setItemAsync(genKey(key, gen, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
  }
  // ── POINT DE BASCULE (écriture unique) : avant, l'ancienne session reste valide ; après, la
  //    nouvelle l'est. Il n'existe aucun instant où aucune des deux ne l'est.
  const next: Index = prev ? { g: gen, n, p: prev.g, pn: prev.n } : { g: gen, n };
  await SecureStore.setItemAsync(idxKey(key), JSON.stringify(next));
  if (prev) await dropGeneration(key, prev.g, prev.n);
}

export const SecureSessionStore = {
  async getItem(key: string): Promise<string | null> {
    try {
      if (!(await secureAvailable())) {
        // Ancienne build (pas de module natif) → AsyncStorage, comme avant.
        const v = await AsyncStorage.getItem(key);
        if (v != null) diag.readFrom = 'async';
        return v;
      }

      const indexed = await readIndexed(key);
      if (typeof indexed === 'string') { diag.readFrom = 'indexed'; return indexed; }

      // Format chiffré historique → on le relit et on le convertit, sans jamais rien perdre.
      const legacy = await readLegacyChunked(key);
      if (typeof legacy === 'string') {
        diag.readFrom = 'legacy-chunked';
        try { await writeIndexed(key, legacy); await dropLegacy(key); } catch { /* la lecture a réussi : c'est l'essentiel */ }
        return legacy;
      }

      // Copie en clair d'avant le chiffrement (AsyncStorage) → migration.
      const clear = await AsyncStorage.getItem(key);
      if (clear != null) {
        diag.readFrom = 'clear-async';
        try {
          await writeIndexed(key, clear);
          // On ne supprime la copie de secours qu'APRÈS avoir vérifié que la version chiffrée se
          // relit vraiment. Supprimer d'abord, c'était parier sur une écriture jamais relue.
          if ((await readIndexed(key)) === clear) await AsyncStorage.removeItem(key).catch(() => {});
        } catch { /* le coffre refuse : on garde la copie en clair plutôt que de perdre la session */ }
        return clear;
      }

      // Ni l'un ni l'autre. Si un format était PRÉSENT mais illisible, on le note : le veilleur de
      // session saura que ce n'est pas « il n'était pas connecté ».
      if (indexed === null || legacy === null) diag.readError = 'stockage présent mais illisible';
      return null;
    } catch (e: any) {
      diag.readError = String(e?.message ?? e).slice(0, 200);
      return AsyncStorage.getItem(key).catch(() => null);
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      if (!(await secureAvailable())) { await AsyncStorage.setItem(key, value); return; }
      await writeIndexed(key, value);
      await dropLegacy(key);
      // Une copie en clair a pu être laissée par un repli d'écriture précédent : elle n'a plus lieu
      // d'être maintenant que le coffre fonctionne.
      await AsyncStorage.removeItem(key).catch(() => {});
    } catch (e: any) {
      diag.writeError = String(e?.message ?? e).slice(0, 200);
      // Repli assumé : perdre la session est pire qu'une copie locale en clair sur un appareil dont
      // le coffre est déjà en panne. Elle sera reprise (et effacée) dès que le coffre remarchera.
      try {
        await AsyncStorage.setItem(key, value);
      } catch {
        return; // même le repli est impossible : on garde au moins ce que le coffre contient encore
      }
      /* La copie en clair est maintenant la version la PLUS RÉCENTE. Si on laissait l'index du
         coffre en place, la prochaine lecture servirait la session d'AVANT et ignorerait celle
         qu'on vient de sauver. On retire donc l'index périmé — seulement maintenant, c'est-à-dire
         une fois le repli écrit et confirmé. */
      try {
        const stale = await readIndex(key);
        if (stale) {
          await dropGeneration(key, stale.g, stale.n);
          await SecureStore.deleteItemAsync(idxKey(key));
        }
      } catch { /* l'index survit : on relira une session plus ancienne, jamais rien */ }
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      if (await secureAvailable()) {
        const idx = await readIndex(key);
        if (idx) {
          await dropGeneration(key, idx.g, idx.n);
          if (idx.p !== undefined && idx.pn) await dropGeneration(key, idx.p, idx.pn);
          await SecureStore.deleteItemAsync(idxKey(key)).catch(() => {});
        }
        await dropLegacy(key);
      }
    } catch { /* noop */ }
    await AsyncStorage.removeItem(key).catch(() => {});
  },
};
