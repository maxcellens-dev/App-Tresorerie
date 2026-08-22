/**
 * GamificationSync — au chargement de l'app : valide la SEMAINE DE CONNEXION (venir au moins une
 * fois entre lundi et dimanche suffit), puis (ré)évalue les succès.
 * Monté une fois (dans le layout racine). Sans effet si la gamification est désactivée en admin.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTransactions } from '../../hooks/data/useTransactions';
import { useGamification } from '../../hooks/engagement/useGamification';
import { useGamificationConfig } from '../../hooks/engagement/useGamificationConfig';
import { useMonthlyClosure } from '../../hooks/pilotage/useMonthlyClosure';
import { useProfile } from '../../hooks/data/useProfile';
import { useOnboarding } from '../../hooks/engagement/useOnboarding';
import { type BadgeContext } from '../../lib/engagement/gamification';
/* Le calcul des métriques vit dans lib/engagement/badgeMetrics : il est PARTAGÉ avec l'écran
   Succès, qui s'en sert pour afficher la progression « 7/12 ». Écrit deux fois, il divergeait —
   la barre affichée ne mesurait pas tout à fait ce que le déblocage testait. */
import { buildBadgeMetrics } from '../../lib/engagement/badgeMetrics';
import { isUploadedAvatar } from '../../services/avatarService';

export default function GamificationSync() {
  const { user, isImpersonating } = useAuth();
  const { data: config } = useGamificationConfig();
  const { data: transactions = [], isLoading: txLoading } = useTransactions(user?.id);
  const { enabled: closureEnabled, closures } = useMonthlyClosure(user?.id);
  const { data: profile } = useProfile(user?.id);
  const { allDone: onboardingDone } = useOnboarding(user?.id);
  const { state, validateWeek, recordLogin } = useGamification(user?.id);
  const ranFor = useRef<string | null>(null);

  /**
   * Contexte COMPLET des métriques de succès calculables côté client.
   * Volontairement mémoïsé sur ses vraies sources (dont `transactions`) : c'est lui qui pilote la
   * réévaluation. Les métriques portées par l'état de gamification (séries, relyks cumulés) ne sont
   * PAS mises ici — `evaluate()` les relit à la source (DB), plus fraîches que le cache.
   */
  const ctx = useMemo<BadgeContext | null>(() => {
    if (!user?.id || txLoading) return null; // attendre les transactions (vide = OK)
    return buildBadgeMetrics({
      transactions,
      closures,
      createdAt: (profile as any)?.created_at ?? (user as any)?.created_at ?? null,
      // Succès « photo de profil » : seulement une image TÉLÉVERSÉE (pas l'avatar Google seedé à la création).
      profilePhoto: isUploadedAvatar((profile as any)?.avatar_url),
      onboardingDone,
    });
  }, [user?.id, txLoading, transactions, profile, closures, onboardingDone]);

  useEffect(() => {
    if (isImpersonating) return; // pas d'effet de bord gamification en mode consultation admin
    if (!user?.id || !config?.identity.enabled || !ctx) return;

    // Signature dérivée des MÉTRIQUES ELLES-MÊMES (et non d'une liste d'entrées choisie à la main) :
    // dès qu'une valeur bouge — même sans changer le nombre de transactions (ex. une transaction
    // éditée qui devient un virement d'investissement) — l'évaluation est relancée. On y ajoute les
    // métriques de l'état (relyks cumulés, séries) : un achat de relyks doit débloquer aussitôt.
    const sig = [
      user.id, JSON.stringify(ctx),
      state?.gems_earned_total ?? -1, state?.login_streak ?? -1,
      state?.streak ?? -1, state?.last_validated_week ?? '',
    ].join('|');
    if (ranFor.current === sig) return;
    ranFor.current = sig;

    const opts = { closureEnabled: !!closureEnabled };
    (async () => {
      try {
        await recordLogin(); // série quotidienne (avant l'évaluation des badges)
        // Série hebdo : la VISITE de la semaine suffit à la valider (+1, sans condition — elle ne
        // redescend jamais). `validateWeek` enchaîne sur l'évaluation des succès.
        await validateWeek(ctx, opts);
      } catch { ranFor.current = null; }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, state, user?.id, config?.identity.enabled, closureEnabled, isImpersonating]);

  return null;
}
