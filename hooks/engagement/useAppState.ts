// Assemble les signaux de l'app → LA prochaine action utile (via appStateEngine).
import { useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePilotageData } from '../pilotage/usePilotageData';
import { useAllAccounts } from '../data/useAccounts';
import { useTransactions } from '../data/useTransactions';
import { useMonthlyClosure } from '../pilotage/useMonthlyClosure';
import { useSharedContribution } from '../data/useSharedContribution';
import { usePreSavings } from '../data/usePreSavings';
import { useReservations } from '../data/useReservations';
import { useOnboarding } from './useOnboarding';
import { useAppLockPrompt } from '../platform/useAppLockPrompt';
import { useReliabilityConfig, deriveRelykaConfidence } from '../pilotage/useReliability';
import { monthlyEquivalent } from '../../lib/finance/recurrence';
import { computeRelyka } from '../../lib/finance/relyka';
import { monthReservationsTotal } from '../../lib/finance/pilotageView';
import { isRegul } from '../../lib/finance/regul';
import { getCurrentAction, type AppAction } from '../../lib/engagement/appStateEngine';
import { CURRENCY_SYMBOL, floorToTen } from '../../lib/finance/currency';

export function useAppState(): AppAction | null {
  const { user, isImpersonating } = useAuth();
  const { data: pilotage } = usePilotageData(user?.id);
  const { data: accounts = [], isSuccess: accountsReady } = useAllAccounts(user?.id);
  const { data: transactions = [], isSuccess: txReady } = useTransactions(user?.id);
  const { enabled: closureEnabled, pendingMonths } = useMonthlyClosure(user?.id);
  const { data: sharedContrib } = useSharedContribution(user?.id);
  const { data: preSavings } = usePreSavings(user?.id);
  const { data: reservations = [] } = useReservations(user?.id);
  const { data: relCfg } = useReliabilityConfig();
  const { allDone: onboardingDone } = useOnboarding(user?.id);
  /* Proposition du verrouillage biométrique. Elle attendait la fermeture du modal de présentation
     du Pilotage — ce modal n'existe plus (plus aucune présentation en pop-up) : il ne reste que la
     garde qui compte vraiment, la consultation admin (le verrou est local à l'appareil). */
  const { offer: appLockOffer } = useAppLockPrompt();
  const offerAppLock = appLockOffer && !isImpersonating;

  return useMemo(() => {
    if (!pilotage) return null;
    // Tant que comptes ET transactions ne sont pas RÉELLEMENT chargés, les signaux de setup
    // (« Renseigne ton solde », « Ajoute tes charges fixes »…) seraient calculés sur des listes vides
    // → bandeau faux qui disparaît une seconde plus tard. On attend le succès des deux requêtes
    // (isSuccess, jamais isFetched : une erreur ne doit pas passer pour « aucune donnée »).
    if (!accountsReady || !txReady) return null;
    // Relyka AFFICHÉ = même formule que le Pilotage (« Ton Relyka » / budget libre) — pas safe_to_spend,
    // qui est un agrégat différent : le bandeau doit annoncer le MÊME montant que la carte.
    /* Mois LOCAL des réservations + soustraction PARTAGÉE (lib/relyka, lib/pilotageView) : cette
       formule à huit termes était recopiée ici, avec un découpage de date en UTC. Deux écarts en
       découlaient — un terme ajouté au Relyka manquait dans le bandeau, et une réservation posée
       dans les premières heures d'un mois n'y était pas comptée. Le bandeau annonçait alors un
       montant que le tableau de bord, juste en dessous, contredisait. */
    const reservationsTotal = monthReservationsTotal(reservations as any[]);
    const cumulsTotal = (preSavings?.epargne.total_cumule ?? 0) + (preSavings?.invest.total_cumule ?? 0);
    const relyka = computeRelyka({
      cashflowTrough: pilotage.cashflow_trough ?? pilotage.current_checking_balance ?? 0,
      savingsFuture: pilotage.month_savings_future ?? 0,
      investFuture: pilotage.month_invest_future ?? 0,
      reservePlanned: pilotage.monthly_reserve_planned ?? 0,
      reservationsTotal,
      cumulsTotal,
      variableEnvelopeRemaining: pilotage.variable_envelope_remaining ?? 0,
      safetyMargin: pilotage.safety_margin_amount ?? 0,
    });
    const conf = relCfg ? deriveRelykaConfidence(pilotage, relyka, relCfg) : null;

    const txs = transactions as any[];
    const hasBalance =
      (accounts as any[]).some((a) => a.type === 'checking' && Number(a.balance) !== 0) || txs.some(isRegul);
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

    // Compte courant principal (perso, solde le plus élevé) → deeplinks « solde » pré-remplis.
    const mainCheckingId = (accounts as any[])
      .filter((a) => a.type === 'checking' && a._role === 'owner' && !a.is_joint)
      .sort((a, b) => Number(b.balance) - Number(a.balance))[0]?.id ?? null;

    const action = getCurrentAction({
      hasBalance,
      hasIncome,
      hasFixed,
      pendingClosureMonth: pendingMonths[0] ?? null,
      sharedModePrompt,
      offerAppLock,
      // Overlay « Vérifie ton solde » : confiance BASSE uniquement (en moyenne, le bandeau ambre de
      // la carte Relyka suffit — pas de doublon de messages).
      confidenceLow: conf?.result.level === 'low',
      daysSinceVerification: conf?.result.daysSinceVerification ?? 0,
      jointLow,
      // Même arrondi que la carte (dizaine inférieure) → le bandeau annonce le même chiffre.
      relykaText: `${floorToTen(relyka).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`,
      closureEnabled,
      mainCheckingId,
    });
    // (Le cas « tout est à jour » n'existe plus : rien à signaler = aucun bandeau.)
    if (!action) return null;
    // Pendant le guide « Pour bien démarrer », les étapes de setup sont déjà raillées par le guide
    // → pas de double sollicitation (le bandeau reprendra pour le quotidien une fois le guide fini).
    if (action.type === 'setup' && !onboardingDone) return null;
    return action;
  }, [pilotage, accounts, transactions, accountsReady, txReady, pendingMonths, relCfg, closureEnabled, sharedContrib, preSavings, reservations, onboardingDone, offerAppLock, user?.id]);
}
