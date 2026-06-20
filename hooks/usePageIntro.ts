/**
 * usePageIntro — présentation « 1ʳᵉ visite » d'une page (modal centré).
 * Lit/écrit le drapeau `intro_seen_<key>` dans profiles.onboarding_state.
 * Une fois fermé, ne revient plus (sauf relance du tuto depuis le support, qui remet tous les drapeaux à false).
 */
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from './useProfile';
import { useUpdateOnboarding, type PageIntroKey } from './useOnboarding';

export function usePageIntro(pageKey: PageIntroKey) {
  const { user, isImpersonating } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const update = useUpdateOnboarding(user?.id);

  const state = ((profile as any)?.onboarding_state ?? {}) as Record<string, boolean>;
  // En consultation admin : on considère la présentation comme « déjà vue » → elle ne s'ouvre
  // jamais et aucun drapeau n'est écrit sur le compte cible.
  const seen = isImpersonating || Boolean(state['intro_seen_' + pageKey]);
  // On ne propose la présentation qu'une fois le profil chargé (évite un flash avant lecture).
  const ready = !!profile;

  const dismiss = () => {
    update.mutate({ flags: { [('intro_seen_' + pageKey) as any]: true } });
  };

  return { seen, ready, dismiss };
}
