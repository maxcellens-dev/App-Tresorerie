// Assemble les signaux de l'app → LA prochaine action utile (via appStateEngine).
import { useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePilotageData } from '../pilotage/usePilotageData';
import { useAllAccounts } from '../data/useAccounts';
import { useTransactions } from '../data/useTransactions';
import { useMonthlyClosure } from '../pilotage/useMonthlyClosure';
import { useSharedContribution } from '../data/useSharedContribution';
import { useOnboarding } from './useOnboarding';
import { useAppLockPrompt } from '../platform/useAppLockPrompt';
import { monthlyEquivalent } from '../../lib/finance/recurrence';
import { getCurrentAction, type AppAction } from '../../lib/engagement/appStateEngine';

export function useAppState(): AppAction | null {
  const { user, isImpersonating } = useAuth();
  const { data: pilotage } = usePilotageData(user?.id);
  const { data: accounts = [], isSuccess: accountsReady } = useAllAccounts(user?.id);
  const { data: transactions = [], isSuccess: txReady } = useTransactions(user?.id);
  const { enabled: closureEnabled, pendingMonths } = useMonthlyClosure(user?.id);
  const { data: sharedContrib } = useSharedContribution(user?.id);
  const { allDone: onboardingDone } = useOnboarding(user?.id);
  /* Proposition du verrouillage biométrique. Elle attendait la fermeture du modal de présentation
     du Pilotage — ce modal n'existe plus (plus aucune présentation en pop-up) : il ne reste que la
     garde qui compte vraiment, la consultation admin (le verrou est local à l'appareil). */
  const { offer: appLockOffer } = useAppLockPrompt();
  const offerAppLock = appLockOffer && !isImpersonating;

  return useMemo(() => {
    if (!pilotage) return null;
    // Tant que comptes ET transactions ne sont pas RÉELLEMENT chargés, les signaux de setup
    // (« Ajoute ton revenu principal », « Ajoute tes charges fixes »…) seraient calculés sur des
    // listes vides → bandeau faux qui disparaît une seconde plus tard. On attend le succès des deux
    // requêtes (isSuccess, jamais isFetched : une erreur ne doit pas passer pour « aucune donnée »).
    if (!accountsReady || !txReady) return null;

    const txs = transactions as any[];
    const hasIncome =
      pilotage.expected_income_source !== 'none' ||
      txs.some((t) => Number(t.amount) > 0 && t.is_recurring && !t.linked_account_id);
    const hasFixed = txs.some(
      (t) => Number(t.amount) < 0 && t.is_recurring && !t.linked_account_id && !t.project_id,
    );

    // Compte partagé/joint sans mode défini (à qualifier une fois ; on ignore les comptes en consultation).
    const sharedNoMode = (accounts as any[]).find(
      (a) =>
        (a.is_joint || (a.profile_id && a.profile_id !== user?.id)) &&
        a.shared_mode == null &&
        a._role !== 'read',
    );
    const sharedModePrompt = sharedNoMode ? { accountId: sharedNoMode.id, name: sharedNoMode.name } : null;

    // Surveillance de niveau (mode Contribution) : le solde prévisionnel du joint passe-t-il < 0 ?
    // Soldes et flux sont pondérés par le même facteur → le SIGNE du prévisionnel est préservé.
    let jointLow: { accountId: string; name: string } | null = null;
    // Facteur PARTAGÉ (lib/finance/recurrence) : il valait 4.33 ici et 52/12 dans le snapshot IA,
    // pour la même question — « combien cette récurrente pèse-t-elle par mois ? ».
    const perMonth = monthlyEquivalent;
    for (const a of (sharedContrib?.accounts ?? []) as any[]) {
      if (sharedContrib?.modeByAccount?.[a.id] !== 'contribution') continue;
      let net = 0;
      for (const t of (sharedContrib?.transactions ?? []) as any[]) {
        if (t.account_id !== a.id || !t.is_recurring || !t.recurrence_rule) continue;
        net += perMonth(t.recurrence_rule, Number(t.amount));
      }
      if (Number(a.balance) + net < 0) { jointLow = { accountId: a.id, name: a.name }; break; }
    }

    /* Aucun signal de SOLDE ici (ni « Renseigne ton solde », ni « Vérifie ton solde ») : la carte
       « Ton Relyka » porte déjà le badge « Estimation » et son bouton de mise à jour. Le doute n'a
       donc plus besoin d'être calculé pour ce bandeau. */
    const action = getCurrentAction({
      hasIncome,
      hasFixed,
      pendingClosureMonth: pendingMonths[0] ?? null,
      sharedModePrompt,
      offerAppLock,
      jointLow,
      closureEnabled,
    });
    // (Le cas « tout est à jour » n'existe plus : rien à signaler = aucun bandeau.)
    if (!action) return null;
    // Pendant le guide « Pour bien démarrer », les étapes de setup sont déjà raillées par le guide
    // → pas de double sollicitation (le bandeau reprendra pour le quotidien une fois le guide fini).
    if (action.type === 'setup' && !onboardingDone) return null;
    return action;
  }, [pilotage, accounts, transactions, accountsReady, txReady, pendingMonths, closureEnabled, sharedContrib, onboardingDone, offerAppLock, user?.id]);
}
