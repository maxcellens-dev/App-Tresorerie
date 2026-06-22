/**
 * OTA — application de la mise à jour Expo dès la PREMIÈRE réouverture (Option B).
 * ──────────────────────────────────────────────────────────────────────────────
 * Par défaut DÉSACTIVÉ. Tant que `OTA_UPDATE_ON_LAUNCH_ENABLED` vaut `false`, cette
 * fonction ne fait STRICTEMENT RIEN (retour immédiat à la 1ʳᵉ ligne) → aucun impact
 * sur les builds et OTA actuels, aucun risque de crash.
 *
 * Quand activé : au lancement, on vérifie s'il existe une mise à jour OTA, on la télécharge
 * et on recharge l'app — le tout DERRIÈRE le splash animé, donc transition invisible (l'app
 * apparaît directement sur la nouvelle version). Ne s'exécute qu'en build natif de production
 * (`Updates.isEnabled`), jamais sur le web ni en dev (Expo Go / dev client).
 *
 * ⚠️ NE PAS activer tant qu'un build natif contenant ce code n'a pas été publié puis testé.
 *    Pour activer : passer `OTA_UPDATE_ON_LAUNCH_ENABLED` à `true` (ça part ensuite en OTA).
 */
import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

/** Interrupteur principal. `false` = comportement actuel inchangé (no-op total). */
export const OTA_UPDATE_ON_LAUNCH_ENABLED = true;

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
