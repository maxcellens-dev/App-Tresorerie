/**
 * GamificationSync — au chargement de l'app : valide la série hebdo si l'utilisateur a été
 * actif cette semaine (au moins une transaction saisie), puis (ré)évalue les succès.
 * Monté une fois (dans le layout racine). Sans effet si la gamification est désactivée en admin.
 */
import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTransactions } from '../hooks/useTransactions';
import { useGamification } from '../hooks/useGamification';
import { useGamificationConfig } from '../hooks/useGamificationConfig';
import { useMonthlyClosure } from '../hooks/useMonthlyClosure';
import { useProfile } from '../hooks/useProfile';
import { useOnboarding } from '../hooks/useOnboarding';
import { mondayOf, type BadgeContext } from '../lib/gamification';

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
  const { user } = useAuth();
  const { data: config } = useGamificationConfig();
  const { data: transactions = [], isLoading: txLoading } = useTransactions(user?.id);
  const { enabled: closureEnabled } = useMonthlyClosure(user?.id);
  const { data: profile } = useProfile(user?.id);
  const { allDone: onboardingDone } = useOnboarding(user?.id);
  const { validateWeek, evaluate, recordLogin } = useGamification(user?.id);
  const ranFor = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || !config?.identity.enabled) return;
    if (ranFor.current === user.id) return;
    if (txLoading) return; // attendre la fin du chargement des transactions (vide = OK)
    ranFor.current = user.id;

    const monday = mondayOf(new Date());
    const activeThisWeek = transactions.some(
      (t: any) => typeof t.created_at === 'string' && t.created_at >= `${monday}T00:00:00`,
    );
    // Contexte des métriques « classiques » (ancienneté, photo, guide). La série de
    // connexion quotidienne est renseignée par recordLogin et relue dans evaluate().
    const createdAt = (profile as any)?.created_at ?? (user as any)?.created_at ?? null;
    const accountAgeDays = createdAt ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000) : 0;
    const ctx: BadgeContext = {
      ...buildContext(transactions),
      account_age_days: accountAgeDays,
      profile_photo: (profile as any)?.avatar_url ? 1 : 0,
      onboarding_done: onboardingDone ? 1 : 0,
    };
    const opts = { closureEnabled: !!closureEnabled };
    (async () => {
      try {
        await recordLogin(); // série quotidienne (avant l'évaluation des badges)
        if (activeThisWeek) await validateWeek(ctx, opts);
        else await evaluate(ctx, opts);
      } catch { ranFor.current = null; }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, config?.identity.enabled, closureEnabled, txLoading, profile, onboardingDone]);

  return null;
}
