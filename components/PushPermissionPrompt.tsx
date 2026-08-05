/**
 * PushPermissionPrompt — demande l'autorisation de notifier UNE SEULE FOIS, au premier lancement.
 *
 * Pourquoi ici, et pas au moment de l'enregistrement du jeton :
 * `PushRegistrar` n'agit qu'une fois l'utilisateur CONNECTÉ et son profil chargé. Résultat, un
 * nouveau venu pouvait traverser toute la découverte sans que le téléphone lui ait jamais posé la
 * question — puis trouver un interrupteur « Notifications » allumé dans ses paramètres alors
 * qu'Android n'avait rien autorisé. La question doit être posée au premier lancement, connecté ou
 * non, exactement comme le fait n'importe quelle app.
 *
 * Trois garde-fous :
 *   • APRÈS le splash (`onAppReady`) — une boîte de dialogue système par-dessus l'écran de
 *     démarrage se lit comme un bug, et l'utilisateur refuse par réflexe ;
 *   • UNE SEULE FOIS, mémorisé sur l'appareil : un refus ne se redemande jamais (l'OS ne le
 *     permettrait pas de toute façon, et harceler est le meilleur moyen de se faire désinstaller) ;
 *   • seulement si l'état est `undetermined` — rien à demander si c'est déjà accordé ou refusé.
 */
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PUSH_SUPPORTED, getPushPermissionAsync, requestPushPermissionAsync } from '../lib/pushNotifications';
import { onAppReady } from '../lib/splashGate';

/** Clé versionnée : si un jour on veut re-poser la question, on incrémente plutôt que d'effacer. */
const ASKED_KEY = 'push_permission_asked_v1';

export default function PushPermissionPrompt() {
  useEffect(() => {
    if (!PUSH_SUPPORTED) return;
    let cancelled = false;

    const unsubscribe = onAppReady(() => {
      (async () => {
        try {
          if (cancelled) return;
          const asked = await AsyncStorage.getItem(ASKED_KEY);
          if (asked || cancelled) return;

          const current = await getPushPermissionAsync();
          /* On marque « demandé » quel que soit le résultat, y compris quand il n'y avait rien à
             demander : ce drapeau signifie « la question a été traitée », pas « l'utilisateur a
             répondu oui ». Sans ça, un simulateur ou un refus antérieur relancerait la logique à
             chaque lancement. */
          await AsyncStorage.setItem(ASKED_KEY, new Date().toISOString());
          if (current !== 'undetermined' || cancelled) return;

          await requestPushPermissionAsync();
        } catch {
          /* Best-effort : ne JAMAIS faire échouer un lancement d'app pour une demande d'autorisation.
             Le drapeau n'ayant pas été posé en cas d'erreur précoce, la tentative se refera. */
        }
      })();
    });

    return () => { cancelled = true; unsubscribe(); };
  }, []);

  return null;
}
