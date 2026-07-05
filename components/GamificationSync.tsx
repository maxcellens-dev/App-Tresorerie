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
import { useMonthlyClosure, addMonthKey } from '../hooks/useMonthlyClosure';
import { useProfile } from '../hooks/useProfile';
import { useOnboarding } from '../hooks/useOnboarding';
import { mondayOf, type BadgeContext } from '../lib/gamification';
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
  const { validateWeek, evaluate, recordLogin } = useGamification(user?.id);
  const ranFor = useRef<string | null>(null);

  useEffect(() => {
    if (isImpersonating) return; // pas d'effet de bord gamification en mode consultation admin
    if (!user?.id || !config?.identity.enabled) return;
    if (txLoading) return; // attendre la fin du chargement des transactions (vide = OK)

    const monday = mondayOf(new Date());
    const activeThisWeek = transactions.some(
      (t: any) => typeof t.created_at === 'string' && t.created_at >= `${monday}T00:00:00`,
    );
    // Signature des métriques déclencheuses : on RÉÉVALUE dès qu'une d'elles change (ex. photo de
    // profil ajoutée après le 1er passage). Un simple verrou par user.id ne débloquait le succès
    // qu'au prochain lancement de l'app.
    const avatarPresent = (profile as any)?.avatar_url ? 1 : 0;
    const sig = [user.id, avatarPresent, onboardingDone ? 1 : 0, (closures ?? []).length, transactions.length, activeThisWeek ? 1 : 0].join('|');
    if (ranFor.current === sig) return;
    ranFor.current = sig;
    // Contexte des métriques « classiques » (ancienneté, photo, guide). La série de
    // connexion quotidienne est renseignée par recordLogin et relue dans evaluate().
    const createdAt = (profile as any)?.created_at ?? (user as any)?.created_at ?? null;
    const accountAgeDays = createdAt ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000) : 0;
    // Métriques de fiabilité (clôtures) : total confirmé + plus longue série de mois consécutifs.
    const confirmedKeys = (closures ?? [])
      .filter((c: any) => (c.status ?? 'confirmed') === 'confirmed')
      .map((c: any) => c.month_key as string)
      .sort();
    let bestRun = 0, run = 0;
    for (let i = 0; i < confirmedKeys.length; i++) {
      run = i > 0 && confirmedKeys[i] === addMonthKey(confirmedKeys[i - 1], 1) ? run + 1 : 1;
      if (run > bestRun) bestRun = run;
    }
    const ctx: BadgeContext = {
      ...buildContext(transactions),
      account_age_days: accountAgeDays,
      // Succès « photo de profil » : seulement une image TÉLÉVERSÉE (pas l'avatar Google seedé à la création).
      profile_photo: isUploadedAvatar((profile as any)?.avatar_url) ? 1 : 0,
      onboarding_done: onboardingDone ? 1 : 0,
      closures_count: confirmedKeys.length,
      consecutive_closures: bestRun,
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
  }, [user?.id, config?.identity.enabled, closureEnabled, txLoading, profile, onboardingDone, closures]);

  return null;
}
