/**
 * queryPersist — persistance LOCALE du cache react-query des requêtes essentielles, pour que l'app
 * affiche les dernières données connues immédiatement (hors-ligne, ou au rafraîchissement) au lieu
 * d'un écran vide le temps que le réseau réponde.
 *
 * Approche volontairement conservatrice :
 *  - liste blanche de clés → borne la taille et le risque ;
 *  - uniquement les requêtes réussies ;
 *  - écriture debouncée ; lecture unique au démarrage ;
 *  - tout est enrobé de try/catch : en cas de souci, on repart sans cache (jamais de crash).
 *
 * ── LE WEB EN FAISAIT PARTIE, ET C'ÉTAIT UNE ERREUR ─────────────────────────────────────────
 * Le web était exclu, au motif que « le navigateur gère déjà son cache ». Il gère celui des
 * FICHIERS, pas celui des DONNÉES : à chaque rafraîchissement de page, tout l'arbre react-query
 * repartait vide et l'app rejouait la cascade complète — session, profil, tableau de bord, comptes,
 * transactions — avant de pouvoir afficher un chiffre. C'est précisément la plateforme où l'on
 * recharge le plus souvent.
 *
 * Le stockage y est plus étroit (localStorage, ~5 Mo par origine, et SYNCHRONE) : on y persiste donc
 * une liste réduite aux données qui font la première page, avec un plafond plus bas. Un dépassement
 * ne casse rien — on saute simplement la sauvegarde.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';

const STORE_KEY = 'relyka.rq.cache.v1';

/** Ce qui vaut la peine d'être revu hors-ligne : tableau de bord + identité + thème/style. */
const WHITELIST = new Set([
  'pilotage_data', 'profile', 'style_config', 'landing_config', 'accounts', 'transactions',
  // Réglages de fiabilité (minuscules) : indispensables dès la 1ʳᵉ frame, sinon la carte Relyka
  // affiche un montant sec puis bascule en fourchette quand la config arrive du réseau.
  'reliability_config',
  // Projets PARTAGÉS : la page Projets sort ses projets perso du cache (ils viennent du Pilotage,
  // déjà persisté) puis attendait le réseau pour la moitié partagée — une page qui arrive en deux
  // temps, d'autant plus visible que la connexion est mauvaise. Volume négligeable (quelques
  // lignes), même durée de vie que le reste.
  'rw_projects', 'rw_projects_stats',
]);

/**
 * Sur le WEB, on retire les deux listes qui peuvent peser lourd (`transactions` et le détail du
 * tableau de bord suit déjà `pilotage_data`, qui est agrégé). L'objectif y est la PREMIÈRE PAGE :
 * afficher l'identité, le thème et les chiffres du tableau de bord sans attendre, pas de servir un
 * historique complet hors-ligne — cas qui, sur navigateur, ne se présente presque jamais.
 */
const WEB_WHITELIST = new Set([
  'pilotage_data', 'profile', 'style_config', 'landing_config', 'accounts', 'reliability_config',
]);

/** Au-delà, on ne persiste pas (évite les erreurs de quota). Le web est plus étroit. */
const MAX_BYTES = 1_500_000;
const WEB_MAX_BYTES = 600_000;

/**
 * Passé ce délai, on n'hydrate plus : mieux vaut un court chargement que des montants d'il y a une
 * semaine affichés comme s'ils étaient d'aujourd'hui. La revalidation de fond (cf. `_layout`) couvre
 * l'écart pour tout ce qui est plus récent.
 */
const MAX_AGE_MS = 1000 * 60 * 60 * 24;

const IS_WEB = Platform.OS === 'web';
const whitelist = () => (IS_WEB ? WEB_WHITELIST : WHITELIST);
const maxBytes = () => (IS_WEB ? WEB_MAX_BYTES : MAX_BYTES);

interface Stored { savedAt: number; state: unknown }

/** localStorage, uniquement s'il est réellement accessible (navigation privée, quota, SSR…). */
function webStore(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch { return null; }
}

/** Clés de premier niveau réellement réhydratées — celles, et uniquement celles, à revalider. */
let hydratedKeys: string[] = [];

/**
 * Ce qui a été restauré depuis le disque au démarrage.
 *
 * Sert à cibler la revalidation de fond : seules les données VENUES DU CACHE peuvent être périmées
 * sans que rien ne le signale. Tout revalider en bloc relancerait aussi des requêtes qui viennent
 * d'arriver du réseau — un aller-retour complet pour rien, au pire moment.
 */
export function getHydratedKeys(): string[] {
  return hydratedKeys;
}

function applyRaw(qc: QueryClient, raw: string | null): void {
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Stored;
    // Format historique (état déshydraté nu, sans horodatage) : on l'ignore plutôt que de deviner
    // son âge — il sera réécrit au format courant dès la première sauvegarde.
    if (!parsed || typeof parsed.savedAt !== 'number' || !parsed.state) return;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return;
    hydrate(qc, parsed.state);
    const queries = (parsed.state as any)?.queries;
    hydratedKeys = Array.isArray(queries)
      ? [...new Set(queries.map((q: any) => String(q?.queryKey?.[0])).filter(Boolean))]
      : [];
  } catch { /* cache corrompu / incompatible : on l'ignore */ }
}

/**
 * À appeler UNE fois au démarrage : réinjecte le cache persisté dans le client react-query.
 *
 * ⚠️ Sur le web, la lecture est faite AVANT le premier `await` — donc de façon synchrone, dans le
 * même tour de boucle que l'appel. C'est ce qui garantit que le cache est en place avant que le
 * premier composant ne monte : une hydratation reportée à une micro-tâche arriverait après les
 * premières requêtes, qui seraient déjà parties au réseau. Tout l'intérêt serait perdu.
 */
export async function hydrateQueryCache(qc: QueryClient): Promise<void> {
  if (IS_WEB) {
    applyRaw(qc, webStore()?.getItem(STORE_KEY) ?? null);
    return;
  }
  try {
    applyRaw(qc, await AsyncStorage.getItem(STORE_KEY));
  } catch { /* stockage indisponible : on repart sans cache */ }
}

/** Démarre la sauvegarde (debouncée) du cache à chaque changement. Retourne un désabonnement. */
export function startQueryPersist(qc: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const list = whitelist();
        const state = dehydrate(qc, {
          shouldDehydrateQuery: (q) =>
            q.state.status === 'success' && list.has(String(q.queryKey?.[0])),
        });
        const raw = JSON.stringify({ savedAt: Date.now(), state } satisfies Stored);
        if (raw.length > maxBytes()) return; // trop volumineux → on saute cette sauvegarde
        if (IS_WEB) webStore()?.setItem(STORE_KEY, raw);
        else await AsyncStorage.setItem(STORE_KEY, raw);
      } catch { /* écriture impossible (quota, mode privé) : sans gravité, on réessaiera */ }
    }, 1500);
  };
  return qc.getQueryCache().subscribe(save);
}
