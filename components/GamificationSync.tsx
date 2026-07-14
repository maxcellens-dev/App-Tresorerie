/**
 * GamificationSync — au chargement de l'app : valide la SEMAINE DE CONNEXION (venir au moins une
 * fois entre lundi et dimanche suffit), puis (ré)évalue les succès.
 * Monté une fois (dans le layout racine). Sans effet si la gamification est désactivée en admin.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTransactions } from '../hooks/useTransactions';
import { useGamification } from '../hooks/useGamification';
import { useGamificationConfig } from '../hooks/useGamificationConfig';
import { useMonthlyClosure, addMonthKey } from '../hooks/useMonthlyClosure';
import { useProfile } from '../hooks/useProfile';
import { useOnboarding } from '../hooks/useOnboarding';
import { usePulseSnapshots, computeGreenWeekStreak } from '../hooks/usePulseState';
import { type BadgeContext } from '../lib/gamification';
import { isUploadedAvatar } from '../services/avatarService';

/** Construit le contexte des métriques calculables depuis les transactions. */
function buildContext(transactions: any[]): BadgeContext {
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // invest_followed : nb de virements vers un compte d'investissement (reco suivie)
  let investFollowed = 0;
  const netByMonth: Record<string, number> = {};
  for (const t of transactions) {
    if ((t as any).is_draft) continue;
    if (t.account?.type !== 'checking') continue;
    const amt = Number(t.amount);
    if (t.linked_account?.type === 'investment' && amt < 0) investFollowed += 1;
    const mk = (t.date ?? '').slice(0, 7);
    if (mk && mk < currentMonthKey) netByMonth[mk] = (netByMonth[mk] ?? 0) + amt;
  }

  // surplus_months_streak : mois PASSÉS consécutifs (du plus récent au plus ancien) à solde net > 0
  const pastMonths = Object.keys(netByMonth).sort().reverse();
  let streak = 0;
  for (const mk of pastMonths) {
    if (netByMonth[mk] > 0) streak += 1;
    else break;
  }

  return { invest_followed: investFollowed, surplus_months_streak: streak };
}

export default function GamificationSync() {
  const { user, isImpersonating } = useAuth();
  const { data: config } = useGamificationConfig();
  const { data: transactions = [], isLoading: txLoading } = useTransactions(user?.id);
  const { enabled: closureEnabled, closures } = useMonthlyClosure(user?.id);
  const { data: profile } = useProfile(user?.id);
  const { allDone: onboardingDone } = useOnboarding(user?.id);
  const { data: pulseSnapshots = [] } = usePulseSnapshots(user?.id);
  const { state, validateWeek, evaluate, recordLogin, streakLoss } = useGamification(user?.id);
  const ranFor = useRef<string | null>(null);

  /**
   * Contexte COMPLET des métriques de succès calculables côté client.
   * Volontairement mémoïsé sur ses vraies sources (dont `transactions`) : c'est lui qui pilote la
   * réévaluation. Les métriques portées par l'état de gamification (séries, relyks cumulés) ne sont
   * PAS mises ici — `evaluate()` les relit à la source (DB), plus fraîches que le cache.
   */
  const ctx = useMemo<BadgeContext | null>(() => {
    if (!user?.id || txLoading) return null; // attendre les transactions (vide = OK)
    const createdAt = (profile as any)?.created_at ?? (user as any)?.created_at ?? null;
    const accountAgeDays = createdAt ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000) : 0;
    // Fiabilité (clôtures) : total confirmé + plus longue série de mois consécutifs.
    const confirmedKeys = (closures ?? [])
      .filter((c: any) => (c.status ?? 'confirmed') === 'confirmed')
      .map((c: any) => c.month_key as string)
      .sort();
    let bestRun = 0, run = 0;
    for (let i = 0; i < confirmedKeys.length; i++) {
      run = i > 0 && confirmedKeys[i] === addMonthKey(confirmedKeys[i - 1], 1) ? run + 1 : 1;
      if (run > bestRun) bestRun = run;
    }
    return {
      ...buildContext(transactions),
      account_age_days: accountAgeDays,
      // Succès « photo de profil » : seulement une image TÉLÉVERSÉE (pas l'avatar Google seedé à la création).
      profile_photo: isUploadedAvatar((profile as any)?.avatar_url) ? 1 : 0,
      onboarding_done: onboardingDone ? 1 : 0,
      closures_count: confirmedKeys.length,
      consecutive_closures: bestRun,
      // Le Pouls : semaines consécutives où TOUS les signaux étaient au vert (bilans archivés).
      pulse_green_weeks: computeGreenWeekStreak(pulseSnapshots),
    };
  }, [user?.id, txLoading, transactions, profile, closures, onboardingDone, pulseSnapshots]);

  useEffect(() => {
    if (isImpersonating) return; // pas d'effet de bord gamification en mode consultation admin
    if (!user?.id || !config?.identity.enabled || !ctx) return;

    // Signature dérivée des MÉTRIQUES ELLES-MÊMES (et non d'une liste d'entrées choisie à la main) :
    // dès qu'une valeur bouge — même sans changer le nombre de transactions (ex. une transaction
    // éditée qui devient un virement d'investissement) — l'évaluation est relancée. On y ajoute les
    // métriques de l'état (relyks cumulés, séries) : un achat de relyks doit débloquer aussitôt.
    // `streak` / `last_validated_week` en font partie : après un rachat ou un refus de série, la
    // semaine en cours doit être validée dans la foulée (sinon il faudrait relancer l'app).
    const sig = [
      user.id, JSON.stringify(ctx),
      state?.gems_earned_total ?? -1, state?.login_streak ?? -1, state?.best_streak ?? -1,
      state?.streak ?? -1, state?.last_validated_week ?? '', streakLoss ? 1 : 0,
    ].join('|');
    if (ranFor.current === sig) return;
    ranFor.current = sig;

    const opts = { closureEnabled: !!closureEnabled };
    (async () => {
      try {
        await recordLogin(); // série quotidienne (avant l'évaluation des badges)
        // Série hebdo : la VISITE de la semaine suffit à la valider. Exception : tant qu'une perte
        // de série attend une décision (modale de rachat), on ne valide pas — valider remettrait la
        // série à 1 dans le dos de l'utilisateur, avant qu'il ait pu la racheter.
        if (streakLoss) await evaluate(ctx, opts);
        else await validateWeek(ctx, opts);
      } catch { ranFor.current = null; }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, streakLoss, state, user?.id, config?.identity.enabled, closureEnabled, isImpersonating]);

  return null;
}
