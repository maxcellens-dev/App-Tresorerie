// Construit l'instantané financier ANONYMISÉ envoyé à l'IA (via l'Edge Function).
// Règle d'or : uniquement des MONTANTS et des CATÉGORIES (taxonomie générique). Jamais de nom, de
// libellé de transaction, de numéro de compte ou de nom de projet en clair → tout est neutralisé.
// L'instantané distingue explicitement les TYPES de mouvements (dépenses fixes/variables, virements
// épargne vs investissement) et donne le CONTEXTE temporel (jour du mois) et l'ancienneté des projets,
// pour que l'IA ne tire pas de conclusions erronées (peu de dépenses en début de mois = normal, etc.).
//
// V2 — sections ajoutées pour des conseils réellement personnalisés :
//   • RATIOS CLÉS pré-calculés (taux d'épargne, poids des fixes/crédits, coussin de sécurité) ;
//   • HISTORIQUE MENSUEL (mois COMPLETS : revenus / dépenses fixes / variables) → tendances fiables ;
//   • MOYENNES PAR CATÉGORIE (3 mois complets) + dernier mois complet + dérive % ;
//   • CHARGES RÉCURRENTES actives par sous-catégorie (abonnements/engagements à passer en revue) ;
//   • REVENUS RÉCURRENTS ;
//   • DÉPENSES PONCTUELLES NOTABLES (grosses dépenses non récurrentes récentes).
import type { PilotageData } from '../../hooks/pilotage/usePilotageData';
import { computeHealthScore, deriveEngaged } from './aiScore';
import { MONTHLY_FACTOR_BY_RULE } from '../finance/recurrence';

export interface SnapshotCredit { principal: number; monthly: number; ratePct: number; crd: number; endYM: string | null; impactPct: number; remainingMonths?: number | null }
export interface SnapshotProject { target: number; monthly: number; progressPct: number; startISO: string | null; status: string; destType?: string | null; mode?: 'transfer' | 'reserve' | 'spend' }
/** Revenu de RÉFÉRENCE : moyenne des sommes de recettes par mois (mois avec recettes, ≤ 6 mois),
 *  avec en parallèle la moyenne des virements entrants depuis un compte « autre » (revenu de fait). */
export interface SnapshotIncomeRef {
  avg: number;
  monthsUsed: number;
  /** Mois de la fenêtre AVEC activité sur les courants mais SANS recette. */
  monthsWithoutIncome: number;
  transfersAvg: number;
  source: 'recettes' | 'virements' | 'none';
}
/** Un mois COMPLET d'historique (YYYY-MM) : revenus / dépenses (hors virements internes). */
export interface SnapshotMonth { ym: string; income: number; expenses: number; fixed: number; variable: number }
/** Dépenses d'une grande catégorie PAR MOIS COMPLET (+ moyenne) — montrer les mois évite les fausses
 *  « dérives » quand une catégorie n'apparaît que depuis peu (ex. prélèvements réorganisés). */
export interface SnapshotCategoryTrend { name: string; byMonth: Record<string, number>; avg: number }
/** Détail des dépenses ponctuelles/variables d'un mois, par sous-catégorie (tous comptes courants). */
export interface SnapshotVariableDetail { ym: string; isCurrent: boolean; items: { category: string; amount: number; count: number }[] }
/** Compte partagé / joint accessible : type + part d'impact + MODE (« tracked » = quotidien,
 *  « contribution » = hors quotidien). Le traitement des flux qui y transitent en dépend. */
export interface SnapshotSharedAccount { type: string; joint: boolean; impactPct: number; mode?: string | null }
/** Charge (ou revenu) récurrente active : sous-catégorie + montant + fréquence.
 *  `variable` vient du RÉGLAGE de la catégorie dans l'app — pas d'une devinette sur son nom. */
export interface SnapshotRecurring { category: string; amount: number; rule: string; variable?: boolean | null }
/** Virement INTERNE récurrent (mise de côté ou contribution au foyer) — jamais une dépense. */
export interface SnapshotRecurringTransfer { dest: string; amount: number; rule: string }
/** Dépense ponctuelle notable (non récurrente) : date + grande catégorie + montant. */
export interface SnapshotOneOff { date: string; category: string; amount: number }
/** Projection du solde courant en fin de mois (moteur lib/forecast — le même que l'onglet Projection). */
export interface SnapshotForecastMonth { ym: string; balance: number }
/** Changement DÉJÀ SAISI à venir : fin ou début d'une récurrence (charge, revenu, virement). */
export interface SnapshotUpcomingChange {
  kind: 'expense' | 'income' | 'transfer_saving' | 'transfer_invest' | 'transfer_other';
  category: string;
  amount: number;
  rule: string;
  /** Mois (YYYY-MM) de la dernière échéance (fin) ou de la première (début). */
  ym: string;
}
/** Transactions futures déjà saisies (12 mois) : fins/débuts de récurrences + ponctuelles notables. */
export interface SnapshotUpcoming {
  endings: SnapshotUpcomingChange[];
  starts: SnapshotUpcomingChange[];
  oneOffs: { date: string; category: string; amount: number; income: boolean }[];
}

export interface SnapshotInput {
  currencySymbol: string;
  today: string;          // 'YYYY-MM-DD'
  dayOfMonth: number;
  daysInMonth: number;
  pilotage: PilotageData;
  /**
   * LE RELYKA, c'est-à-dire LE chiffre que l'utilisateur a sous les yeux sur son tableau de bord
   * (cf. lib/finance/relyka). Il n'était pas transmis : l'IA ne connaissait que `safe_to_spend`,
   * l'ANCIEN modèle de budget, qui ne déduit ni l'enveloppe de dépenses variables, ni les virements
   * prévus, ni les réservations — donc plusieurs centaines d'euros au-dessus. Elle annonçait ainsi
   * « tu as 1 800 € réellement disponibles » à quelqu'un dont l'app affiche 240 €.
   * Absent → la ligne n'est pas écrite (on n'invente pas un montant).
   */
  relyka?: number | null;
  /** Dépenses du mois par grande catégorie (déjà agrégées, triées desc). */
  expensesByCategory: Array<{ name: string; amount: number }>;
  credits?: SnapshotCredit[];
  projects?: SnapshotProject[];
  /** Historique par mois COMPLET (du plus ancien au plus récent, ≤ 6). */
  history?: SnapshotMonth[];
  /** Tendances par grande catégorie (triées par moyenne desc). */
  categoryTrends?: SnapshotCategoryTrend[];
  /** Charges récurrentes actives (dépenses), triées desc. */
  recurringExpenses?: SnapshotRecurring[];
  /** Revenus récurrents actifs. */
  recurringIncomes?: SnapshotRecurring[];
  /** Virements internes récurrents (épargne / investissement / contribution au compte joint). */
  recurringTransfers?: SnapshotRecurringTransfer[];
  /** Grosses dépenses ponctuelles récentes (~8 max). */
  topOneOff?: SnapshotOneOff[];
  /** Projection du solde courant sur ~6 mois (mois courant inclus). */
  forecast?: SnapshotForecastMonth[];
  /** Détail des dépenses ponctuelles/variables par sous-catégorie (dernier mois complet + mois en cours). */
  variableDetail?: SnapshotVariableDetail[];
  /** Comptes partagés / joints accessibles (type + part d'impact + mode). */
  sharedAccounts?: SnapshotSharedAccount[];
  /** Revenu de référence (moyenne des recettes mensuelles saisies + virements entrants en parallèle). */
  incomeRef?: SnapshotIncomeRef;
  /** true si le 1ᵉʳ mois de l'historique est probablement le mois d'arrivée sur l'app (saisie incomplète). */
  firstMonthPartial?: boolean;
  /** Changements déjà saisis à venir (12 mois) : fins/débuts de récurrences + ponctuelles futures. */
  upcoming?: SnapshotUpcoming;
  /** Épargne & investissement projetés à 6/12 mois (virements déjà saisis, hors rendement). */
  savingsInvestForecast?: { savingsNow: number; investNow: number; savings6: number; savings12: number; invest6: number; invest12: number };
  /** Contribution récurrente mensuelle vers les comptes joints « contribution » (engagement foyer). */
  jointContributionMonthly?: number;
  /** Total des versements sur les comptes d'investissement (capital injecté) — pour la plus-value. */
  investContributed?: number | null;
  /** Revenus (recettes) attendus par mois sur les 6 prochains mois (même trajectoire que la Projection). */
  incomeByMonth?: { ym: string; income: number }[];
  /** Revenu mensuel RÉEL moyen des prochains mois (moyenne de incomeByMonth) — capacité de paiement
   *  honnête quand les revenus récurrents varient chaque mois (overrides). Défaut : total récurrent. */
  realMonthlyIncome?: number;
  /** Évolution depuis le DERNIER bilan global (métriques persistées) — répond à « je vais dans le bon sens ? ». */
  evolution?: { previousDate: string; previous: BilanMetrics; current: BilanMetrics } | null;
  /** Profil financier de l'app (P1 fragile → P5 confortable) : les conseils doivent le RESPECTER. */
  financialProfile?: { id: string; name: string } | null;
  /**
   * Fiabilité du profil (cf. lib/finance/profileReliability) — sur quoi le classement repose.
   * L'IA doit savoir quand elle raisonne sur des données incomplètes : sinon elle affirme avec la
   * même assurance un conseil tiré d'un matelas mesuré et un conseil tiré d'un matelas deviné.
   */
  profileReliability?: { level: string; title: string; gaps: string[] } | null;
}

/** Métriques top-line d'un bilan, persistées pour comparer d'un bilan à l'autre (~8 nombres). */
export interface BilanMetrics {
  patrimoine: number;
  checking: number;
  savings: number;
  invested: number;
  engaged: number;
  balance12: number;
  income: number;
  score: number;
}

const r0 = (n: number) => Math.round(n || 0).toLocaleString('fr-FR');
const RULE_FR: Record<string, string> = { daily: 'jour', weekly: 'semaine', monthly: 'mois', yearly: 'an', quarterly: 'trimestre' };
// Équivalent MENSUEL d'une récurrence (pour totaliser des récurrents de fréquences différentes).
// Facteurs PARTAGÉS (lib/finance/recurrence) : ils valaient 52/12 ici et 4.33 ailleurs.
const RULE_MONTHLY = MONTHLY_FACTOR_BY_RULE;
const monthlyEq = (r: SnapshotRecurring) => r.amount * (RULE_MONTHLY[r.rule] ?? 1);

export function buildSnapshot(input: SnapshotInput): string {
  const {
    currencySymbol: s, today, dayOfMonth, daysInMonth, pilotage: p, expensesByCategory,
    credits = [], projects = [], history = [], categoryTrends = [],
    recurringExpenses = [], recurringIncomes = [], recurringTransfers = [], topOneOff = [], forecast = [],
    variableDetail = [], sharedAccounts = [], incomeRef, firstMonthPartial = false,
    upcoming, savingsInvestForecast, jointContributionMonthly = 0, investContributed = null,
    incomeByMonth = [], evolution = null, relyka = null,
  } = input;
  // Revenu récurrent « réel » : moyenne des prochains mois (overrides inclus) plutôt que l'override
  // d'un seul mois multiplié — sinon des revenus qui varient chaque mois affichent un faux « /mois ».
  const recurringIncomeMonthlyRaw = recurringIncomes.reduce((t, r) => t + r.amount * (RULE_MONTHLY[r.rule] ?? 1), 0);
  const realMonthlyIncome = input.realMonthlyIncome != null && input.realMonthlyIncome > 0
    ? input.realMonthlyIncome
    : recurringIncomeMonthlyRaw;
  const L: string[] = [];
  const m = (n: number) => `${r0(n)} ${s}`;
  const monthProgress = Math.round((dayOfMonth / daysInMonth) * 100);

  L.push('=== INSTANTANÉ FINANCIER (anonymisé : montants + catégories uniquement) ===');

  // Profil financier de l'app : cadre TOUS les conseils (quelqu'un dans le rouge ne doit pas se
  // voir conseiller d'investir ; quelqu'un avec 300 000 € n'a pas besoin qu'on lui rappelle de
  // constituer un matelas). L'échelle est passée à dix paliers — le prompt doit suivre, sinon
  // l'IA raisonne sur des repères qui n'existent plus.
  if (input.financialProfile) {
    const fp = input.financialProfile;
    L.push('\nPROFIL FINANCIER (déterminé par l\'app — RESPECTE-LE dans tes conseils)');
    L.push(`- Profil : ${fp.id} — ${fp.name} (échelle P0 découverte → P1 déficitaire → P9 patrimoine d'exception).`);
    /* ⚠️ Cette phrase RÉSUME l'échelle pour l'IA : elle doit dire exactement ce que le moteur fait,
       sinon l'IA raisonne sur une règle que l'app n'applique pas. Deux précisions ont manqué :
       le PATRIMOINE exclut le solde courant (c'est la trésorerie du mois, pas un patrimoine), et
       les montants cités sont les valeurs par défaut — l'administration peut les recalibrer. */
    L.push('- Le profil répond à quatre questions, dans cet ordre : la situation est-elle VIABLE (revenu vs dépenses essentielles) → sinon P1 ; combien de temps l\'épargne tient-elle (épargne ÷ dépenses essentielles) → P2 moins d\'1 mois, P3 de 1 à 3, P4 de 3 à 6, P5 au-delà de 6 ; investit-il réellement → P6 ; taille du patrimoine bancaire, c\'est-à-dire ÉPARGNE + PLACEMENTS, hors compte courant → P7 ≥ 30k, P8 ≥ 100k, P9 ≥ 300k environ (toujours avec 6 mois de réserve et des placements). Le taux d\'épargne n\'entre PAS dans le classement. Ne recalcule jamais le palier toi-même : celui qui est indiqué ci-dessus fait foi.');
    L.push('- Adapte tes recommandations à ce profil : P0 → ne présume RIEN, invite simplement à compléter les données ; P1 → rétablir l\'équation revenus/charges, aucun conseil d\'épargne ambitieux ni d\'investissement ; P2-P3 → priorité absolue au matelas de sécurité, PAS d\'investissement ; P4-P5 → équilibre épargne/projets, investissement prudent une fois le matelas solide ; P6-P7 → l\'investissement régulier est le sujet principal ; P8-P9 → optimisation, fiscalité et allocation ; rappeler qu\'un liquide important qui dort a un coût.');
  }

  /* FIABILITÉ : ce que l'app SAIT réellement. Sans cette section, l'IA affirmait avec la même
     assurance un conseil tiré d'un matelas mesuré et un conseil tiré d'un matelas deviné faute de
     charges saisies — c'est-à-dire le cas de tout utilisateur récent. */
  if (input.profileReliability) {
    const r = input.profileReliability;
    L.push(`- Fiabilité du profil : ${r.title.toUpperCase()}.`);
    if (r.gaps.length > 0) {
      L.push(`- Données manquantes ou estimées : ${r.gaps.join(' ; ')}.`);
    }
    /* On informe, on ne pilote pas : la fiabilité n'a AUCUN effet mécanique dans l'app (cf.
       lib/finance/profileReliability). Ce qu'on demande à l'IA est du même ordre — ne pas affirmer
       ce qu'elle ne sait pas, et inviter à compléter. Pas d'interdiction de conseiller. */
    if (r.level === 'incomplete') {
      L.push('- ⚠ Le profil repose sur des données INCOMPLÈTES : formule tes constats au conditionnel et invite d\'abord à compléter ce qui manque — un conseil tiré d\'une réserve mal mesurée peut être l\'inverse du bon.');
    } else if (r.level === 'estimated') {
      L.push('- Une partie du calcul est estimée : reste factuel, évite les affirmations catégoriques sur la réserve.');
    }
  }

  L.push('\nCONTEXTE TEMPOREL (important pour interpréter les chiffres)');
  L.push(`- Date du jour : ${today} — nous sommes le jour ${dayOfMonth}/${daysInMonth} du mois (≈ ${monthProgress}% du mois écoulé).`);
  L.push(`- ⚠ Les montants « du mois » sont donc partiels : en début de mois, peu de dépenses passées est NORMAL. Pour les tendances, appuie-toi sur l'HISTORIQUE des mois complets et les moyennes.`);

  L.push('\nPATRIMOINE');
  L.push(`- Comptes courants : ${m(p.total_checking)}`);
  L.push(`- Épargne : ${m(p.total_savings)}`);
  L.push(`- Investissement : ${m(p.total_invested)}`);
  L.push(`- Patrimoine total : ${m(p.total_checking + p.total_savings + p.total_invested)}`);

  // Ratios pré-calculés côté app (fiables — préfère-les à tes propres recalculs).
  // Revenu de RÉFÉRENCE = moyenne des SOMMES de recettes par mois, sur les mois AVEC recettes
  // (fenêtre ≤ 6 mois). Recettes = vraies rentrées : pas les virements internes, pas les
  // remboursements de dépenses, pas les régularisations. Si AUCUNE recette mais des virements
  // entrants depuis un compte « autre » → ces virements font office de revenu.
  const income = incomeRef?.avg || p.avg_monthly_income || 0;
  const incomeBase = !incomeRef || incomeRef.source === 'none'
    ? 'revenu mensuel moyen'
    : incomeRef.source === 'virements'
      ? `moyenne des virements reçus sur les comptes courants depuis un compte « autre » (${incomeRef.monthsUsed} mois — aucune recette saisie : ces virements font office de revenu)`
      : `moyenne des recettes mensuelles saisies (${incomeRef.monthsUsed} mois avec recettes, fenêtre ≤ 6 mois)`;
  const plannedSetAside = (p.monthly_savings_planned || 0) + (p.monthly_invest_planned || 0);
  // Dépenses FIXES de référence = total des charges récurrentes actives normalisées au mois.
  // (`monthly_commitments` du pilotage = allocations de projets, PAS les dépenses fixes.)
  const fixedMonthly = recurringExpenses.reduce((t, r) => t + monthlyEq(r), 0);
  const avgExpenses = history.length
    ? history.reduce((t, h) => t + h.expenses, 0) / history.length
    : fixedMonthly + (p.avg_variable_expenses_3m || 0);
  L.push('\nRATIOS CLÉS (pré-calculés — fiables)');
  if (income > 0) {
    L.push(`- Revenu de référence utilisé pour ces ratios : ${m(income)}/mois (base : ${incomeBase}). Tout pourcentage que tu cites doit être cohérent avec CE montant.`);
    if (incomeRef && incomeRef.source === 'recettes' && incomeRef.transfersAvg > 0) {
      L.push(`- En parallèle : virements entrants sur les comptes courants depuis un compte « autre » ≈ ${m(incomeRef.transfersAvg)}/mois (rentrées encaissées ailleurs puis rapatriées — à considérer comme du revenu complémentaire, pas comme une anomalie).`);
    }
    L.push(`- Taux de mise de côté planifié (épargne + investissement) : ${Math.round((plannedSetAside / income) * 100)} % du revenu.`);
    /* Réserve de sécurité en MOIS DE DÉPENSES ESSENTIELLES. La base était le REVENU : c'était la
       formulation du questionnaire, mais pas la bonne mesure — ce qu'il faut couvrir quand le revenu
       s'arrête, c'est ce qu'on DÉPENSE pour vivre. Quelqu'un qui gagne 4 000 € et vit avec 2 000 €
       « tenait 3 mois » avec 12 000 € de côté : il en tient six (cf. lib/securityCushion). */
    const essential = (p as any).monthly_essential_expenses || 0;
    const cushionBase = essential > 0 ? essential : income;
    const cushionWhat = essential > 0 ? 'dépenses' : 'revenus (charges non renseignées)';
    L.push(`- Réserve de sécurité : l'épargne (${m(p.total_savings)}) couvre ~${(p.total_savings / cushionBase).toFixed(1)} mois de ${cushionWhat}. Dépenses essentielles mensuelles = ${m(essential)} (charges récurrentes + budget variable). À citer ainsi : « de quoi tenir ~X mois sans rentrée d'argent ».`);
    // Indépendance financière : le patrimoine investi couvre combien d'années de train de vie.
    if (p.total_invested > 0) L.push(`- Indépendance : le patrimoine investi (${m(p.total_invested)}) représente ~${(p.total_invested / (income * 12)).toFixed(1)} an(s) de revenu de référence.`);
    // Plus-value latente d'investissement (si les versements sont connus) — dit si le patrimoine
    // croît par l'effort d'épargne ou par les marchés.
    if (investContributed != null && investContributed > 0) {
      const pv = p.total_invested - investContributed;
      const pvPct = Math.round((pv / investContributed) * 100);
      L.push(`- Investissement : ${m(p.total_invested)} pour ${m(investContributed)} versés → plus-value latente ~${pv >= 0 ? '+' : ''}${m(pv)} (${pvPct >= 0 ? '+' : ''}${pvPct} %). ⚠ INDICATIF (valeurs saisies par l'utilisateur), pas une performance certifiée.`);
    }
  } else {
    L.push(`- Aucun revenu de référence calculable : aucune recette saisie sur la fenêtre. L'utilisateur n'a probablement pas encore saisi ses revenus — NE calcule AUCUN pourcentage du revenu, et suggère de saisir ses revenus en recettes (idéalement récurrentes).`);
  }

  // ── ENGAGEMENTS MENSUELS consolidés — tue le bug « fixes % + crédits % additionnés = 95 % ». Les
  // buckets sont CHOISIS pour ne PAS se recouper : charges récurrentes directes (hors crédits) +
  // crédits sur comptes PERSO (impact 100 %) + contribution au foyer (qui couvre les crédits/charges
  // JOINTS, comptés à part < 100 %). On donne UN total et on interdit toute addition de « poids ».
  const engaged = deriveEngaged(credits, fixedMonthly, jointContributionMonthly);
  const totalEngaged = engaged.total;
  {
    const { ownCredits, jointCredits } = engaged;
    if (totalEngaged > 0) {
      L.push('\nENGAGEMENTS MENSUELS À CHARGE (consolidés — utilise le TOTAL, n\'additionne JAMAIS des « poids » séparés)');
      if (fixedMonthly > 0) L.push(`- Charges récurrentes directes (hors crédits) : ~${m(fixedMonthly)}/mois.`);
      if (ownCredits > 0) L.push(`- Crédits sur comptes perso (à 100 % à sa charge) : ~${m(ownCredits)}/mois.`);
      if (jointContributionMonthly > 0) L.push(`- Contribution au compte JOINT (couvre sa part des crédits/charges du foyer) : ~${m(jointContributionMonthly)}/mois.`);
      L.push(`- TOTAL ENGAGÉ : ~${m(totalEngaged)}/mois${income > 0 ? ` = ${Math.round((totalEngaged / income) * 100)} % du revenu de référence` : ''}${realMonthlyIncome > income ? ` (mais seulement ${Math.round((totalEngaged / realMonthlyIncome) * 100)} % du revenu réel moyen des prochains mois ${m(realMonthlyIncome)}/mois — cf. revenus attendus mois par mois)` : ''}.`);
      if (jointCredits > 0) L.push(`- ⚠ Les crédits du FOYER (~${m(jointCredits)}/mois à sa part) sont DÉJÀ couverts par la contribution ci-dessus : ne les compte PAS en plus. Le seul chiffre juste est le TOTAL ENGAGÉ.`);
    }
  }

  // ── SCORE DE SANTÉ pré-calculé (transparent, stable) — le modèle le RECOPIE, il ne le recalcule
  // pas. Mois fiables = mois complets, hors 1ᵉʳ mois (saisie incomplète) et hors mois exceptionnels.
  if (income > 0) {
    const reliable = history.filter((h, i) => !(firstMonthPartial && i === 0) && h.income <= income * 2.5 && h.income > 0);
    const avgNet = reliable.length ? reliable.reduce((t, h) => t + (h.income - h.expenses), 0) / reliable.length : null;
    const projMin = forecast.length ? Math.min(...forecast.map((f) => f.balance)) : null;
    const sc = computeHealthScore({
      income,
      realIncome: Math.max(realMonthlyIncome, income),
      savings: p.total_savings,
      invested: p.total_invested,
      engagedMonthly: totalEngaged,
      setAsideMonthly: plannedSetAside,
      projectionMin: projMin,
      margin: p.safety_margin_amount || 0,
      avgNet,
      reliableMonths: reliable.length,
      // Base du matelas partout dans l'app : les DÉPENSES (cf. lib/securityCushion).
      essentialMonthly: (p as any).monthly_essential_expenses || 0,
    });
    L.push('\nSCORE DE SANTÉ FINANCIÈRE (pré-calculé — RECOPIE ce score et ces sous-scores, ne les recalcule pas)');
    L.push(`- Score global : ${sc.global}/100 (moyenne pondérée des sous-scores disponibles).`);
    for (const part of sc.parts) {
      L.push(`- ${part.label} (${part.weight} %) : ${part.score == null ? '— (trop tôt pour juger)' : `${part.score}/100`} · ${part.why}.`);
    }
  }

  // ── ÉVOLUTION DEPUIS LE DERNIER BILAN — répond à la question implicite n°1 : « je vais dans le
  // bon sens ? ». Compare quelques métriques top-line au dernier bilan global persisté.
  if (evolution) {
    const { previous: a, current: b, previousDate } = evolution;
    const delta = (cur: number, prev: number) => {
      const d = Math.round(cur - prev);
      return `${d >= 0 ? '+' : '−'}${m(Math.abs(d))}`;
    };
    L.push(`\nÉVOLUTION DEPUIS LE DERNIER BILAN (${previousDate}) — pour dire s'il va dans le bon sens (commence ton bilan par ça)`);
    L.push(`- Patrimoine : ${delta(b.patrimoine, a.patrimoine)} (${m(a.patrimoine)} → ${m(b.patrimoine)}).`);
    L.push(`- Comptes courants : ${delta(b.checking, a.checking)} · Épargne : ${delta(b.savings, a.savings)} · Investissement : ${delta(b.invested, a.invested)}.`);
    L.push(`- Engagements mensuels : ${delta(b.engaged, a.engaged)} · Solde projeté à 12 mois : ${delta(b.balance12, a.balance12)}.`);
    if (a.score > 0 && b.score > 0) L.push(`- Score : ${a.score} → ${b.score} (${b.score - a.score >= 0 ? '+' : ''}${b.score - a.score}).`);
    L.push(`- ⚠ Lis cette évolution comme la tendance de fond (le patrimoine qui monte alors que la trésorerie baisse = tu transformes du cash en patrimoine, pas un problème). Un écart peut venir d'une saisie complétée entre deux bilans, pas seulement d'un vrai mouvement.`);
  }

  L.push('\nTRÉSORERIE');
  /* Le Relyka EN PREMIER : c'est le seul de ces deux montants que l'utilisateur voit. Sans lui,
     l'IA raisonnait sur « safe to spend » et lui annonçait un budget bien plus large que celui
     affiché sur son tableau de bord — deux chiffres pour la même question, à deux endroits de la
     même app. On donne les deux, en disant lequel fait foi devant l'utilisateur. */
  if (relyka != null && Number.isFinite(relyka)) {
    L.push(`- ⭐ RELYKA (le budget libre AFFICHÉ à l'utilisateur, celui auquel il se réfère) : ${m(relyka)} — point bas de trésorerie MOINS les virements d'épargne/investissement prévus, les sommes réservées, l'enveloppe de dépenses variables restante et la marge de sécurité. Si tu cites un « budget libre » ou « ce qu'il te reste », c'est CE montant, pas celui de la ligne suivante.`);
  }
  L.push(`- Reste à vivre estimé (« safe to spend », indicateur INTERNE, plus large que le Relyka car il ne déduit ni l'enveloppe variable ni les sommes réservées — ne le cite pas tel quel à l'utilisateur) : ${m(p.safe_to_spend)} — déjà NET de la marge de sécurité ci-dessous (ce n'est PAS un signe de tension).`);
  L.push(`- Marge de sécurité conservée EN PLUS (Somme qu'on souhaite avoir au minimum sur ses comptes courants, non comprise dans le reste à vivre) : ${m(p.safety_margin_amount)}`);
  L.push(`- Point bas projeté sur quelques mois : ${m(p.projection_min_buffer)}${p.projection_in_danger ? ' (⚠ tension de trésorerie)' : ''}`);
  if (p.expected_monthly_income > 0) {
    L.push(`- Prochaine rentrée récurrente détectée : ${m(p.expected_monthly_income)} (fiabilité ${Math.round(p.expected_income_confidence * 100)}%, source ${p.expected_income_source}). ⚠ C'est la PLUS GROSSE rentrée récurrente (sert au calcul du creux de trésorerie), PAS le revenu total : le revenu total = le revenu de référence des RATIOS CLÉS.`);
  }
  // Revenus ATTENDUS mois par mois (recettes saisies, overrides inclus) : bien plus juste qu'une
  // seule ligne pour un indépendant dont le revenu varie. C'est le vrai revenu des prochains mois.
  if (incomeByMonth.length > 0 && incomeByMonth.some((r) => r.income > 0)) {
    L.push(`- Revenus attendus mois par mois (recettes déjà saisies pour ces mois) : ${incomeByMonth.map((r) => `${r.ym} : ${m(r.income)}`).join(' · ')}.`);
    if (income > 0) L.push(`- ⚠ Si ces revenus attendus sont RÉGULIÈREMENT au-dessus du revenu de référence (${m(income)}), c'est que la référence — lissée sur un historique court/incomplet — SOUS-ESTIME le vrai train de vie : pondère tes jugements d'endettement en conséquence, et invite l'utilisateur à vérifier/compléter ses revenus dans l'app.`);
  }
  if (realMonthlyIncome > 0) {
    L.push(`- ⚠ Ces indicateurs de revenu peuvent différer entre eux (déclaration partielle, rentrée exceptionnelle dans la moyenne…). La référence de train de vie = le revenu de référence des RATIOS CLÉS. Un écart entre indicateurs n'est PAS une priorité d'action : au plus une phrase.`);
  }

  if (forecast.length > 1) {
    const first = forecast[0].balance;
    const last = forecast[forecast.length - 1].balance;
    const minF = Math.min(...forecast.map((f) => f.balance));
    const at = (k: number) => forecast[Math.min(k, forecast.length - 1)].balance;
    L.push(`\nPROJECTION DU SOLDE COURANT sur ${forecast.length} mois (fin de mois — MÊMES chiffres que l'onglet Projection de l'app : récurrentes + variables estimées + mises de côté prévues déjà comptées, y compris les CHANGEMENTS À VENIR ci-dessous)`);
    L.push('- ' + forecast.map((f) => `${f.ym} : ${m(f.balance)}`).join(' · '));
    L.push(`- Repères à CITER tels quels : solde courant dans 6 mois ≈ ${m(at(5))} · dans 12 mois ≈ ${m(at(11))} (aujourd'hui : comptes courants ${m(p.total_checking)}).`);
    if (savingsInvestForecast) {
      const f = savingsInvestForecast;
      L.push(`- Épargne projetée (virements déjà saisis, HORS rendement) : ≈ ${m(f.savings6)} dans 6 mois · ≈ ${m(f.savings12)} dans 12 mois (aujourd'hui ${m(f.savingsNow)}).`);
      L.push(`- Investissement projeté (versements déjà saisis, HORS rendement — n'invente pas de performance) : ≈ ${m(f.invest6)} dans 6 mois · ≈ ${m(f.invest12)} dans 12 mois (aujourd'hui ${m(f.investNow)}).`);
    }
    // Garde-fou MARGE × PROJECTION — les recommandations de l'app plafonnent épargne+invest pour
    // que le point bas des 6 PROCHAINS mois reste au-dessus de la marge (même fenêtre que l'app).
    const margin = Math.max(0, p.safety_margin_amount || 0);
    const guardWindow = forecast.slice(0, 6);
    if (margin > 0 && guardWindow.length > 0) {
      const minG = Math.min(...guardWindow.map((f) => f.balance));
      const headroom = Math.round(minG - margin);
      // Montant récurrent MENSUEL max soutenable : au mois k (0 = courant), k+1 exécutions cumulées.
      const maxRecurring = Math.floor(Math.max(0, Math.min(...guardWindow.map((f, k) => (f.balance - margin) / (k + 1)))) / 10) * 10;
      if (headroom <= 0) {
        L.push(`- ⚠ Le point bas projeté à 6 mois (${m(minG)}) est SOUS la marge de sécurité (${m(margin)}) : l'app recommande de tout CONSERVER ce mois-ci. Ne recommande AUCUNE mise de côté supplémentaire (épargne ou investissement) — aide plutôt à redresser la trajectoire.`);
      } else {
        L.push(`- Marge de sécurité ${m(margin)} · point bas projeté à 6 mois ${m(minG)} → capacité de mise de côté PONCTUELLE ce mois-ci ≤ ${m(headroom)} (au-delà, le solde projeté passerait sous la marge — l'app plafonne ses recommandations à ce montant, fais pareil).`);
        L.push(`- En VIREMENT RÉCURRENT mensuel (épargne + investissement cumulés) : max soutenable ≈ ${m(maxRecurring)}/mois sur 6 mois sans entamer la marge. Ne recommande jamais un récurrent au-delà.`);
      }
    }
    if (last < first - 1 || minF < 0) {
      L.push(`- ⚠ Le solde projeté ${minF < 0 ? 'passe en NÉGATIF' : 'BAISSE sur la période'} : ne recommande PAS de virement automatique mensuel supplémentaire — préfère des allocations PONCTUELLES décidées mois par mois, et explique pourquoi.`);
    } else {
      L.push('- Le solde projeté tient sur la période : des mises de côté régulières sont envisageables dans la limite du surplus (et des plafonds ci-dessus).');
    }
  }

  // PROJECTIONS PRÊTES À CITER : tout est pré-calculé ici — le modèle recopie, il ne calcule pas
  // (les modèles légers se trompent systématiquement sur les intérêts composés et les trajectoires).
  {
    const ready: string[] = [];
    // Mois « normaux » = hors rentrées exceptionnelles (déjà signalées dans LIMITES).
    const normal = history.filter((h) => income <= 0 || h.income <= income * 2.5);
    if (normal.length >= 2) {
      const avgNet = normal.reduce((t, h) => t + (h.income - h.expenses), 0) / normal.length;
      const patrimoine = p.total_checking + p.total_savings + p.total_invested;
      ready.push(`Patrimoine dans 12 mois au rythme actuel (solde mensuel moyen des mois complets normaux : ${avgNet >= 0 ? '+' : ''}${r0(avgNet)} ${s}/mois, mises de côté comprises) : ≈ ${m(patrimoine + 12 * avgNet)}.`);
    }
    const surplus = p.projected_surplus || 0;
    if (surplus > 0) {
      const fv = (years: number) => { const r = 0.05 / 12; const n = years * 12; return surplus * ((Math.pow(1 + r, n) - 1) / r); };
      ready.push(`Si le surplus projeté de ${m(surplus)}/mois était investi chaque mois à 5 %/an (hypothèse indicative) : ≈ ${m(fv(5))} au bout de 5 ans (dont ${m(surplus * 60)} de versements), ≈ ${m(fv(10))} au bout de 10 ans (dont ${m(surplus * 120)} de versements).`);
    }
    if (income > 0) {
      // Même base que ci-dessus : les DÉPENSES à couvrir, avec repli sur le revenu.
      const base6 = ((p as any).monthly_essential_expenses || 0) > 0 ? (p as any).monthly_essential_expenses : income;
      const cushion6 = (p.total_savings + 6 * (p.monthly_savings_planned || 0)) / base6;
      ready.push(`Réserve de sécurité dans 6 mois au rythme d'épargne planifié : ≈ ${cushion6.toFixed(1)} mois de dépenses (aujourd'hui : ${(p.total_savings / base6).toFixed(1)}).`);
    }
    if (ready.length) {
      L.push('\nPROJECTIONS PRÊTES À CITER (pré-calculées — recopie ces chiffres TELS QUELS, n\'en recalcule aucun)');
      for (const x of ready) L.push(`- ${x}`);
    }
  }

  // CHANGEMENTS DÉJÀ SAISIS À VENIR (12 mois) : fins/débuts de récurrences, crédits qui se
  // terminent, ponctuelles futures — le train de vie de DEMAIN n'est pas celui d'aujourd'hui,
  // l'IA doit anticiper au lieu de projeter le présent à l'infini.
  {
    const KIND_FR: Record<string, string> = {
      expense: 'charge récurrente', income: 'revenu récurrent',
      transfer_saving: 'virement récurrent vers ÉPARGNE', transfer_invest: 'virement récurrent vers INVESTISSEMENT',
      transfer_other: 'virement récurrent',
    };
    const chg: string[] = [];
    let monthlyDelta = 0; // impact net sur la capacité mensuelle une fois les changements passés
    for (const e of upcoming?.endings ?? []) {
      const per = `${m(e.amount)}/${RULE_FR[e.rule] ?? e.rule}`;
      const eq = e.amount * (RULE_MONTHLY[e.rule] ?? 1);
      if (e.kind === 'expense') {
        monthlyDelta += eq;
        chg.push(`FIN d'une ${KIND_FR[e.kind]} « ${e.category} » (${per}) : dernière échéance ${e.ym} → ~${m(eq)}/mois libérés ensuite.`);
      } else if (e.kind === 'income') {
        monthlyDelta -= eq;
        chg.push(`⚠ FIN d'un ${KIND_FR[e.kind]} « ${e.category} » (${per}) : dernière rentrée ${e.ym} → le revenu BAISSERA de ~${m(eq)}/mois après cette date. Anticipe (ajuste les mises de côté AVANT, pas après).`);
      } else {
        chg.push(`FIN d'un ${KIND_FR[e.kind]} « ${e.category} » (${per}) en ${e.ym} : la mise de côté s'arrête — demande si c'est voulu (fin d'objectif ?) ou un oubli à prolonger.`);
      }
    }
    for (const e of upcoming?.starts ?? []) {
      const per = `${m(e.amount)}/${RULE_FR[e.rule] ?? e.rule}`;
      const eq = e.amount * (RULE_MONTHLY[e.rule] ?? 1);
      if (e.kind === 'expense') monthlyDelta -= eq;
      if (e.kind === 'income') monthlyDelta += eq;
      chg.push(`NOUVEAU ${e.kind === 'expense' ? 'engagement' : e.kind === 'income' ? 'revenu récurrent' : KIND_FR[e.kind]} « ${e.category} » (${per}) à partir de ${e.ym}.`);
    }
    // Crédits qui se terminent dans les 12 mois → mensualité libérée (déjà pondérée par la part).
    const horizonYM = `${Number(today.slice(0, 4)) + 1}${today.slice(4, 7)}`;
    credits.forEach((cr, i) => {
      if (cr.impactPct <= 0 || !cr.endYM || cr.monthly <= 0) return;
      if (cr.endYM >= today.slice(0, 7) && cr.endYM <= horizonYM) {
        monthlyDelta += cr.monthly;
        chg.push(`FIN du crédit ${i + 1} en ${cr.endYM} → mensualité de ~${m(cr.monthly)}/mois libérée (belle occasion de rediriger ce montant vers l'épargne/l'investissement).`);
      }
    });
    for (const o of (upcoming?.oneOffs ?? []).slice(0, 8)) {
      chg.push(`${o.income ? 'Rentrée' : 'Dépense'} ponctuelle FUTURE déjà saisie : ${o.date} · ${o.category} : ${o.income ? '+' : '−'}${m(o.amount)} (déjà comptée dans la PROJECTION).`);
    }
    if (chg.length) {
      L.push('\nCHANGEMENTS DÉJÀ SAISIS À VENIR (12 prochains mois — le train de vie va CHANGER : intègre-les dans tes conseils au lieu de projeter le présent)');
      for (const x of chg) L.push(`- ${x}`);
      if (Math.round(monthlyDelta) !== 0) {
        L.push(`- Une fois tous ces changements passés, le budget mensuel courant ${monthlyDelta >= 0 ? 'gagnera' : 'perdra'} ~${m(Math.abs(monthlyDelta))}/mois vs aujourd'hui (hors virements internes). L'EFFET CONCRET sur le solde est déjà intégré dans la PROJECTION ci-dessus : cite les soldes à 6/12 mois plutôt que ce delta abstrait.`);
      }
    }
  }

  if (history.length) {
    L.push(`\nHISTORIQUE MENSUEL (${history.length} mois COMPLETS — la référence pour les tendances)`);
    history.forEach((h, i) => {
      const star = firstMonthPartial && i === 0 ? '*' : '';
      L.push(`- ${h.ym}${star} : revenus ${m(h.income)}, dépenses ${m(h.expenses)} (fixes ${m(h.fixed)} / variables ${m(h.variable)})${h.income > 0 ? `, solde ${h.income - h.expenses >= 0 ? '+' : ''}${r0(h.income - h.expenses)} ${s}` : ''}.`);
    });
    if (firstMonthPartial) {
      L.push(`- * = 1ᵉʳ mois d'utilisation de l'app : la saisie est probablement INCOMPLÈTE ce mois-là (compte créé en cours de mois, revenus/dépenses pas tous saisis) — ne l'utilise NI pour une tendance, NI pour une moyenne.`);
    }
  }

  // ── PÉRIMÈTRE — placé AVANT les chiffres : la règle de lecture doit être connue avant les
  // montants. Sans elle, un virement récurrent (contribution au foyer, mise de côté) était pris
  // pour une dépense « à optimiser » dès qu'une ligne de dépense lui ressemblait par le montant.
  L.push('\nPÉRIMÈTRE DES DÉPENSES (règle de lecture — applique-la avant d\'interpréter le moindre montant)');
  L.push('- Les dépenses ci-dessous EXCLUENT tous les virements internes : épargne, investissement, contribution à un compte joint. Un virement ne peut PAS apparaître comme une dépense, dans aucune section, à aucun total.');
  if (jointContributionMonthly > 0) {
    L.push(`- La contribution au compte joint (~${m(jointContributionMonthly)}/mois) figure UNIQUEMENT dans ENGAGEMENTS MENSUELS. Ne la cherche pas dans les dépenses, ne l'additionne pas avec elles, et ne propose pas de la « réduire » : c'est un engagement du foyer, pas un poste compressible.`);
  }
  L.push('- Corollaire IMPORTANT : si une ligne de dépense ressemble à une mise de côté (montant rond, catégorie générique type « Autres / Divers / Frais variables »), ce n\'en est PAS une. Soit c\'est une vraie dépense, soit l\'utilisateur a saisi un VIREMENT comme une DÉPENSE. Dans ce second cas, dis-le-lui explicitement (« cette ligne semble être un virement saisi en dépense — enregistre-la en virement pour que tes ratios soient justes ») au lieu de conseiller de la réduire.');

  L.push('\nDÉPENSES (hors virements internes)');
  if (fixedMonthly > 0) L.push(`- Dépenses FIXES / engagements récurrents : ~${m(fixedMonthly)}/mois (total des charges récurrentes actives listées plus bas) ; encore À VENIR ce mois-ci : ${m(p.remaining_fixed_expenses)}.`);
  {
    // Référence des variables = l'ENVELOPPE du pilotage (la même que celle affichée dans l'app) :
    // calculée sur l'historique des mois fiables, sinon estimée au questionnaire d'inscription.
    const envelope = p.variable_envelope_initial || 0;
    const envelopeSrc = p.variable_envelope_source === 'history'
      ? `calculée sur l'historique (${p.variable_envelope_months_used} mois fiables)`
      : p.variable_envelope_source === 'onboarding' ? 'estimée à l\'inscription (questionnaire)' : 'non estimée';
    const spentVar = p.variable_envelope_spent || 0;
    let paceTxt = '';
    if (envelope > 0 && spentVar >= envelope && dayOfMonth < daysInMonth - 3) {
      paceTxt = ` — ⚠ l'enveloppe MENSUELLE est DÉJÀ atteinte/dépassée au jour ${dayOfMonth} : c'est un dépassement net, pas « dans la moyenne »`;
    } else if (envelope > 0 && dayOfMonth >= 5) {
      const pace = (spentVar / dayOfMonth) * daysInMonth;
      const delta = Math.round(((pace - envelope) / envelope) * 100);
      paceTxt = ` — rythme projeté ≈ ${m(pace)} sur le mois (${delta >= 0 ? '+' : ''}${delta} % vs enveloppe, indicatif en début de mois)`;
    }
    L.push(`- Dépenses VARIABLES : enveloppe mensuelle ${m(envelope)} (${envelopeSrc} — c'est LA référence pour les variables) ; dépensé ce mois ${m(spentVar)} au jour ${dayOfMonth}/${daysInMonth}, reste ${m(p.variable_envelope_remaining)}${paceTxt}.`);
  }
  L.push(`- Total dépenses du mois (partiel) : ${m(p.month_expenses_total)} (déjà passées ${m(p.month_expenses_past)}, encore à venir ${m(p.month_expenses_remaining)} — distingue bien le réalisé du prévu dans tes conseils).`);
  if (expensesByCategory.length) {
    L.push('- Détail par grande catégorie (mois en cours, partiel) :');
    for (const c of expensesByCategory.slice(0, 12)) if (c.amount > 0) L.push(`  • ${c.name} : ${m(c.amount)}`);
  }

  if (categoryTrends.length) {
    const months = history.map((h) => h.ym);
    L.push('\nDÉPENSES PAR GRANDE CATÉGORIE ET PAR MOIS COMPLET (lis les mois, pas seulement la moyenne)');
    L.push('- ⚠ Une catégorie qui n\'apparaît qu\'à partir d\'un mois récent = RÉORGANISATION (nouvelle saisie, prélèvements déplacés — ex. vers un compte joint), PAS une dérive ni une anomalie à « investiguer ».');
    for (const t of categoryTrends.slice(0, 12)) {
      const perMonth = months.map((ym) => `${ym.slice(5)} : ${m(t.byMonth[ym] ?? 0)}`).join(' · ');
      L.push(`- ${t.name} : ${perMonth} (moyenne ${m(t.avg)}/mois).`);
    }
  }

  if (variableDetail.length) {
    L.push('\nDÉTAIL DES DÉPENSES PONCTUELLES/VARIABLES PAR SOUS-CATÉGORIE (tous comptes courants confondus — la matière pour des conseils CONCRETS poste par poste)');
    for (const md of variableDetail) {
      L.push(`- ${md.ym}${md.isCurrent ? ' (mois en cours, partiel)' : ' (mois complet)'} :`);
      for (const it of md.items) L.push(`  • ${it.category} : ${m(it.amount)} (${it.count} opération${it.count > 1 ? 's' : ''})`);
    }
  }

  if (recurringExpenses.length) {
    // La nature vient du RÉGLAGE de la catégorie dans l'app, plus d'une devinette sur son nom :
    // « Autres frais variables » pouvait désigner une enveloppe de dépenses courantes comme un
    // engagement bien réel, et l'ancienne note tranchait à tort pour l'un des deux.
    L.push(`\nCHARGES RÉCURRENTES ACTIVES (${recurringExpenses.length}) — chaque ligne porte sa nature, telle qu'elle est réglée dans l'app : [charge fixe] = engagement contractuel (résiliable ou non, mais subi) · [enveloppe variable] = budget de dépenses courantes, PAS un abonnement à résilier.`);
    for (const r of recurringExpenses.slice(0, 20)) {
      const nature = r.variable === false ? ' [charge fixe]' : r.variable === true ? ' [enveloppe variable]' : '';
      L.push(`- ${r.category} : ${m(r.amount)}/${RULE_FR[r.rule] ?? r.rule}${nature}`);
    }
  }
  if (recurringIncomes.length) {
    // ⚠ Ces revenus ont souvent des montants surchargés PAR MOIS (indépendant) → un « X/mois » figé
    // induit en erreur. On donne la MOYENNE réelle des prochains mois et on renvoie au détail mensuel.
    L.push(`\nSOURCES DE REVENU RÉCURRENTES (${recurringIncomes.length}) — ⚠ montants VARIABLES selon les mois : n'utilise PAS un montant par ligne comme s'il était permanent. Le vrai revenu = « Revenus attendus mois par mois » ci-dessus${realMonthlyIncome > 0 ? `, moyenne réelle ≈ ${m(realMonthlyIncome)}/mois sur les 6 prochains mois` : ''}.`);
    for (const r of recurringIncomes.slice(0, 8)) L.push(`- ${r.category} (dernière échéance ~${m(r.amount)}, varie selon les mois).`);
  }

  if (topOneOff.length) {
    L.push('\nDÉPENSES PONCTUELLES NOTABLES (récentes, non récurrentes — contexte, pas forcément un problème)');
    for (const t of topOneOff.slice(0, 8)) L.push(`- ${t.date} · ${t.category} : ${m(t.amount)}`);
  }

  L.push('\nVIREMENTS INTERNES (NE sont PAS des dépenses — ce sont des mises de côté)');
  if (recurringTransfers.length) {
    // Listés NOMMÉMENT : sans ça, seuls des agrégats existaient, et l'IA ne pouvait pas rapprocher
    // un montant vu ailleurs d'un virement déjà connu — d'où des « dépenses » fantômes à optimiser.
    L.push(`- Virements récurrents en place (${recurringTransfers.length}) — déjà comptés ci-dessous et dans la projection, à NE PAS retrouver dans les dépenses :`);
    for (const t of recurringTransfers.slice(0, 12)) {
      L.push(`  • vers ${t.dest} : ${m(t.amount)}/${RULE_FR[t.rule] ?? t.rule}`);
    }
  }
  L.push(`- Vers ÉPARGNE : ${m(p.monthly_savings_planned)}/mois prévus (déjà réalisés ce mois ${m(p.real_savings_excl_projects)}, encore à venir ${m(p.monthly_savings_remaining)}).`);
  L.push(`- Vers INVESTISSEMENT : ${m(p.monthly_invest_planned)}/mois prévus (déjà réalisés ce mois ${m(p.real_invest)}, encore à venir ${m(p.monthly_invest_remaining)}).`);
  L.push(`- Recommandation du moteur pour le surplus : ${p.recommendation} (surplus projeté ${m(p.projected_surplus)}).`);
  if (p.allocation_save_percent != null || p.allocation_invest_percent != null) {
    L.push(`- Répartition du surplus paramétrée par l'utilisateur : épargne ${Math.round(p.allocation_save_percent ?? 0)} % / investissement ${Math.round(p.allocation_invest_percent ?? 0)} % (le reste = confort/libre). Pars de cette répartition, ne l'invente pas.`);
  }

  if (sharedAccounts.length) {
    L.push(`\nCOMPTES PARTAGÉS / JOINTS (${sharedAccounts.length}) — une partie de la vie du foyer passe par là. Le MODE de chaque compte change TOUT le traitement de ses flux :`);
    sharedAccounts.forEach((a, i) => {
      const typeFr = a.type === 'checking' ? 'courant' : a.type === 'savings' ? 'épargne' : a.type === 'investment' ? 'investissement' : a.type;
      const modeTxt = a.mode === 'contribution'
        ? 'mode CONTRIBUTION : ce compte est HORS du budget quotidien de l\'utilisateur — ses prélèvements (crédits, charges…) ne sont PAS ses dépenses directes ; seul son virement de contribution vers ce compte compte (comme une dépense fixe). Virer régulièrement vers ce compte pour couvrir les prélèvements du foyer = comportement SAIN, pas une fuite d\'argent'
        : `mode QUOTIDIEN : ses flux sont inclus dans le budget de l'utilisateur, pondérés à ${Math.round(a.impactPct)} %`;
      L.push(`- Compte ${a.joint ? 'JOINT' : 'partagé'} ${i + 1} (${typeFr}) : ${modeTxt}.`);
    });
    L.push('- Les mensualités de crédits prélevées sur ces comptes sont DÉJÀ pondérées par sa part dans la section CRÉDITS. Une contribution récurrente versée à un compte joint (part de crédit, copropriété, charges du foyer) est un ENGAGEMENT FIXE du foyer : ce n\'est ni une dépense compressible, ni une anomalie.');
  }

  if (projects.length) {
    L.push(`\nPROJETS (${projects.length}) — la progression dépend de l'ANCIENNETÉ : un projet récent à faible % est NORMAL`);
    projects.forEach((pr, i) => {
      const age = pr.startISO ? monthsBetween(pr.startISO, today) : null;
      const ageTxt = age == null ? '' : age <= 0 ? ', démarré ce mois-ci' : `, démarré il y a ${age} mois`;
      // Nature du projet : ce qu'il fait vraiment (dépenses / réservation / virements + destination).
      const destTxt = pr.mode === 'spend'
        ? ', ce projet GÉNÈRE DES DÉPENSES au fil du temps (déjà comptées dans les dépenses et la projection — ce n\'est PAS de l\'épargne)'
        : pr.mode === 'reserve' ? ', montant RÉSERVÉ sur le compte courant (l\'argent ne bouge pas)'
        : pr.destType === 'investment' ? ', virements courant → INVESTISSEMENT (ce projet consiste à investir)'
        : pr.destType === 'savings' ? ', virements courant → ÉPARGNE (ce projet consiste à épargner)'
        : pr.destType === 'checking' ? ', provision conservée sur le COURANT' : '';
      L.push(`- Projet ${i + 1} : cible ${m(pr.target)}, ${m(pr.monthly)}/mois, ${Math.round(pr.progressPct)}% atteint${ageTxt}${destTxt} (${pr.status}).`);
    });
  }

  if (credits.length) {
    L.push(`\nCRÉDITS (${credits.length}) — tiens compte du % D'IMPACT (part réellement à ta charge)`);
    credits.forEach((cr, i) => {
      if (cr.impactPct <= 0) {
        L.push(`- Crédit ${i + 1} : impact 0 % → NE PÈSE PAS sur les finances de cet utilisateur (payé par quelqu'un d'autre). À IGNORER dans les conseils.`);
      } else {
        const share = cr.impactPct < 100 ? ` (part à sa charge : ${cr.impactPct} %)` : '';
        const rem = cr.remainingMonths != null && cr.remainingMonths > 0 ? `, ${cr.remainingMonths} mensualités restantes` : '';
        L.push(`- Crédit ${i + 1} : mensualité à sa charge ${m(cr.monthly)}${share}, capital restant dû ~${m(cr.crd)}, taux ${cr.ratePct} %${rem}${cr.endYM ? `, fin ${cr.endYM}` : ''}.`);
      }
    });
  }

  // Limites AUTO-DÉTECTÉES des données : calibre la prudence de l'IA et lui permet de suggérer les
  // bons gestes DANS L'APP (catégoriser, marquer une récurrente…) plutôt que des conseils bancals.
  const limits: string[] = [];
  if (history.length > 0 && history.length < 3) limits.push(`Historique court (${history.length} mois complet${history.length > 1 ? 's' : ''}) : ne parle de « tendance » qu'avec beaucoup de prudence.`);
  if (incomeRef && incomeRef.source === 'none') {
    limits.push(`AUCUNE recette saisie sur la fenêtre (≤ 6 mois) : l'utilisateur n'a probablement pas encore saisi ses revenus (fréquent au 1ᵉʳ mois). Ne conclus PAS qu'il n'a pas de revenus ; suggère de les saisir en recettes récurrentes.`);
  } else if (incomeRef && incomeRef.source === 'virements') {
    limits.push(`Le revenu de référence vient de VIREMENTS reçus depuis un compte « autre » (aucune recette saisie) : c'est une approximation — suggère de saisir les vrais revenus en recettes pour des conseils plus précis.`);
  } else if (incomeRef && incomeRef.monthsWithoutIncome >= 2) {
    limits.push(`${incomeRef.monthsWithoutIncome} mois de la fenêtre ont de l'activité mais AUCUNE recette : revenus irréguliers ou saisie incomplète — reste prudent sur les % du revenu et évoque la saisie des revenus manquants.`);
  }
  if (income > 0) {
    for (const h of history) {
      if (h.income > income * 2.5) limits.push(`Le mois ${h.ym} contient des rentrées exceptionnelles (${m(h.income)}) : événement PONCTUEL, pas une tendance — ne bâtis pas de conseil récurrent dessus.`);
    }
  }
  const uncat = categoryTrends.find((t) => t.name === 'Sans catégorie');
  if (uncat && uncat.avg >= 30) limits.push(`~${m(uncat.avg)}/mois de dépenses NON CATÉGORISÉES : les analyses par poste sont incomplètes — suggère de les catégoriser dans l'app.`);
  if (recurringExpenses.length === 0 && avgExpenses > 0) limits.push(`Aucune charge récurrente n'est marquée dans l'app : le poids réel des dépenses fixes est INCONNU — ne conclus pas à leur absence ; suggère de marquer les dépenses récurrentes.`);
  if (recurringIncomes.length === 0) limits.push(`Aucun revenu récurrent n'est marqué comme RECETTE dans l'app (les rentrées sont peut-être saisies comme des virements) : le revenu détecté est PEU FIABLE — reste prudent sur les % du revenu et suggère de marquer les salaires/revenus en recettes récurrentes pour des conseils plus justes.`);
  if (limits.length) {
    L.push('\nLIMITES DES DONNÉES (à respecter, sans en faire un paragraphe)');
    for (const x of limits) L.push(`- ${x}`);
  }

  return L.join('\n');
}

function monthsBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + 'T00:00:00'); const b = new Date(toISO + 'T00:00:00');
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}
