/**
 * OTA — application de la mise à jour Expo au lancement.
 * ──────────────────────────────────────────────────────────────────────────────
 * ⚠️ DÉSACTIVÉ volontairement (`OTA_UPDATE_ON_LAUNCH_ENABLED = false`).
 *
 * Pourquoi : recharger l'app depuis le JS (`reloadAsync`) en parallèle du téléchargement
 * natif déclenché au lancement provoquait la FERMETURE de l'app (deux mécanismes de mise à
 * jour concurrents + reload en plein boot). C'est désormais le NATIF qui gère tout, via
 * `updates.fallbackToCacheTimeout` dans app.json : au lancement, le natif attend (derrière le
 * splash) qu'une éventuelle mise à jour soit téléchargée puis démarre directement dessus →
 * mise à jour appliquée DÈS la 1ʳᵉ ouverture, sans reload JS, sans crash.
 *
 * Cette fonction reste un no-op (filet de sécurité). NE PAS la réactiver : elle réintroduirait
 * le conflit de reload. Le réglage du délai d'attente se fait dans app.json (côté natif, donc
 * effectif au prochain build).
 */
import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

/** `false` = aucun reload JS (le natif gère la mise à jour au lancement). NE PAS repasser à `true`. */
export const OTA_UPDATE_ON_LAUNCH_ENABLED = false;

let alreadyRan = false;

/**
 * À appeler une fois au démarrage. Si une mise à jour OTA est dispo, la télécharge et recharge
 * l'app sur la nouvelle version. Tout échec (réseau lent/indispo) est ignoré : on démarre alors
 * normalement sur la version en cache.
 */
export async function maybeApplyUpdateOnLaunch(): Promise<void> {
  if (!OTA_UPDATE_ON_LAUNCH_ENABLED) return; // désactivé → ne rien faire
  if (Platform.OS === 'web') return;         // web toujours à jour
  if (!Updates.isEnabled) return;            // dev / Expo Go → updates inactifs
  if (alreadyRan) return;                    // une seule tentative par session
  alreadyRan = true;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync(); // relance sur la nouvelle version (le splash masque la bascule)
  } catch {
    // Réseau lent / indisponible / erreur : on ignore et on démarre sur la version en cache.
  }
}
