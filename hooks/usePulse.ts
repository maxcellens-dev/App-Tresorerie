/**
 * LE POULS — assemblage des données réelles → moteur pur (lib/pulseEngine).
 *
 * Ne calcule rien de neuf : tout vient de sources qui existent déjà (usePilotageData, profil P1–P5,
 * comptes, projets, moteur de confiance). Une seule règle : ce hook LIT, le moteur JUGE.
 */
import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePilotageData } from './usePilotageData';
import { useTransactions } from './useTransactions';
import { useAllAccounts } from './useAccounts';
import { useProjects } from './useProjects';
import { useProfile } from './useProfile';
import { usePreSavings } from './usePreSavings';
import { useReservations } from './useReservations';
import { useFinancialProfile, useQuestionnaireAnswers } from './useFinancialProfile';
import { usePulseConfig } from './usePulseConfig';
import { useReliabilityConfig, deriveRelykaConfidence } from './useReliability';
import { isRegul } from '../lib/regul';
import { usePulseSnapshots } from './usePulseState';
import { computePulse, monthKey, PULSE_SIGNAL_IDS, type PulseInputs, type PulseResult } from '../lib/pulseEngine';
import { computeInvestmentGains } from '../lib/investment';
import { computeRelyka } from '../lib/relyka';
import { computeRecommendations, type RecoType } from '../lib/recommendationEngine';
import { buildRecoOptions } from '../lib/recoInputs';
import { useRecommendationTiers } from './useRecommendationTiers';
import { useRecoThresholds } from './useRecoThresholds';
import type { FinancialProfileId } from '../types/database';

/** Dernier jour du mois « YYYY-MM » au format ISO. */
function lastDayOf(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m, 0);
  return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Décale une clé de mois de `n` mois. */
function shiftMonth(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + n, 1));
}

/**
 * Mois PASSÉS consécutifs terminés avec un compte courant dans le vert.
 * Le solde de fin de mois M est reconstruit depuis le solde actuel, en retirant tout ce qui est
 * arrivé APRÈS M (on n'historise pas les soldes : on les rejoue à l'envers, comme le détail de compte).
 */
function computeMonthsWithoutOverdraft(
  checkingBalance: number,
  transactions: any[],
  checkingIds: Set<string>,
  today: Date,
  maxMonths = 12,
): number {
  const real = transactions.filter(
    (t) => checkingIds.has(t.account_id) && !t.is_draft && !t.is_recurring,
  );
  let streak = 0;
  for (let back = 1; back <= maxMonths; back++) {
    const key = monthKey(new Date(today.getFullYear(), today.getMonth() - back, 1));
    const cutoff = lastDayOf(key);
    const after = real
      .filter((t) => String(t.date) > cutoff)
      .reduce((s, t) => s + Number(t.amount), 0);
    const balanceAtEnd = checkingBalance - after;
    // Aucun mouvement avant ce mois → l'utilisateur n'existait pas encore : on arrête la série.
    const hadActivity = real.some((t) => String(t.date) <= cutoff);
    if (!hadActivity) break;
    if (balanceAtEnd < 0) break;
    streak++;
  }
  return streak;
}

export interface PulseData {
  /** L'état des lieux COMPLET (tous les signaux du profil) — mensuel + consultation à la demande. */
  result: PulseResult;
  /** Le pouls HEBDO, léger (3 signaux max) — la carte de la semaine. */
  weekly: PulseResult;
  /** L'état des lieux MENSUEL : mêmes signaux que `result`, réordonnés pour un bilan de fin de mois
   *  (récap du mois d'abord, matelas à la place de « fin de mois », projets, puis le reste). */
  monthly: PulseResult;
  /** TOUS les signaux calculés (au-delà de ceux affichés au profil) — pool de recherche du live :
   *  une saisie d'épargne doit pouvoir montrer la carte « Épargne » même si le profil ne l'affiche pas. */
  live: PulseResult;
  /** Chiffres bruts de l'anneau hebdo : épargné + investi du mois vs capacité du mois. */
  weeklyStats: { saved: number; invested: number; capacity: number };
  profileId: FinancialProfileId;
  /** Relyka du jour — sert aux delta chips (avant / après une saisie). */
  relyka: number;
  /** Patrimoine du jour — persisté dans le snapshot pour l'évolution à 3 mois. */
  wealth: number;
  /**
   * L'utilisateur a-t-il vécu le mois précédent dans l'app ? Sans ça, on lui servirait un « état des
   * lieux » d'un mois où il n'existait pas — le pire premier contact possible.
   */
  hadActivityLastMonth: boolean;
  /**
   * Solde COURANT projeté au 1er du mois suivant, et marge de sécurité. Exposés bruts (et pas
   * seulement à travers le signal « Fin de mois ») parce que la carte de confirmation de saisie les
   * recalcule PAR ARITHMÉTIQUE, sans attendre un recalcul complet du Pouls (cf. lib/pulseDelta).
   */
  endOfMonthBalance: number;
  safetyMargin: number;
  /**
   * Enveloppe variable RESTANTE du mois — exposée pour la même raison : le solde projeté la déduit
   * déjà, donc une dépense du quotidien qui la consomme ne le déplace pas. Sans ce chiffre, la carte
   * de confirmation annonçait une fin de mois amputée à chaque course (cf. lib/pulseDelta).
   */
  variableEnvelopeRemaining: number;
}

/**
 * Les 15 entrées du calcul, regroupées : elles servent aussi de clé au cache partagé.
 * Types DÉRIVÉS des hooks source — le calcul reste typé de bout en bout.
 */
type QueryData<T extends (...args: any) => any> = ReturnType<T> extends { data: infer D } ? D : never;
type PulseDeps = {
  pilotage: QueryData<typeof usePilotageData>;
  profile: QueryData<typeof useProfile>;
  transactions: NonNullable<QueryData<typeof useTransactions>>;
  accounts: NonNullable<QueryData<typeof useAllAccounts>>;
  projects: NonNullable<QueryData<typeof useProjects>>;
  preSavings: QueryData<typeof usePreSavings>;
  reservations: NonNullable<QueryData<typeof useReservations>>;
  financialProfile: QueryData<typeof useFinancialProfile>;
  answers: QueryData<typeof useQuestionnaireAnswers>;
  config: QueryData<typeof usePulseConfig>;
  relCfg: QueryData<typeof useReliabilityConfig>;
  snapshots: NonNullable<QueryData<typeof usePulseSnapshots>>;
  customTiers: QueryData<typeof useRecommendationTiers>;
  recoThresholds: QueryData<typeof useRecoThresholds>;
  userId: string | undefined;
};

/**
 * PERF — CACHE PARTAGÉ ENTRE COMPOSANTS.
 *
 * `usePulse()` est appelé par DEUX hosts montés à la racine (PulseHost et PulseDeltaHost) : sans
 * cache, tout le pipeline — 3× computePulse, le moteur de recommandations complet, et un balayage
 * des transactions sur 12 mois — tournait DEUX FOIS à chaque rendu déclenché par une navigation.
 * Un `useMemo` ne peut rien y faire : il est local à une instance de composant.
 *
 * Même schéma que la palette de couleurs (hooks/useAppColors) : on mémorise le dernier couple
 * (entrées, résultat) au niveau du MODULE et on le réutilise tant que les entrées sont
 * identiques — comparaison par référence, les données viennent de react-query qui garantit une
 * référence stable tant que rien n'a changé.
 */
let pulseCache: { deps: PulseDeps; value: PulseData | null } | null = null;

function sameDeps(a: PulseDeps, b: PulseDeps): boolean {
  return a.pilotage === b.pilotage && a.profile === b.profile && a.transactions === b.transactions
    && a.accounts === b.accounts && a.projects === b.projects && a.preSavings === b.preSavings
    && a.reservations === b.reservations && a.financialProfile === b.financialProfile
    && a.answers === b.answers && a.config === b.config && a.relCfg === b.relCfg
    && a.snapshots === b.snapshots && a.customTiers === b.customTiers
    && a.recoThresholds === b.recoThresholds && a.userId === b.userId;
}

function sharedPulse(deps: PulseDeps): PulseData | null {
  const cached = pulseCache;
  if (cached && sameDeps(cached.deps, deps)) return cached.value;
  const value = buildPulse(deps);
  pulseCache = { deps, value };
  return value;
}

export function usePulse(): PulseData | null {
  const { user } = useAuth();
  const { data: pilotage } = usePilotageData(user?.id);
  const { data: profile } = useProfile(user?.id);
  const { data: transactions = [] } = useTransactions(user?.id);
  const { data: accounts = [] } = useAllAccounts(user?.id);
  const { data: projects = [] } = useProjects(user?.id);
  const { data: preSavings } = usePreSavings(user?.id);
  const { data: reservations = [] } = useReservations(user?.id);
  const { data: financialProfile } = useFinancialProfile(user?.id);
  const { data: answers } = useQuestionnaireAnswers(user?.id);
  const { data: config } = usePulseConfig();
  const { data: relCfg } = useReliabilityConfig();
  const { data: snapshots = [] } = usePulseSnapshots(user?.id);
  // Capacité d'investissement = LE pipeline complet des recos (mêmes options via lib/recoInputs),
  // sinon le Pouls et la reco « Investir » annoncent deux montants différents pour le même mois.
  const { data: customTiers } = useRecommendationTiers();
  const { data: recoThresholds } = useRecoThresholds();

  return useMemo<PulseData | null>(
    () => sharedPulse({
      pilotage, profile, transactions, accounts, projects, preSavings, reservations,
      financialProfile, answers, config, relCfg, snapshots, customTiers, recoThresholds,
      userId: user?.id,
    }),
    [
      pilotage, profile, transactions, accounts, projects, preSavings, reservations,
      financialProfile, answers, config, relCfg, snapshots, customTiers, recoThresholds, user?.id,
    ],
  );
}

function buildPulse(deps: PulseDeps): PulseData | null {
  const {
    pilotage, profile, transactions, accounts, projects, preSavings, reservations,
    financialProfile, answers, config, relCfg, snapshots, customTiers, recoThresholds, userId,
  } = deps;
  {
    if (!pilotage || !config?.enabled) return null;
    const profileId = (financialProfile?.profile_id as FinancialProfileId) ?? 'P3';
    const today = new Date();

    // ── Relyka (budget réellement libre) : même formule que la carte du Pilotage.
    const currentMonth = monthKey(today);
    const reservationsTotal = (reservations as any[])
      .filter((r) => String(r.created_at ?? '').slice(0, 7) === currentMonth)
      .reduce((s, r) => s + Number(r.montant), 0);
    const cumulsTotal = (preSavings?.epargne.total_cumule ?? 0) + (preSavings?.invest.total_cumule ?? 0);
    const safetyMargin = pilotage.safety_margin_amount ?? 0;
    const relykaInputs = {
      cashflowTrough: pilotage.cashflow_trough ?? pilotage.current_checking_balance ?? 0,
      savingsFuture: pilotage.month_savings_future ?? 0,
      investFuture: pilotage.month_invest_future ?? 0,
      reservePlanned: pilotage.monthly_reserve_planned ?? 0,
      reservationsTotal,
      cumulsTotal,
      variableEnvelopeRemaining: pilotage.variable_envelope_remaining ?? 0,
      safetyMargin,
    };
    const relyka = computeRelyka(relykaInputs);

    // ── « Fin de mois » = ce qui devrait RESTER SUR LE COMPTE courant au 1er du mois prochain :
    // le point bas de trésorerie (récurrentes déjà dedans) MOINS ce qui va SORTIR du compte d'ici là
    // — virements épargne/invest à venir + dépenses variables restantes estimées.
    // On NE déduit PAS les montants RÉSERVÉS / cumulés : cet argent est mentalement mis de côté mais
    // reste PHYSIQUEMENT sur le compte (le déduire ici le compterait en double). Non clampé (peut
    // passer sous 0 = découvert prévu).
    const endOfMonthLeft =
      relykaInputs.cashflowTrough
      - relykaInputs.savingsFuture - relykaInputs.investFuture
      - relykaInputs.variableEnvelopeRemaining;

    // ── Confiance : chiffres douteux → le Pouls ne juge pas (tout passe en « estimé »).
    const confidence = relCfg ? deriveRelykaConfidence(pilotage, relyka, relCfg) : null;
    const lowConfidence = confidence?.result.level === 'low';

    // Épargné / investi ce mois = virements EXÉCUTÉS (sortis du solde), PROJETS COMPRIS — mêmes
    // chiffres que le Suivi du Pilotage. L'ancienne base « hors projets » (real_savings_excl_projects)
    // affichait « 0 € mis de côté » à quelqu'un qui venait de valider un virement d'épargne de
    // projet, alors que la ligne « Épargne totale » de la même carte l'incluait déjà. Le signal
    // « Ton projet » mesure l'avancement vers la cible, pas l'effort du mois : pas de double compte.
    const investExecuted = Math.max(0, (pilotage.month_invest_total ?? 0) - (pilotage.month_invest_future ?? 0));
    const savingsExecuted = Math.max(0, (pilotage.month_savings_total ?? 0) - (pilotage.month_savings_future ?? 0));
    const investedThisMonth = investExecuted;
    const savedThisMonth = savingsExecuted;
    // ── Capacité d'investissement = LE pipeline des recos, à l'identique (options partagées via
    // lib/recoInputs : budget reconstitué, alreadyAllocated, cascade Σ recos = Relyka, garde-fou
    // projection, plafond Relyka). « Tu pourrais placer jusqu'à X » = déjà exécuté + déjà fléché
    // (virements prévus + cumuls invest) + LA RECO « Investir » AFFICHÉE — les deux écrans disent
    // le même chiffre (fini le « jusqu'à 572 € » face à une reco à 110 €).
    const preEpargneTotal = preSavings?.epargne.total_cumule ?? 0;
    const preInvestTotal = preSavings?.invest.total_cumule ?? 0;
    const recos = computeRecommendations(pilotage, buildRecoOptions(pilotage, {
      reservationsTotal,
      preEpargneTotal,
      preInvestTotal,
      prudenceLevel: ((profile as any)?.prudence_level ?? null) as number | null,
      financialProfileId: financialProfile?.profile_id as FinancialProfileId | undefined,
      thresholds: recoThresholds,
      customTierAllocations: customTiers,
    }));
    const recoAmount = (t: RecoType) => recos.find((r) => r.type === t)?.amount ?? 0;
    const investPlanned = (pilotage.month_invest_future ?? 0) + preInvestTotal;
    const savingsPlanned = (pilotage.month_savings_future ?? 0) + preEpargneTotal;
    const investCapacity = investedThisMonth + investPlanned + recoAmount('invest');
    // Anneau hebdo : épargné + investi vs la capacité COMBINÉE du mois (épargne + invest, même logique).
    const weeklyStats = {
      saved: savedThisMonth,
      invested: investedThisMonth,
      capacity: savedThisMonth + investedThisMonth + savingsPlanned + investPlanned
        + recoAmount('save') + recoAmount('invest'),
    };

    // ── Investissement : ce que ça a rapporté (plus/moins-values saisies sur les comptes d'invest).
    const { gains } = computeInvestmentGains(transactions as any[]);

    // ── Jamais dans le rouge : soldes de fin de mois rejoués à l'envers.
    const checkingIds = new Set(
      (accounts as any[]).filter((a) => a.type === 'checking' && !a.is_joint).map((a) => a.id),
    );
    const monthsWithoutOverdraft = computeMonthsWithoutOverdraft(
      pilotage.total_checking, transactions as any[], checkingIds, today,
    );

    // ── Patrimoine : total du jour, et celui d'il y a 3 mois (snapshot mensuel).
    const wealth = pilotage.total_checking + pilotage.total_savings + pilotage.total_invested;
    const key3mAgo = shiftMonth(currentMonth, -3);
    const snap3m = snapshots.find((s) => s.period_kind === 'month' && s.period_key === key3mAgo);
    const wealth3mAgo = snap3m ? Number(snap3m.wealth) : null;

    // ── Projets PERSO (les projets partagés ne sont pas le sujet du Pouls).
    const progressById = new Map<string, any>(
      ((pilotage.projects_with_progress ?? []) as any[]).map((p) => [p.id as string, p]),
    );
    const pulseProjects = (projects as any[])
      .filter((p) => p.profile_id === userId && p.status === 'active')
      .map((p) => {
        const progress = progressById.get(p.id);
        const target = Number(p.target_amount) || 0;
        const progressPct = progress?.progress_percentage ?? 0;
        const saved = (progressPct / 100) * target;
        return {
          id: p.id,
          name: p.name as string,
          target,
          saved,
          progressPct,
          onTrack: isProjectOnTrack(p, saved, target, today),
        };
      });

    const inputs: PulseInputs = {
      profileId,
      today,
      endOfMonthBalance: endOfMonthLeft,
      safetyMargin,
      // Réservé + réserve prévue + cumuls : dans le solde de fin de mois, PAS dans le Relyka.
      reservedOnAccount: relykaInputs.reservePlanned + relykaInputs.reservationsTotal + relykaInputs.cumulsTotal,
      spendingBudget: pilotage.variable_envelope_initial ?? 0,
      spendingSoFar: pilotage.variable_envelope_spent ?? 0,
      savingsBalance: pilotage.total_savings,
      // Ce qui est RÉELLEMENT parti à l'épargne ce mois-ci, virements de PROJET compris (le signal
      // « Ton projet » mesure l'avancement vers la cible, pas l'effort d'épargne du mois).
      savedThisMonth,
      // Virements encore À VENIR ce mois (datés > aujourd'hui) : segment « prévu » des cartes
      // Épargne / Investissement — comptés dans le jugement, affichés en teinte claire.
      // (Sans les cumuls fléchés : pas datés, ils ne sont pas « prévus ce mois ».)
      savingsPlannedThisMonth: Math.max(0, pilotage.month_savings_future ?? 0),
      investPlannedThisMonth: Math.max(0, pilotage.month_invest_future ?? 0),
      avgMonthlyIncome: pilotage.avg_monthly_income ?? 0,
      questionnaireQ3: (answers as any)?.q3 ?? null,
      investedBalance: pilotage.total_invested,
      investedThisMonth,
      investmentGains: gains,
      investCapacity,
      totalWealth: wealth,
      wealth3mAgo,
      monthsWithoutOverdraft,
      projects: pulseProjects,
      lowConfidence,
    };

    const lastMonth = shiftMonth(currentMonth, -1);
    const hadActivityLastMonth = (transactions as any[]).some(
      (t) => !t.is_draft && String(t.date ?? '').slice(0, 7) === lastMonth,
    );

    /* ── CHIFFRES DU MOIS ÉCOULÉ (pour l'état des lieux mensuel) ─────────────────────────────────
       Recalculés depuis les transactions réelles du mois concerné, pas depuis les agrégats « du
       mois en cours » du Pilotage. Mêmes définitions que celles du Suivi : les dépenses variables
       sont les sorties non récurrentes hors virements/régul ; l'épargné / l'investi sont les
       virements ARRIVÉS sur un compte d'épargne / d'investissement. */
    const typeByAccount = new Map<string, string>((accounts as any[]).map((a) => [a.id, a.type]));
    const inLastMonth = (t: any) => !t.is_draft && String(t.date ?? '').slice(0, 7) === lastMonth;
    let lastMonthVariable = 0, lastMonthSaved = 0, lastMonthInvested = 0;
    for (const t of transactions as any[]) {
      if (!inLastMonth(t)) continue;
      const amt = Number(t.amount) || 0;
      if (t.linked_account_id) {
        if (amt <= 0) continue;                                    // jambe ENTRANTE seulement
        const destType = typeByAccount.get(t.account_id);
        if (destType === 'savings') lastMonthSaved += amt;
        else if (destType === 'investment') lastMonthInvested += amt;
        continue;
      }
      if (isRegul(t)) continue;
      // Dépense variable = sortie NON récurrente (une occurrence matérialisée porte materialized_from).
      if (amt < 0 && !t.is_recurring && !t.materialized_from) lastMonthVariable += -amt;
    }
    const lastMonthInputs: PulseInputs = {
      ...inputs,
      spendingSoFar: lastMonthVariable,
      savedThisMonth: lastMonthSaved,
      investedThisMonth: lastMonthInvested,
      // Le mois est FINI : plus rien n'est « prévu » dessus.
      savingsPlannedThisMonth: 0,
      investPlannedThisMonth: 0,
    };

    // Pool LIVE : tous les signaux calculés (pas seulement ceux affichés au profil), pour que la
    // carte de saisie puisse montrer « Épargne » / « Investissement » quel que soit le profil.
    const allConfig = {
      ...config,
      signalsByProfile: { ...config.signalsByProfile, [profileId]: PULSE_SIGNAL_IDS },
    };

    return {
      result: computePulse(inputs, config, 'full'),
      weekly: computePulse(inputs, config, 'week'),
      /* État des lieux MENSUEL : l'ordre du bilan de fin de mois, ET les chiffres DU MOIS ÉCOULÉ.
         Le bilan se lit après la clôture — souvent à la mi-septembre pour août. Servi avec les
         chiffres « à date », il aurait raconté septembre sous un titre parlant d'août : 3 jours de
         dépenses variables au lieu du mois complet, et l'épargne du mois en cours à la place de
         celle qu'on prétend récapituler. */
      monthly: computePulse(lastMonthInputs, config, 'month'),
      live: computePulse(inputs, allConfig, 'full'),
      weeklyStats,
      profileId,
      relyka,
      wealth,
      hadActivityLastMonth,
      endOfMonthBalance: endOfMonthLeft,
      safetyMargin,
      variableEnvelopeRemaining: relykaInputs.variableEnvelopeRemaining,
    };
  }
}

/**
 * Le projet suit-il son plan ? On compare ce qui est mis de côté à ce qui aurait dû l'être :
 *  • versement mensuel prévu → mois écoulés × versement ;
 *  • échéance (allocation_type 'date') → part du temps écoulé × montant cible ;
 *  • saisie MANUELLE / ponctuelle (ni versement récurrent ni échéance) → INDÉTERMINÉ : on ne peut
 *    pas savoir s'il est en retard, donc `null` → le Pouls affiche un état neutre (« En cours »).
 * Tolérance de 10 % : un mois de décalage ne doit pas afficher « en retard ».
 */
function isProjectOnTrack(project: any, saved: number, target: number, today: Date): boolean | null {
  // Versement mensuel prévu : on compare l'épargné au cumul attendu → détecte les échéances sautées.
  const monthly = Number(project.monthly_allocation) || 0;
  const start = String(project.first_payment_date ?? project.created_at ?? '').slice(0, 10);
  const startDate = start ? new Date(start + 'T00:00:00') : null;
  const started = startDate && !Number.isNaN(startDate.getTime()) && startDate <= today;

  if (monthly > 0 && started) {
    const monthsElapsed =
      (today.getFullYear() - startDate!.getFullYear()) * 12 + (today.getMonth() - startDate!.getMonth());
    const expected = Math.max(0, monthsElapsed) * monthly;
    return saved >= expected * 0.9;
  }

  // Échéance fixe : rythme attendu proportionnel au temps écoulé jusqu'à la date cible.
  const targetDate = project.target_date ? new Date(String(project.target_date) + 'T00:00:00') : null;
  if (started && targetDate && !Number.isNaN(targetDate.getTime()) && targetDate > startDate! && target > 0) {
    const total = targetDate.getTime() - startDate!.getTime();
    const done = Math.min(total, Math.max(0, today.getTime() - startDate!.getTime()));
    const expected = (done / total) * target;
    return saved >= expected * 0.9;
  }

  // Aucun plan de financement daté → on ne juge pas.
  return null;
}
