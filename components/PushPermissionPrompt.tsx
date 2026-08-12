/**
 * PushPermissionPrompt — demande l'autorisation de notifier UNE SEULE FOIS, une fois que
 * l'utilisateur a de quoi comprendre à quoi elle sert.
 *
 * Le problème d'origine reste vrai : `PushRegistrar` n'agit qu'une fois l'utilisateur CONNECTÉ et
 * son profil chargé, si bien qu'un nouveau venu pouvait traverser toute la découverte sans que le
 * téléphone lui ait jamais posé la question — puis trouver un interrupteur « Notifications » allumé
 * dans ses paramètres alors qu'Android n'avait rien autorisé. Il fallait donc bien poser la
 * question de façon systématique.
 *
 * Mais la poser au TOUT PREMIER lancement était un mauvais calcul : une autorisation demandée avant
 * d'avoir montré la moindre valeur se refuse par réflexe — et sur iOS comme sur Android, un refus
 * est DÉFINITIF depuis l'app (seuls les réglages système peuvent revenir dessus). On brûlait notre
 * unique cartouche au pire moment. On attend donc que le parcours de démarrage soit passé : à cet
 * instant, l'utilisateur a créé ses comptes et ses récurrences, il sait ce que l'app suit pour lui,
 * et « te prévenir » a un sens.
 *
 * Garde-fous conservés :
 *   • APRÈS le splash (`onAppReady`) — une boîte de dialogue système par-dessus l'écran de
 *     démarrage se lit comme un bug, et l'utilisateur refuse par réflexe ;
 *   • UNE SEULE FOIS, mémorisé sur l'appareil : un refus ne se redemande jamais (l'OS ne le
 *     permettrait pas de toute façon, et harceler est le meilleur moyen de se faire désinstaller) ;
 *   • seulement si l'état est `undetermined` — rien à demander si c'est déjà accordé ou refusé.
 *
 * Il reste un second chemin, volontaire celui-là : l'interrupteur « Notifications » des paramètres,
 * qui demande l'autorisation au moment où l'utilisateur l'active lui-même (cf. usePushPermission).
 */
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PUSH_SUPPORTED, getPushPermissionAsync, requestPushPermissionAsync } from '../lib/pushNotifications';
import { onAppReady } from '../lib/splashGate';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../hooks/useProfile';
import { isGuideInPlay } from '../lib/guideStages';

/** Clé versionnée : si un jour on veut re-poser la question, on incrémente plutôt que d'effacer. */
const ASKED_KEY = 'push_permission_asked_v1';

export default function PushPermissionPrompt() {
  const { user, isImpersonating } = useAuth();
  const { data: profile } = useProfile(user?.id);

  /* « Le parcours de démarrage est-il encore en cours ? » — même prédicat que le guide lui-même
     (lib/guideStages), pour que les deux ne puissent pas diverger. Un compte déjà installé
     (app_tour_done / discovery_intro_seen) n'est jamais « en parcours » : il est donc éligible
     immédiatement, sans attendre un drapeau qu'il n'aura jamais.
     ⚠️ En consultation admin, on ne demande RIEN : la boîte de dialogue s'afficherait sur
     l'appareil de l'admin au nom d'un compte qui n'est pas le sien. */
  const guidePending = isGuideInPlay({
    hasProfile: !!profile,
    isImpersonating,
    flags: ((profile as any)?.onboarding_state ?? {}) as any,
    appTourDone: Boolean((profile as any)?.app_tour_done),
    discoveryIntroSeen: Boolean(((profile as any)?.onboarding_state ?? {}).discovery_intro_seen),
    // Champs sans effet sur ce prédicat (il ne lit que le profil) — valeurs neutres.
    dataReady: true, accountsSettled: true, txSettled: true,
    accountsCount: 0, hasChecking: false, hasSavings: false, hasRecurring: false,
  });
  const ready = !!profile && !isImpersonating && !guidePending;

  useEffect(() => {
    if (!PUSH_SUPPORTED || !ready) return;
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
  }, [ready]);

  return null;
}
