/**
 * queryPersist — persistance LOCALE (natif) du cache react-query des requêtes essentielles, pour que
 * l'app affiche les dernières données connues MÊME HORS-LIGNE (au lieu d'un écran vide).
 *
 * Approche volontairement conservatrice :
 *  - liste blanche de clés (dashboard, profil, style/thème…) → borne la taille et le risque ;
 *  - uniquement les requêtes réussies ;
 *  - écriture debouncée ; lecture unique au démarrage ;
 *  - tout est enrobé de try/catch : en cas de souci, on repart simplement sans cache (jamais de crash).
 * Web exclu : le navigateur gère déjà son cache et localStorage est trop limité pour ces volumes.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';

const STORE_KEY = 'relyka.rq.cache.v1';
// Ce qui vaut la peine d'être revu hors-ligne : tableau de bord + identité + thème/style.
const WHITELIST = new Set([
  'pilotage_data', 'profile', 'style_config', 'landing_config', 'accounts', 'transactions',
  // Réglages de fiabilité (minuscules) : indispensables dès la 1ʳᵉ frame, sinon la carte Relyka
  // affiche un montant sec puis bascule en fourchette quand la config arrive du réseau.
  'reliability_config',
]);
// Au-delà, on ne persiste pas (évite les erreurs de taille d'AsyncStorage sur gros historiques).
const MAX_BYTES = 1_500_000;

const IS_NATIVE = Platform.OS !== 'web';

/** À appeler UNE fois au démarrage : réinjecte le cache persisté dans le client react-query. */
export async function hydrateQueryCache(qc: QueryClient): Promise<void> {
  if (!IS_NATIVE) return;
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return;
    hydrate(qc, JSON.parse(raw));
  } catch { /* cache corrompu / incompatible : on l'ignore */ }
}

/** Démarre la sauvegarde (debouncée) du cache à chaque changement. Retourne un désabonnement. */
export function startQueryPersist(qc: QueryClient): () => void {
  if (!IS_NATIVE) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const state = dehydrate(qc, {
          shouldDehydrateQuery: (q) =>
            q.state.status === 'success' && WHITELIST.has(String(q.queryKey?.[0])),
        });
        const raw = JSON.stringify(state);
        if (raw.length > MAX_BYTES) return; // trop volumineux → on saute cette sauvegarde
        await AsyncStorage.setItem(STORE_KEY, raw);
      } catch { /* écriture impossible : sans gravité, on réessaiera au prochain changement */ }
    }, 1500);
  };
  return qc.getQueryCache().subscribe(save);
}
