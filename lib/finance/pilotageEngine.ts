/**
 * MOTEUR DU PILOTAGE — calcul pur : Relyka, point bas de trésorerie, enveloppe variable,
 * engagements du mois, trajectoires de projection.
 *
 * Extrait de `hooks/usePilotageData.ts`, qui mêlait ce calcul aux requêtes Supabase et au cache
 * react-query. Ce mélange le rendait INTESTABLE : importer le calcul tirait `lib/supabase`, donc
 * `react-native`, donc l'impossibilité de l'exécuter dans une suite de tests Node.
 *
 * Ici : aucune entrée/sortie, aucun module natif, aucune horloge implicite. Tout se déduit des
 * arguments. Le hook, lui, ne garde que ce qui touche au réseau et au cache.
 *
 * ⚠️ Déplacement À L'IDENTIQUE (cf. docs/PLAN_REFACTOR_TESTS.md, principe n° 1) : aucune règle de
 * calcul n'a été modifiée au passage. Toute correction doit faire l'objet d'un changement distinct.
 *
 * Couverture : `__tests__/pilotageData.test.ts`.
 */
import { weeklyVariableFromQ9, WEEKS_PER_MONTH } from './financialProfileEngine';
import { convertAmount, type RatesMap } from './currency';
import { buildPerimeterCtx, splitPerimeterAccounts, transformFluxTransactions } from './perimeter';
import { isRegul } from './regul';
import { isProjectSpendTx, projectMode } from './projectTx';
import { isBudgetExpense as isBudgetExpenseOf, isRecurringTx, sumVariableSpent, monthPrefix } from './variableSpend';
import { computeTresoRows } from './tresoProjection';
import { computeCashflowTrough } from './relyka';
import { computeReferenceMonthlyIncome } from './incomeAverage';
import { variablePacePercentage } from './spendingPace';
import { resolveRecoMode } from './recoMode';
import { addRecurrenceToMonth, recurrencePastInMonth, recurrenceOccurrencesBetween, monthlyEquivalent } from './recurrence';
import { countConsecutiveOverdraftMonths } from './balanceAt';
import { isoDay, dayOfMonthISO } from '../dateUtils';
import { OBSERVATION_WINDOW_DAYS, type DriftCalibration } from './confidenceEngine';
import type { Account, FinancialProfile, Project, Profile, RecurrenceRule, TransactionWithDetails } from '../../types/database';

export interface TransactionWithCategory extends TransactionWithDetails {
  category?: { name: string; type: string; is_variable?: boolean };
}

export interface PilotageData {
  // Step 1 — LEGACY. `safe_to_spend` / `projected_surplus` sont l'ANCIEN modèle de budget, antérieur
  // au Relyka. Le budget libre réellement affiché (« Ton Relyka ») est calculé par lib/relyka à
  // partir de `cashflow_trough` — voir lib/recoInputs. Ces deux champs ne servent plus qu'à des
  // consommateurs secondaires (snapshot Conseils IA, hooks/useConseils, défaut du moteur de recos).
  // Ne PAS les utiliser pour un nouveau calcul : ils ne racontent pas la même histoire que le Relyka.
  safe_to_spend: number;
  current_checking_balance: number;
  remaining_fixed_expenses: number;
  committed_allocations: number;
  same_account_reserved: number;
  monthly_commitments: number;

  // Revenu attendu + creux + garde-fou projection (modèle « trésorerie adaptative »)
  month_income_remaining: number;        // TOTAL des recettes restantes du mois en cours (affichage)
  cashflow_trough: number;               // point bas du solde courant simulé (revenus + dépenses réelles)
  /** DATE (ISO) à laquelle le point bas est atteint. Le Relyka qui en découle ne vaut que JUSQU'À
   *  cette date : après la prochaine rentrée d'argent, il remonte. Indispensable à l'écran pour
   *  expliquer un Relyka faible (« il te reste X € jusqu'au 24 au soir, ta paie du 25 le remontera »). */
  cashflow_trough_date: string;
  /** Fin de l'horizon simulé (ISO) — le point bas n'a de sens que sur [aujourd'hui → cette date]. */
  cashflow_horizon_end: string;
  /** Prochaine rentrée d'argent prise en compte dans la simulation (ISO) + son montant. */
  next_income_date: string | null;
  next_income_amount: number;
  expected_monthly_income: number;       // revenu mensuel détecté (explicite ou inféré) — projection
  avg_monthly_income: number;            // revenu mensuel moyen (6 mois, hors 1er mois incomplet) — mois de sécurité
  expected_income_source: 'explicit' | 'inferred' | 'none';
  expected_income_confidence: number;    // 0..1
  projection_min_buffer: number;         // plus bas du solde courant projeté sur N mois
  projection_in_danger: boolean;         // true → frein « Conserver »
  prudence: number;                      // 0..1 (1 = très prudent)

  // Suivi des engagements du mois en cours
  monthly_savings_planned: number;       // virements récurrents épargne + projets (total du mois, affichage)
  monthly_savings_remaining: number;     // part non encore exécutée → pour le budget libre
  monthly_invest_planned: number;        // virements récurrents invest (total du mois, affichage)
  monthly_invest_remaining: number;      // part non encore exécutée → pour le budget libre
  // Virements épargne/invest du mois (TOUS, via linked_account_id, projets inclus) — Suivi
  month_savings_total: number;           // épargne : tous virements du mois (affichage)
  month_savings_future: number;          // épargne : part future (déduite du budget)
  month_invest_total: number;            // investissement : tous virements du mois (affichage)
  month_invest_future: number;           // investissement : part future (déduite du budget)
  real_savings_excl_projects: number;    // épargne réelle ce mois HORS projets (pour budget reco)
  real_invest: number;                   // invest réel ce mois (pour budget reco)
  monthly_reserve_planned: number;       // total réservé (projets même compte + brouillons conservés)
  month_expenses_total: number;          // total dépenses du mois (passées + à venir, hors virements) — info
  month_expenses_past: number;           // dépenses validées déjà passées ce mois (déjà dans le solde) — info
  month_expenses_remaining: number;      // dépenses à venir ce mois (date > aujourd'hui) → déduites du budget
  reserved_by_project: Array<{           // détail du Réservé par projet (pour le modal)
    id: string; name: string; total: number;
    source_account_id: string | null; linked_account_id: string | null;
  }>;

  // Step 2: Variable Expense Trend
  avg_variable_expenses_3m: number;
  current_month_variable: number;
  /** Part de l'enveloppe variable déjà consommée (0-100+). Un REMPLISSAGE, pas un jugement. */
  variable_trend_percentage: number;
  /**
   * RYTHME de dépenses variables rapporté à l'avancement du mois (100 = rythme habituel), ou `null`
   * quand il est trop tôt dans le mois pour conclure. C'est CE chiffre qui permet de dire « tu
   * dépenses plus/moins que d'habitude » — jamais `variable_trend_percentage` (cf. lib/spendingPace).
   */
  variable_pace_percentage: number | null;

  // Enveloppe des dépenses variables (estimation dynamique)
  variable_envelope_initial: number;    // enveloppe estimée du mois (historique ou onboarding)
  variable_envelope_spent: number;      // dépenses variables déjà engagées ce mois
  /**
   * Dépenses variables du mois DÉJÀ SAISIES pour les jours à venir (jusqu'au point bas). Elles sont
   * déjà déduites du point bas : l'enveloppe ne doit donc plus les provisionner, sinon elles pèsent
   * DEUX FOIS sur le Relyka. Exposée pour que l'écran puisse continuer à les montrer dans « ce qui
   * va encore sortir » — elles sortiront bel et bien.
   */
  variable_envelope_planned: number;
  variable_envelope_remaining: number;  // = max(0, initial − spent − planned) : reste à PROVISIONNER
  variable_envelope_source: 'history' | 'onboarding' | 'none';
  /** Référence choisie par l'utilisateur (migration 164). */
  variable_envelope_mode: 'auto' | 'estimate' | 'real';
  /** Valeur de l'ESTIMATION déclarée (0 si rien de déclaré) — pour montrer l'autre mode. */
  variable_estimate_value: number;
  /** Valeur de la MOYENNE RÉELLE observée (0 si historique insuffisant). */
  variable_real_value: number;
  /** La moyenne réelle est-elle calculable (≥ 2 mois exploitables) ? */
  variable_real_available: boolean;
  /**
   * Nombre de mois qui composent la moyenne « calculée » — TOUJOURS renseigné, même quand ce n'est
   * pas la référence retenue. `variable_envelope_months_used`, lui, ne vaut quelque chose que si
   * l'enveloppe VIENT de l'historique : l'écran affichait donc « moyenne de tes 0 derniers mois »
   * dès qu'on regardait le mode « Calculé » sans y être.
   */
  variable_real_months: number;
  variable_envelope_months_used: number; // nb de mois d'historique utilisés (si source = history)
  /** Charges RÉCURRENTES du mois (hors virements d'épargne, hors projets). */
  monthly_recurring_expenses: number;
  /**
   * DÉPENSES ESSENTIELLES du mois = charges récurrentes + enveloppe variable retenue.
   * Base du matelas de sécurité : ce qu'il faut couvrir chaque mois si le revenu s'arrête
   * (cf. lib/securityCushion — la base était le REVENU, ce qui n'a jamais mesuré la bonne chose).
   */
  monthly_essential_expenses: number;

  // Step 3: Surplus & Recommendation
  projected_surplus: number;
  recommendation: 'À ÉPARGNER' | 'À INVESTIR';

  // Profile and allocation preferences
  financial_profile?: FinancialProfile;
  allocation_save_percent?: number;
  allocation_invest_percent?: number;
  allocation_enjoy_percent?: number;
  allocation_keep_percent?: number;
  initial_onboarding_completed: boolean;

  // Step 4: Projects
  available_savings: number;
  projects_with_progress: Array<{
    id: string;
    name: string;
    target_amount: number;
    monthly_allocation: number;
    progress_percentage: number;
    status: string;
  }>;
  global_projects_percentage: number;

  // Account Aggregations
  total_checking: number;
  total_savings: number;
  total_invested: number;
  /** Au moins un compte d'épargne EXISTE (indépendamment de son solde). */
  has_savings_account: boolean;
  /**
   * Au moins une dépense RÉCURRENTE saisie, quelle que soit sa forme (y compris un virement de
   * charges vers un compte joint). Plus large que `monthly_recurring_expenses`, qui applique un
   * périmètre strict — cf. le commentaire de calcul.
   */
  has_recurring_expenses: boolean;

  // Safety Thresholds
  /** @deprecated */
  safety_margin_percent: number;
  /** Montant minimum conservé sur les comptes courants (€) — remplace safety_margin_percent */
  safety_margin_amount: number;
  safety_threshold_min: number;
  safety_threshold_optimal: number;
  safety_threshold_comfort: number;
  current_savings: number;
  /** Overrides du mois courant (montant modifié d'une occurrence récurrente) : transaction_id → montant absolu. */
  monthOverrides?: Record<string, number>;

  // ── Périmètre quotidien & confiance ──
  /** Part patrimoniale des joints « contribution » (hors périmètre flux). */
  joint_share_outside_perimeter: number;
  /** Part (pondérée au %) des comptes partagés « quotidien » INCLUSE dans le solde courant affiché —
   *  ligne info du Suivi (n'a de sens que dans ce mode : le montant impacte le budget). */
  joint_share_in_checking: number;
  /** Écart-type mensuel des dépenses variables (mois fiables). 0 si historique insuffisant. */
  variable_sigma: number;
  /**
   * Mois RÉVOLUS consécutifs terminés dans le rouge sur les comptes courants (0 = aucun).
   *
   * C'est ce qui transforme un découvert en DIAGNOSTIC : sa répétition, pas sa présence. La mesure
   * existait déjà, mais UNIQUEMENT à l'intérieur du moteur de profil (hooks/useFinancialProfile), qui
   * la relisait pour son propre compte. Résultat : la PRIORITÉ DU MOIS, qui l'attend explicitement
   * (`consecutiveOverdraftMonths`), ne la recevait de personne — et la priorité « Sortir du rouge »,
   * pourtant documentée comme la deuxième plus impérieuse, ne s'est jamais déclenchée pour
   * personne : quelqu'un en découvert chronique se voyait recommander d'investir.
   * Elle est donc mesurée ICI, une fois, avec les mêmes comptes et les mêmes transactions que tout
   * le reste du tableau de bord.
   */
  consecutive_overdraft_months: number;
  /** Signaux bruts de confiance (le niveau/fourchette sont calculés côté écrans via confidenceEngine). */
  confidence_inputs: {
    lastVerifiedAt: string | null;
    /** Jours (ISO) portant une saisie manuelle, fenêtre glissante — mesure l'assiduité. */
    activityDays: string[];
    /** Dépenses variables constatées par jour (ISO), même fenêtre — plafonne le doute. */
    variableSpentByDay: Record<string, number>;
    calibration: DriftCalibration | null;
    floorBase: number;
    variableBase: number;
  };
  /** Soldes courants projetés en fin de mois sur 6 mois (index 0 = mois courant) — même trajectoire
   *  que l'écran Projection (lib/tresoProjection). Alimente le garde-fou marge des recommandations. */
  projection_balances_6m: number[];
  /** Même trajectoire prolongée à 12 mois (anticipation long terme : snapshot Conseils IA). */
  projection_balances_12m: number[];
  /** Revenus (recettes) attendus par mois sur 12 mois — même trajectoire (overrides inclus). */
  projection_income_12m: { ym: string; income: number }[];
}


// ── Horizon glissant / creux de trésorerie ──────────────────────────────────
// `isoDay` vient de lib/dateUtils : il en existait une seconde définition ici, identique à celle
// qui servait déjà à `todayISO`. Une seule lecture de date locale pour toute l'app.
function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + days); return isoDay(d);
}
function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }


export interface ExpectedIncome { monthlyAmount: number; nextDate: string | null; day: number; confidence: number; source: 'explicit' | 'inferred' | 'none' }

/** Détecte le revenu attendu : récurrent explicite, sinon inféré de l'historique (4 mois). */
export function detectExpectedIncome(transactions: any[], checkingIds: Set<string>, todayStr: string): ExpectedIncome {
  const none: ExpectedIncome = { monthlyAmount: 0, nextDate: null, day: 1, confidence: 0, source: 'none' };
  /* 1) EXPLICITE : une recette récurrente entrante déclarée sur un compte courant, QUEL QUE SOIT son
     rythme.
     ⚠️ Seul le rythme « mensuel » était accepté. Une paie hebdomadaire ou trimestrielle — pourtant
     saisie en récurrente — ne comptait donc pas comme déclarée : le moteur repartait sur l'INFÉRENCE,
     retrouvait ces mêmes paies dans l'historique, et ajoutait une rentrée d'argent FANTÔME à la
     simulation du point bas… en plus des occurrences réelles, déjà comptées. Le Relyka en ressortait
     gonflé, et l'écran demandait par-dessus « enregistre ta rentrée en récurrente » à quelqu'un qui
     venait précisément de le faire.
     Le montant est ramené à son ÉQUIVALENT MENSUEL (lib/recurrence) : c'est ce que ce champ promet,
     et il sert ailleurs de diviseur (« combien de mois d'épargne d'avance »). */
  const explicit = transactions.filter((t) =>
    checkingIds.has(t.account_id) && t.is_recurring && t.recurrence_rule
    && Number(t.amount) > 0 && !t.is_draft && !t.is_reserved && !t.linked_account_id);
  if (explicit.length > 0) {
    const perMonth = (t: any) => monthlyEquivalent(t.recurrence_rule, Number(t.amount)) || Number(t.amount);
    const top = explicit.slice().sort((a, b) => perMonth(b) - perMonth(a))[0];
    const occ = recurrenceOccurrencesBetween(top.date, top.recurrence_rule as RecurrenceRule, top.recurrence_end_date ?? null, todayStr, addDaysIso(todayStr, 40))[0] ?? null;
    return { monthlyAmount: perMonth(top), nextDate: occ, day: dayOfMonthISO(top.date), confidence: 1, source: 'explicit' };
  }
  // 2) Inféré : recettes ponctuelles régulières (même libellé, ≥ 2 mois distincts) sur 4 mois.
  const now = new Date(todayStr + 'T00:00:00');
  const fourMonthsAgo = isoDay(new Date(now.getFullYear(), now.getMonth() - 4, 1));
  const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const groups: Record<string, { amounts: number[]; days: number[]; months: Set<string> }> = {};
  for (const t of transactions) {
    if (!checkingIds.has(t.account_id) || t.is_draft || t.is_reserved || t.linked_account_id) continue;
    if (Number(t.amount) <= 0 || t.date < fourMonthsAgo || t.date > todayStr) continue;
    const key = norm(t.note ?? '') || 'revenu';
    (groups[key] ??= { amounts: [], days: [], months: new Set() });
    groups[key].amounts.push(Number(t.amount));
    groups[key].days.push(dayOfMonthISO(t.date));
    groups[key].months.add(t.date.slice(0, 7));
  }
  let best: ExpectedIncome = none;
  for (const g of Object.values(groups)) {
    if (g.months.size < 2) continue;
    const amounts = g.amounts.slice().sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    if (median <= best.monthlyAmount) continue;
    const day = Math.round(g.days.reduce((s, d) => s + d, 0) / g.days.length);
    const confidence = Math.min(1, g.months.size / 3);
    let occ = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(Math.min(day, 28)).padStart(2, '0')}`;
    if (occ <= todayStr) occ = isoDay(new Date(now.getFullYear(), now.getMonth() + 1, Math.min(day, 28)));
    best = { monthlyAmount: median, nextDate: occ, day, confidence, source: 'inferred' };
  }
  if (best.source !== 'none') return best;

  // 3) Repli : moyenne mensuelle des recettes sur l'historique disponible (gère le 1er mois sans
  //    pattern détecté). Pas de `nextDate` → ne crée pas de revenu fantôme dans le creux (budget libre),
  //    sert seulement de base de revenu mensuel (ex. « mois de réserve »).
  const incomeByMonth: Record<string, number> = {};
  for (const t of transactions) {
    if (!checkingIds.has(t.account_id) || t.is_draft || t.is_reserved || t.linked_account_id) continue;
    if (Number(t.amount) <= 0 || t.date < fourMonthsAgo || t.date > todayStr) continue;
    if (/r[ée]gul/i.test(t.note ?? '')) continue; // exclure les régularisations de solde
    const mk = t.date.slice(0, 7);
    incomeByMonth[mk] = (incomeByMonth[mk] ?? 0) + Number(t.amount);
  }
  const incomeMonths = Object.keys(incomeByMonth);
  if (incomeMonths.length > 0) {
    const avg = Object.values(incomeByMonth).reduce((s, v) => s + v, 0) / incomeMonths.length;
    return { monthlyAmount: avg, nextDate: null, day: 1, confidence: Math.min(1, incomeMonths.length / 3), source: 'inferred' };
  }
  return none;
}


/** Prudence (0..1, 1 = très prudent). Override profiles.prudence_level (0..100), sinon dérivée des allocations. */
function profilePrudence(profile: any): number {
  if (typeof profile?.prudence_level === 'number') return clamp01(profile.prudence_level / 100);
  const invest = Number(profile?.allocation_invest_percent ?? 25);
  return clamp01(0.7 - invest / 100); // plus on investit, moins on est prudent
}
/**
 * Entrées du moteur — exactement la forme que `fetchPilotageData` (hooks/usePilotageData) produit.
 *
 * Décrite EXPLICITEMENT plutôt que dérivée du type de retour du fetch : c'est ce qui permet à ce
 * module de ne rien savoir du réseau, et à un test de fabriquer un jeu de données à la main. La
 * correspondance avec le fetch reste vérifiée par le compilateur, puisque son résultat est passé ici.
 */
export interface PilotageInput {
  profile: Profile | null;
  sharedFactor: Record<string, number>;
  sharedModeById: Record<string, string | null>;
  estimatedMonths: Set<string>;
  accounts: Account[];
  transactions: TransactionWithCategory[];
  questionnaireAnswers: any | null;
  projects: Project[];
  monthOverrides: { transaction_id: string; year: number; month: number; override_amount: number | null }[];
  rates: RatesMap;
}

/**
 * Cœur de calcul du Pilotage — Relyka, point bas, enveloppe variable, engagements du mois.
 *
 * FONCTION PURE : tout ce qu'elle rend se déduit de `data` et de `now`. C'est la raison pour
 * laquelle `now` est un PARAMÈTRE et non un `new Date()` interne — c'était l'unique dépendance à
 * l'horloge de ces 800 lignes, et donc la seule chose qui les rendait intestables. Le défaut
 * préserve exactement le comportement d'origine : l'appelant de production n'a pas à le fournir.
 *
 * Voir `__tests__/pilotageData.test.ts` : les bascules de mois (dernier jour à 23 h 59, premier jour
 * à 00 h 01) s'y écrivent en une ligne, alors qu'elles étaient invérifiables autrement.
 */
export function computePilotageData(data: PilotageInput, now: Date = new Date()): PilotageData {
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const { profile, projects, rates } = data;

  // ── Multi-devises : on NORMALISE comptes & transactions dans la devise de RÉFÉRENCE de
  // l'utilisateur AVANT tout calcul. Tout le reste de la fonction raisonne donc en une seule
  // devise (la référence). Taux manquant → montant laissé tel quel (pas d'invention).
  const refCode = profile?.currency_code ?? 'EUR';
  const accountCurrency = new Map(data.accounts.map((a) => [a.id, (a as any).currency || 'EUR']));
  const toRef = (amount: number, from: string) => convertAmount(amount, from, refCode, rates) ?? amount;
  const accountsAll = data.accounts.map((a) => ({ ...a, balance: toRef(Number(a.balance), (a as any).currency || 'EUR') }));
  const transactionsAll = data.transactions.map((t) => ({
    ...t,
    amount: toRef(Number(t.amount), accountCurrency.get((t as any).account_id) ?? refCode),
  }));

  // ── Périmètre quotidien : réinterprète comptes & transactions pour la VUE FLUX (budget).
  // Joints « contribution » → hors flux (leur part reste au patrimoine) ; virements trans-frontière →
  // dépenses/recettes « Versé/Reçu du foyer ». L'historique en base n'est JAMAIS réécrit.
  const sharedFactor: Record<string, number> = (data as any).sharedFactor ?? {};
  const sharedModeById: Record<string, string | null> = (data as any).sharedModeById ?? {};
  const perimeterCtx = buildPerimeterCtx(
    accountsAll.map((a) => ({
      id: a.id,
      isShared: a.id in sharedFactor,
      shared_mode: sharedModeById[a.id] ?? null,
      factor: sharedFactor[a.id] ?? 1,
      type: (a as any).type,
    })),
  );
  const { perimeter: accounts, outside: outsidePerimeterAccounts } = splitPerimeterAccounts(accountsAll, perimeterCtx);
  const transactions = transformFluxTransactions(transactionsAll, perimeterCtx) as typeof transactionsAll;
  // Part patrimoniale des joints « contribution » (hors flux).
  const joint_share_outside_perimeter = outsidePerimeterAccounts.reduce((s, a) => s + Number(a.balance), 0);
  // Part (pondérée) des comptes partagés « quotidien » incluse dans le solde COURANT du périmètre —
  // affichée à côté du solde pour expliquer d'où il vient (le montant impacte le budget).
  const joint_share_in_checking = accounts
    .filter((a) => a.id in sharedFactor && a.type === 'checking')
    .reduce((s, a) => s + Number(a.balance), 0);

  // =====================================================================
  // AGGREGATIONS: Accounts by Type
  // =====================================================================
  const total_checking = accounts.filter(a => a.type === 'checking').reduce((sum, a) => sum + Number(a.balance), 0);
  const total_savings = accounts.filter(a => a.type === 'savings').reduce((sum, a) => sum + Number(a.balance), 0);
  /* EXISTENCE, pas montant : un livret à 0 € est une donnée connue, l'absence de livret est une
     donnée MANQUANTE. Les deux donnent « 0 € d'épargne » et ne disent pas du tout la même chose —
     le classement s'en sert comme porte d'entrée, la fiabilité comme cause à afficher. */
  const has_savings_account = accounts.some(a => a.type === 'savings');
  const total_invested = accounts.filter(a => a.type === 'investment').reduce((sum, a) => sum + Number(a.balance), 0);

  /* Seuils d'épargne : STOCKÉS EN EUR (base, cf. hooks/useSavingsConfig) → convertis dans la devise
     de RÉFÉRENCE avant toute comparaison. Les soldes, eux, sont déjà convertis quelques lignes plus
     haut : sans cette conversion, on comparait 10 000 CHF d'épargne à un seuil de 10 000 « euros »
     lu comme des francs, et l'utilisateur était déclaré au-dessus du seuil optimal alors qu'il ne
     l'était pas — avec, derrière, un profil financier et des recommandations calés dessus. La page
     Comptes applique déjà exactement cette conversion (toRefAmount) ; les deux écrans annonçaient
     donc des niveaux différents pour la même épargne. Devise de référence EUR → conversion neutre. */
  const safety_threshold_min = toRef(profile?.safety_threshold_min ?? 5000, 'EUR');
  const safety_threshold_optimal = toRef(profile?.safety_threshold_optimal ?? 10000, 'EUR');
  const safety_threshold_comfort = toRef(profile?.safety_threshold_comfort ?? 20000, 'EUR');
  const current_savings = total_savings;

  /* DÉCOUVERT CHRONIQUE — mesuré ici, une seule fois, pour tout le monde.
     Les comptes courants du PÉRIMÈTRE (les mêmes que le solde affiché) sont rejoués mois par mois
     via le modèle d'ancres (lib/balanceAt), qui tient compte des régularisations — une soustraction
     naïve compterait dans le rouge précisément ceux qui corrigent leurs soldes. */
  const consecutive_overdraft_months = countConsecutiveOverdraftMonths(
    transactions as any[],
    accounts.filter((a) => a.type === 'checking').map((a) => ({ id: a.id, balance: Number(a.balance) })),
    now,
  );

  // =====================================================================
  // STEP 1: Safe to Spend
  // ─────────────────────────────────────────────────────────────────────
  // Formula:
  //   remaining_month_net = Σ transactions this month AFTER today (income – expenses)
  //   committed_projects  = Σ active projects monthly_allocation
  //   base_to_spend = checking_balance + remaining_month_net
  //                   - committed_projects
  //   safe_to_spend = base_to_spend × (1 - safety_margin_percent / 100)
  // ─────────────────────────────────────────────────────────────────────
  const current_checking_balance = total_checking;
  const safety_margin_percent = profile?.safety_margin_percent ?? 10; // conservé pour rétrocompatibilité
  const safety_margin_amount = profile?.safety_margin_amount ?? 0;
  const todayStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  /* Overrides « échéance modifiée » : montant modifié d'une occurrence récurrente pour un mois donné.
     ⚠️ MULTI-DEVISES : un override est enregistré dans la devise DU COMPTE, comme la transaction
     qu'il remplace. Comptes et transactions sont convertis en devise de référence plus haut, mais
     les overrides ne l'étaient pas : sur un compte en devise étrangère, une échéance modifiée
     entrait dans les calculs avec son montant BRUT — un loyer de 900 CHF comptait pour 900 €. Et
     comme l'écran Projection, lui, convertissait déjà, les deux trajectoires divergeaient. */
  const txCurrencyById = new Map(
    (data.transactions as any[]).map((t) => [t.id, accountCurrency.get(t.account_id) ?? refCode]),
  );
  const overrideToRef = (o: any) => toRef(Number(o.override_amount), txCurrencyById.get(o.transaction_id) ?? refCode);

  // Mois courant : les indicateurs (dépensé, épargné, investi) doivent refléter ce RÉEL, pas le
  // montant figé du template.
  const ovrByTx: Record<string, number> = {};
  for (const o of (data as any).monthOverrides ?? []) {
    if (o.year === currentYear && o.month === currentMonth && o.override_amount != null) ovrByTx[o.transaction_id] = Math.abs(overrideToRef(o));
  }
  /** Montant d'une transaction pour le mois courant : override mensuel s'il existe, sinon le montant du modèle. */
  const effAbs = (t: any) => ovrByTx[t.id] ?? Math.abs(Number(t.amount));
  // Overrides TOUS MOIS (pour projeter le RÉEL au-delà du mois courant : creux, prochaines recettes).
  const ovrByTxMonth: Record<string, number> = {};
  for (const o of (data as any).monthOverrides ?? []) {
    if (o.override_amount != null) ovrByTxMonth[`${o.transaction_id}:${o.year}:${o.month}`] = Math.abs(overrideToRef(o));
  }
  /** Montant SIGNÉ réel d'une occurrence à sa date (override du mois de l'occurrence s'il existe). */
  const realSignedAt = (t: any, occ: string): number => {
    const ov = ovrByTxMonth[`${t.id}:${Number(occ.slice(0, 4))}:${Number(occ.slice(5, 7))}`];
    const base = Number(t.amount);
    return ov != null ? (base < 0 ? -ov : ov) : base;
  };
  const checkingIds = new Set(accounts.filter(a => a.type === 'checking').map(a => a.id));
  const prudence = profilePrudence(profile);

  const accountTypeById: Record<string, string> = {};
  accounts.forEach(a => { accountTypeById[a.id] = a.type; });

  // =====================================================================
  // DÉFINITION UNIQUE de « dépense du budget quotidien » et de « variable »
  // ─────────────────────────────────────────────────────────────────────
  // Avant, trois définitions coexistaient dans ce fichier : le DÉPENSÉ du mois comptait toute
  // dépense non récurrente, l'HISTORIQUE qui calibre l'enveloppe ne comptait que les catégories
  // `is_variable`, et la TENDANCE en utilisait encore une autre. Le dépensé était donc
  // structurellement plus large que sa propre référence → « 1 890 € dépensés / 303 € estimés »,
  // « 133 % des dépenses prévues », et une enveloppe restante tombée à 0 dès le début du mois.
  // Une seule règle, appliquée des DEUX côtés (mois courant et mois d'historique).
  //
  // ⚠️ La règle vit désormais dans `lib/finance/variableSpend` — DÉPLACÉE À L'IDENTIQUE, aucune
  // condition changée. Elle y est partagée avec le module Budgets, qui doit compter EXACTEMENT le
  // même « dépensé » : deux définitions parallèles, c'est la faute que le paragraphe ci-dessus
  // raconte avoir déjà coûté cher.
  // =====================================================================

  /** Raccourci local : la règle partagée, liée aux comptes de CE calcul. */
  const isBudgetExpense = (t: any): boolean => isBudgetExpenseOf(t, accountTypeById);

  /**
   * Dépenses VARIABLES réellement passées sur un mois donné, en NET (un remboursement sur une
   * catégorie de dépense vient en déduction). `upTo` borne au jour près (mois courant), `after`
   * exclut tout ce qui est daté à cette date ou avant (pour ne garder que le futur connu).
   * MÊME fonction pour le dépensé du mois et pour les mois d'historique qui calibrent l'enveloppe.
   */
  const monthVariableSpent = (year: number, month: number, upTo?: string, after?: string): number =>
    sumVariableSpent(transactions as any[], accountTypeById, { prefix: monthPrefix(year, month), upTo, after });

  // Engagements : allocations mensuelles des projets actifs.
  const committed_project_allocations = projects
    .filter(p => p.status === 'active')
    .reduce((sum, p) => sum + Number(p.monthly_allocation), 0);
  const committed_allocations = committed_project_allocations;
  const monthly_commitments = committed_allocations;

  // Réservations même compte : l'argent est « réservé » mais reste sur le courant (passées uniquement).
  const same_account_reserved = projects
    .filter(p => p.status === 'active' && p.source_account_id && p.linked_account_id && p.source_account_id === p.linked_account_id)
    .reduce((sum, p) => {
      const monthlyAlloc = Number(p.monthly_allocation) || 0;
      const pastTxns = transactions.filter(t => t.project_id === p.id && t.date <= todayStr && !(t as any).is_draft);
      // Montant RÉEL de chaque réservation quand il est connu ; repli sur l'allocation courante pour
      // les réservations « même compte » enregistrées à 0 € (l'argent ne bouge pas du compte).
      // `nombre × allocation ACTUELLE` refaisait l'historique à l'envers dès que l'allocation
      // mensuelle du projet avait été modifiée en cours de route.
      return sum + pastTxns.reduce((s, t) => s + (Math.abs(Number(t.amount)) || monthlyAlloc), 0);
    }, 0);

  // ── Revenu attendu + POINT BAS de trésorerie ──────────────────────────────────────────────
  // Le budget libre part du plus bas SOLDE DE FIN DE JOURNÉE d'ici la prochaine rentrée d'argent
  // (revenus ET dépenses simulés jour après jour — voir lib/relyka.computeCashflowTrough). On ne
  // libère jamais plus que ce point bas → on ne laisse pas dépenser un revenu pas encore reçu.
  // C'est une info datée : `cashflow_trough_date` dit JUSQU'À QUAND le Relyka est contraint, et
  // `next_income_date` ce qui le fera remonter. Le revenu non saisi est INFÉRÉ de l'historique et
  // pondéré par la prudence (profil).
  const expectedIncome = detectExpectedIncome(transactions, checkingIds, todayStr);
  // Constaté si des recettes sont déjà tombées, DÉCLARÉ (récurrentes) sinon : sans ce repli, un
  // compte neuf dont le salaire est daté d'après aujourd'hui n'avait « aucun revenu » — et le
  // matelas de sécurité restait vide (cf. lib/incomeAverage).
  const avgMonthlyIncome = computeReferenceMonthlyIncome(transactions, checkingIds, todayStr, (data.profile as any)?.created_at ?? null);

  // Confiance accordée à un revenu INFÉRÉ (non saisi comme récurrent) : pondérée par la prudence.
  const inferredTrust = clamp01(1 - prudence) * expectedIncome.confidence;
  // ⚠ Un revenu inféré NON COMPTÉ (prudence maximale ou confiance nulle → inferredTrust = 0) ne doit
  // pas non plus ALLONGER l'horizon : sinon on simulait toutes les dépenses d'ici la paie SANS
  // jamais ajouter la paie, et le point bas s'effondrait sans rien pour l'expliquer à l'écran.
  const useInferredIncome = expectedIncome.source === 'inferred' && !!expectedIncome.nextDate && inferredTrust > 0;

  let nextIncomeDate: string | null = null;
  for (const t of transactions) {
    if (!checkingIds.has(t.account_id) || (t as any).is_draft || (t as any).is_reserved || t.linked_account_id || (t as any).project_id) continue;
    if (Number(t.amount) <= 0) continue;
    if (t.is_recurring && t.recurrence_rule) {
      const occ = recurrenceOccurrencesBetween(t.date, t.recurrence_rule as RecurrenceRule, (t as any).recurrence_end_date ?? null, todayStr, addDaysIso(todayStr, 40))[0];
      if (occ && (!nextIncomeDate || occ < nextIncomeDate)) nextIncomeDate = occ;
    } else if (t.date > todayStr && (!nextIncomeDate || t.date < nextIncomeDate)) {
      nextIncomeDate = t.date;
    }
  }
  if (useInferredIncome && (!nextIncomeDate || expectedIncome.nextDate! < nextIncomeDate)) {
    nextIncomeDate = expectedIncome.nextDate!;
  }

  const curMonthEnd = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(new Date(currentYear, currentMonth, 0).getDate()).padStart(2, '0')}`;
  // Horizon simulé : jusqu'à la prochaine rentrée d'argent, et AU MINIMUM jusqu'à la fin du mois en
  // cours. Sans ce plancher, la veille de la paie l'horizon ne couvrait que 2-3 jours alors que le
  // lendemain il couvrait un mois entier : le point bas changeait de SENS d'un jour à l'autre, et le
  // Relyka avec lui. L'ancien « + 2 jours » après la paie était en plus arbitraire (une charge à J+2
  // comptait, la même à J+3 disparaissait) → supprimé. Bornes de sécurité : [7 j, 45 j].
  let horizonEnd = nextIncomeDate ?? addDaysIso(todayStr, 30);
  if (horizonEnd < curMonthEnd) horizonEnd = curMonthEnd;
  if (horizonEnd < addDaysIso(todayStr, 7)) horizonEnd = addDaysIso(todayStr, 7);
  if (horizonEnd > addDaysIso(todayStr, 45)) horizonEnd = addDaysIso(todayStr, 45);

  // Événements futurs sur comptes courants : revenus + dépenses RÉELLES + RENTRÉES d'argent réelles.
  // Un VIREMENT n'est retenu QUE s'il ENTRE sur le courant depuis un compte NON courant (épargne, invest,
  // externe) → c'est une vraie rentrée sur le pot courant. Les virements entre comptes courants (net nul)
  // et les SORTIES vers épargne/invest (déduites séparément) sont exclus. Montants = RÉEL (overrides).
  const events: { date: string; amount: number }[] = [];
  for (const t of transactions) {
    // Les transactions de projet sont exclues (elles sont comptées à part), SAUF les dépenses d'un
    // projet « Dépenser petit à petit » : ce sont de vraies sorties d'argent → elles creusent le point bas.
    if (!checkingIds.has(t.account_id) || (t as any).is_draft || (t as any).is_reserved) continue;
    if ((t as any).project_id && !isProjectSpendTx(t)) continue;
    if (t.linked_account_id) {
      if (Number(t.amount) <= 0 || checkingIds.has(t.linked_account_id)) continue; // garder les seules entrées depuis hors-courant
    }
    if (t.is_recurring && t.recurrence_rule) {
      for (const occ of recurrenceOccurrencesBetween(t.date, t.recurrence_rule as RecurrenceRule, (t as any).recurrence_end_date ?? null, todayStr, horizonEnd)) events.push({ date: occ, amount: realSignedAt(t, occ) });
    } else if (t.date > todayStr && t.date <= horizonEnd) {
      events.push({ date: t.date, amount: realSignedAt(t, t.date) });
    }
  }
  // Revenu INFÉRÉ (non saisi) : ajouté à sa date, pondéré par confiance × (1 − prudence).
  if (useInferredIncome && expectedIncome.nextDate! <= horizonEnd) {
    events.push({ date: expectedIncome.nextDate!, amount: expectedIncome.monthlyAmount * inferredTrust });
  }

  // ── POINT BAS = plus bas SOLDE DE FIN DE JOURNÉE d'ici l'horizon (lib/relyka, testé) ──────
  const { trough, troughDate, outflowTotal: outflow_remaining } =
    computeCashflowTrough(current_checking_balance, events, todayStr);
  // Montant de la prochaine rentrée retenue (celle qui fera remonter le point bas) — sert à
  // l'expliquer à l'écran : « il te reste X € jusqu'au 24 ; ta paie du 25 (+Y €) le remontera ».
  const next_income_amount = nextIncomeDate
    ? events.filter((e) => e.date === nextIncomeDate && e.amount > 0).reduce((s, e) => s + e.amount, 0)
    : 0;

  // Total des RECETTES réelles restantes du MOIS EN COURS (hors virements rentrants). Simple
  // indicateur, basé sur le réel (occurrences + overrides), pas sur un montant figé.
  let month_income_remaining = 0;
  for (const t of transactions) {
    if (!checkingIds.has(t.account_id) || (t as any).is_draft || (t as any).is_reserved || (t as any).project_id || t.linked_account_id) continue;
    if (Number(t.amount) <= 0) continue; // recettes uniquement
    if (t.is_recurring && t.recurrence_rule) {
      for (const occ of recurrenceOccurrencesBetween(t.date, t.recurrence_rule as RecurrenceRule, (t as any).recurrence_end_date ?? null, todayStr, curMonthEnd)) {
        if (occ > todayStr) month_income_remaining += realSignedAt(t, occ);
      }
    } else if (t.date > todayStr && t.date <= curMonthEnd) {
      month_income_remaining += realSignedAt(t, t.date);
    }
  }
  const remaining_fixed_expenses = outflow_remaining;

  // Base à dépenser = creux − engagements − réservations.
  const base_to_spend = trough - committed_allocations - same_account_reserved;
  const safe_to_spend = Math.max(0, base_to_spend - safety_margin_amount);

  // ── Garde-fou PROJECTION (moyen terme) : le solde courant projeté tient-il N mois ? ──
  // N dépend de la prudence (3 → 12 mois). Net mensuel = moyenne 3 mois passés (courant, hors virements/régul).
  const projHorizonMonths = Math.round(3 + prudence * 9);
  const past3Keys = [1, 2, 3].map((k) => { const d = new Date(currentYear, currentMonth - 1 - k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const netByMonth: Record<string, number> = {};
  for (const t of transactions) {
    if (!checkingIds.has(t.account_id) || (t as any).is_draft || (t as any).is_reserved || t.linked_account_id) continue;
    if (/r[ée]gul/i.test((t as any).note ?? '')) continue;
    const mk = t.date.slice(0, 7);
    if (past3Keys.includes(mk)) netByMonth[mk] = (netByMonth[mk] ?? 0) + Number(t.amount);
  }
  const netVals = Object.values(netByMonth);
  const monthly_net_3m = netVals.length ? netVals.reduce((s, v) => s + v, 0) / netVals.length : 0;
  const projection_min_buffer = current_checking_balance + projHorizonMonths * Math.min(0, monthly_net_3m);
  const projection_in_danger = projection_min_buffer < Math.max(0, safety_margin_amount);

  // =====================================================================
  // STEP 2: Variable Expense Trend
  // =====================================================================
  // Référence = les 3 mois PRÉCÉDENTS (le mois courant est comparé à eux). On l'EXCLUT de sa propre
  // moyenne : sinon un gros mois gonfle sa référence et la tendance est sous-estimée (ex. +13 % affiché
  // au lieu de +30 % réel). « moyenne des 3 derniers mois » = les 3 mois d'avant, pas celui en cours.
  // Même définition de « variable » (= non récurrent) des deux côtés : voir `monthVariableSpent`.
  const current_month_variable = monthVariableSpent(currentYear, currentMonth, todayStr);

  const priorThreeMonths: Array<{ year: number; month: number }> = [];
  for (let i = 3; i >= 1; i--) {
    const d = new Date(currentYear, currentMonth - 1 - i, 1);
    priorThreeMonths.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  const nonZeroMonths = priorThreeMonths
    .map((m) => monthVariableSpent(m.year, m.month))
    .filter((v) => v > 0);
  // Moyenne brute des 3 mois précédents — usage INTERNE (projected_surplus). La référence de variable
  // EXPOSÉE (avg_variable_expenses_3m) est unifiée plus bas sur l'enveloppe (questionnaire < 2 mois,
  // sinon historique jusqu'à 6 mois) pour être cohérente entre Pilotage et Reporting.
  const _avgVarRaw3m = nonZeroMonths.length > 0
    ? nonZeroMonths.reduce((a, b) => a + b, 0) / nonZeroMonths.length
    : 0;

  // =====================================================================
  // STEP 3: Surplus & Recommendation
  // =====================================================================
  const projected_surplus = Math.max(0, safe_to_spend - Math.max(0, _avgVarRaw3m - current_month_variable));
  const recommendation: 'À ÉPARGNER' | 'À INVESTIR' = current_savings < safety_threshold_optimal ? 'À ÉPARGNER' : 'À INVESTIR';

  // =====================================================================
  // STEP 4: Projects "Good to Go"
  // =====================================================================
  const available_savings = Math.max(0, current_savings - safety_threshold_optimal);
  const sum_all_project_targets = projects.filter(p => p.status === 'active').reduce((sum, p) => sum + Number(p.target_amount), 0);

  const projects_with_progress = projects
    .filter(p => p.status === 'active')
    .map(p => {
      const monthlyAlloc = Number(p.monthly_allocation) || 0;
      const sameAccount = p.source_account_id && p.linked_account_id
        && p.source_account_id === p.linked_account_id;

      // Calculer la progression basée sur les transactions PASSÉES et VALIDÉES liées au projet
      const projectTxns = transactions.filter(t =>
        t.project_id === p.id && t.date <= todayStr && !(t as any).is_draft
      );

      let projectTransactionsTotal: number;
      if (sameAccount) {
        // Même compte → réservations souvent enregistrées à 0 € (l'argent ne bouge pas) : on prend
        // le montant réel quand il existe, sinon l'allocation courante. Voir `same_account_reserved`.
        projectTransactionsTotal = projectTxns.reduce((s, t) => s + (Math.abs(Number(t.amount)) || monthlyAlloc), 0);
      } else {
        // Comptes différents → on somme les montants absolus des débits passés
        const debits = projectTxns.filter(t => Number(t.amount) < 0);
        projectTransactionsTotal = debits.length > 0
          ? debits.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0)
          : projectTxns.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
      }
      
      const totalAccumulated = projectTransactionsTotal;
      const progress = Number(p.target_amount) > 0 ? (totalAccumulated / Number(p.target_amount)) * 100 : 0;

      return {
        id: p.id,
        name: p.name,
        target_amount: Number(p.target_amount),
        monthly_allocation: Number(p.monthly_allocation),
        progress_percentage: Math.min(progress, 100),
        status: p.status,
      };
    });

  const global_projects_percentage = sum_all_project_targets > 0 
    ? (projects_with_progress.reduce((sum, p) => sum + (p.progress_percentage / 100) * p.target_amount, 0) / sum_all_project_targets) * 100 
    : 0;

  // =====================================================================
  // SUIVI : engagements du mois en cours (épargne / invest / dépenses)
  // =====================================================================
  // Projets : distinguer ceux qui transfèrent vers un autre compte (épargne), ceux qui réservent sur
  // le même compte courant (tagué « Réservé ») et ceux qui DÉPENSENT (comptés dans les dépenses).
  const activeProjects = projects.filter(p => p.status === 'active');
  const isTransferProject = (p: Project) => projectMode(p) === 'transfer';

  const project_savings_monthly = activeProjects
    .filter(isTransferProject)
    .reduce((s, p) => s + Number(p.monthly_allocation || 0), 0);

  let transfer_savings = 0;   // virements vers comptes épargne (depuis courant)
  let transfer_savings_past = 0;
  let transfer_invest = 0;    // virements vers comptes investissement (depuis courant/épargne)
  let transfer_invest_past = 0;
  let month_expenses_total = 0;       // dépenses du mois (passées + à venir) — affichage info
  let month_expenses_past = 0;        // dépenses validées déjà passées (déjà dans le solde)
  let month_expenses_remaining = 0;   // dépenses datées après aujourd'hui (encore à sortir → budget libre)

  for (const t of transactions) {
    const amt = Number(t.amount);
    if (amt >= 0) {
      // Remboursement de dépense = entrée d'argent (montant +) sur une catégorie de DÉPENSE, depuis un
      // compte courant, hors virement/projet/régul. Il s'impute en NÉGATIF sur les dépenses du mois →
      // réduit donc les dépenses variables (ex. 300 de variables − 10 de remboursement = 290).
      // Un VRAI remboursement de dépense a TOUJOURS une catégorie de DÉPENSE (saisi via le toggle
      // « Remboursement » sur une catégorie de dépense). On EXIGE donc une vraie catégorie de dépense :
      // ça exclut d'office les montants positifs SANS catégorie (régularisation de solde, solde initial,
      // apport…) qui sinon étaient soustraits à tort des dépenses → « Total dépensé » négatif.
      const rcat = (t as TransactionWithCategory).category;
      const rIsRefund = !!rcat && rcat.type === 'expense' && !t.linked_account_id && !(t as any).project_id
        && accountTypeById[t.account_id] === 'checking' && !Boolean((t as any).is_recurring);
      if (rIsRefund && !Boolean((t as any).is_draft)) {
        const [rY, rM] = t.date.split('-').map(Number);
        if (rY === currentYear && rM === currentMonth) {
          month_expenses_total -= amt;
          if (t.date <= todayStr) month_expenses_past -= amt;
          else month_expenses_remaining -= amt;
        }
      }
      continue; // les autres entrées (vraies recettes) ne concernent pas les dépenses
    }
    const [tY, tM] = t.date.split('-').map(Number);
    const isThisMonth = tY === currentYear && tM === currentMonth;
    const isRecurring = Boolean((t as any).is_recurring) && Boolean((t as any).recurrence_rule);
    const isDraft = Boolean((t as any).is_draft);

    // Montant projeté sur le mois courant (récurrent → projection, sinon ponctuel du mois).
    // effAbs = override mensuel s'il existe (occurrence modifiée pour CE mois) sinon le montant du modèle.
    const _abs = effAbs(t);
    const monthlyAmt = isRecurring
      ? addRecurrenceToMonth(currentYear, currentMonth, _abs, t.date, (t as any).recurrence_rule, (t as any).recurrence_end_date ?? null, now)
      : (isThisMonth ? _abs : 0);
    if (monthlyAmt <= 0) continue;

    const pastAmt = isDraft ? 0 : (
      isRecurring
        ? recurrencePastInMonth(currentYear, currentMonth, _abs, t.date, (t as any).recurrence_rule, (t as any).recurrence_end_date ?? null, todayStr, now)
        : (isThisMonth && t.date <= todayStr ? _abs : 0)
    );

    const srcType = accountTypeById[t.account_id];
    const linkedType = t.linked_account_id ? accountTypeById[t.linked_account_id] : null;
    const hasProject = Boolean((t as any).project_id);

    if (linkedType === 'investment' && (srcType === 'checking' || srcType === 'savings') && !hasProject) {
      // Virement réel vers un compte d'investissement
      transfer_invest += monthlyAmt;
      transfer_invest_past += pastAmt;
    } else if (linkedType === 'savings' && srcType === 'checking' && !hasProject) {
      // Virement réel vers un compte d'épargne
      transfer_savings += monthlyAmt;
      transfer_savings_past += pastAmt;
    } else if (isBudgetExpense(t)) {
      // Vraie dépense du budget quotidien — MÊME règle que l'historique qui calibre l'enveloppe
      // variable (voir `isBudgetExpense`). Les dépenses d'un projet « Dépenser petit à petit » en
      // font partie (elles sortent vraiment du compte).
      month_expenses_total += monthlyAmt;
      // Le passé est déjà reflété dans le solde courant → ne pas le redéduire du budget.
      // Seules les dépenses à venir (non-brouillon) sont déduites du budget libre.
      if (!isDraft) {
        month_expenses_past += pastAmt;
        month_expenses_remaining += Math.max(0, monthlyAmt - pastAmt);
      }
    }
  }

  const monthly_savings_planned = transfer_savings + project_savings_monthly;
  const monthly_invest_planned = transfer_invest; // virements réels uniquement

  // ── Virements épargne / investissement du mois (affichage Suivi) ──
  // TOUS les virements du mois courant (passés + futurs), y compris ceux liés à un projet,
  // détectés via linked_account_id. `_total` = affichage ; `_future` = part non encore sortie
  // du solde (date > aujourd'hui) → seule part déduite du budget libre (pas de double comptage).
  let month_savings_total = 0, month_savings_future = 0;
  let month_invest_total = 0, month_invest_future = 0;
  for (const t of transactions) {
    const isProjectDraft = Boolean((t as any).is_draft) && Boolean((t as any).project_id);
    // On ignore les brouillons SAUF ceux issus d'un projet (virements planifiés à compter comme manuels).
    if ((t as any).is_draft && !isProjectDraft) continue;
    if ((t as any).is_reserved) continue; // une transaction réservée (« conservée ») n'est pas de l'épargne/invest
    const amt = Number(t.amount);
    if (amt >= 0) continue; // sortie depuis le compte source
    const srcType = accountTypeById[t.account_id];
    const linkedType = t.linked_account_id ? accountTypeById[t.linked_account_id] : null;
    if (!linkedType) continue;
    const isRecurring = Boolean((t as any).is_recurring) && Boolean((t as any).recurrence_rule);
    const [tY, tM] = t.date.split('-').map(Number);
    const isThisMonth = tY === currentYear && tM === currentMonth;
    // effAbs = override mensuel s'il existe (épargne/invest récurrent modifié pour CE mois) sinon le modèle.
    const _abs = effAbs(t);
    const monthlyAmt = isRecurring
      ? addRecurrenceToMonth(currentYear, currentMonth, _abs, t.date, (t as any).recurrence_rule, (t as any).recurrence_end_date ?? null, now)
      : (isThisMonth ? _abs : 0);
    if (monthlyAmt <= 0) continue;
    const pastAmt = isRecurring
      ? recurrencePastInMonth(currentYear, currentMonth, _abs, t.date, (t as any).recurrence_rule, (t as any).recurrence_end_date ?? null, todayStr, now)
      : (isThisMonth && t.date <= todayStr ? _abs : 0);
    // Part « à venir » (non encore sortie du solde) → déduite du budget libre (resteDisponible),
    // donc des recommandations. Les virements de projet en brouillon comptent ici comme s'ils
    // étaient saisis manuellement : la reco s'adapte sans attendre la validation.
    const futureAmt = Math.max(0, monthlyAmt - pastAmt);
    if (linkedType === 'investment' && (srcType === 'checking' || srcType === 'savings')) {
      month_invest_total += monthlyAmt; month_invest_future += futureAmt;
    } else if (linkedType === 'savings' && srcType === 'checking') {
      month_savings_total += monthlyAmt; month_savings_future += futureAmt;
    }
  }

  // Épargne/invest déjà exécutée ce mois (solde courant déjà impacté) → ne pas redéduire du budget libre
  let project_savings_executed = 0;
  for (const p of activeProjects.filter(isTransferProject)) {
    project_savings_executed += transactions
      .filter(t => t.project_id === p.id && !(t as any).is_draft && Number(t.amount) < 0)
      .filter(t => {
        const [tY, tM] = t.date.split('-').map(Number);
        return tY === currentYear && tM === currentMonth;
      })
      .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  }
  const project_savings_remaining = Math.max(0, project_savings_monthly - project_savings_executed);
  const transfer_savings_remaining = Math.max(0, transfer_savings - transfer_savings_past);
  const transfer_invest_remaining = Math.max(0, transfer_invest - transfer_invest_past);
  const monthly_savings_remaining = project_savings_remaining + transfer_savings_remaining;
  const monthly_invest_remaining = transfer_invest_remaining;
  // Pour le budget de recommandation : épargne réelle HORS projets, et invest réel.
  const real_savings_excl_projects = transfer_savings;
  const real_invest = transfer_invest;

  // =====================================================================
  // RÉSERVÉ : montants mis de côté persistants (jusqu'à utilisation/libération)
  //  - Projets « même compte » actifs : allocation mensuelle (comme avant)
  //  - Brouillons « Conservés » (is_reserved) : montant du brouillon, groupé par projet
  // =====================================================================
  const projectsById: Record<string, Project> = {};
  projects.forEach((p) => { projectsById[p.id] = p; });

  const reservedMap: Record<string, {
    id: string; name: string; total: number;
    source_account_id: string | null; linked_account_id: string | null;
  }> = {};

  const addReserved = (proj: Project, amount: number) => {
    if (amount <= 0) return;
    if (!reservedMap[proj.id]) {
      reservedMap[proj.id] = {
        id: proj.id, name: proj.name, total: 0,
        source_account_id: proj.source_account_id ?? null,
        linked_account_id: proj.linked_account_id ?? null,
      };
    }
    reservedMap[proj.id].total += amount;
  };

  // Brouillons « Conservés » (is_reserved) — inclut les projets même-compte (réservés d'office).
  // Groupés par projet (1 ligne par projet, montants cumulés).
  // §P11 : on ne compte QUE les occurrences jusqu'à la fin du mois courant (mensualité du mois +
  // accumulé des mois passés). Les mois FUTURS ne sont pas encore « réservés » (l'argent n'y est pas).
  const monthEndStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-31`;
  for (const t of transactions) {
    if (!(t as any).is_draft || !(t as any).is_reserved) continue;
    if ((t.date ?? '') > monthEndStr) continue;
    const pid = (t as any).project_id as string | null;
    if (!pid) continue;
    const proj = projectsById[pid];
    if (!proj) continue;
    addReserved(proj, Math.abs(Number(t.amount)) || Number(proj.monthly_allocation || 0));
  }

  const reserved_by_project = Object.values(reservedMap);
  const monthly_reserve_planned = reserved_by_project.reduce((s, r) => s + r.total, 0);

  // =====================================================================
  // ENVELOPPE DES DÉPENSES VARIABLES (estimation dynamique)
  //  Définition (UNIQUE, cf. `monthVariableSpent`) : dépenses NON RÉCURRENTES du budget quotidien.
  //  Initiale :
  //    - ≥ 2 mois passés avec dépenses variables (M-1..M-6) → moyenne
  //    - sinon → question 4 du questionnaire (champ q9, hebdo × 4,33 → mensuel)
  //  Restant = max(0, initiale − déjà dépensé ce mois) → déduit du Reste.
  //
  //  ⚠ L'enveloppe restante n'est VOLONTAIREMENT pas proratisée sur les jours écoulés : un
  //  utilisateur peut ne saisir ses dépenses qu'en milieu ou en fin de mois, auquel cas réduire
  //  l'estimation avec le calendrier lui promettrait un argent qu'il a déjà dépensé sans l'avoir
  //  encore noté. L'enveloppe se recalibre par l'HISTORIQUE, pas par l'horloge.
  // =====================================================================

  // Historique des 6 mois précédents — MÊME fonction que le mois courant (plus d'asymétrie entre
  // ce qu'on compte comme dépensé et ce à quoi on le compare).
  const pastMonths: Array<{ year: number; month: number; key: string }> = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date(currentYear, currentMonth - 1 - i, 1);
    pastMonths.push({ year: d.getFullYear(), month: d.getMonth() + 1, key: `${d.getFullYear()}-${d.getMonth() + 1}` });
  }
  const variableByPastMonth: Record<string, number> = {};
  pastMonths.forEach(m => { variableByPastMonth[m.key] = monthVariableSpent(m.year, m.month); });

  // « Dépensé variable » DU MOIS : calculé DIRECTEMENT sur les vraies lignes non récurrentes déjà
  // échues, au lieu de l'ancien « total dépensé − récurrentes reprojetées ». La soustraction
  // reposait sur une reprojection des templates récurrents (avec un cas spécial pour ceux
  // « avancés » par la matérialisation) et ignorait les échéances modifiées : le résultat pouvait
  // dériver de plusieurs dizaines d'euros. Ici il n'y a plus rien à reconstituer.
  const variable_envelope_spent = current_month_variable;

  // Historique = mois passés avec de vraies dépenses variables (> 0), pas toute transaction.
  // Les mois `estimated` (non confirmés) sont EXCLUS : leurs chiffres ne sont pas fiables et
  // pollueraient l'enveloppe des mois suivants.
  const estimatedMonths: Set<string> = (data as any).estimatedMonths ?? new Set();
  const monthsWithData = pastMonths.filter((m) => {
    const padded = `${m.year}-${String(m.month).padStart(2, '0')}`;
    return variableByPastMonth[m.key] > 0 && !estimatedMonths.has(padded);
  });
  let variable_envelope_initial = 0;
  let variable_envelope_source: 'history' | 'onboarding' | 'none' = 'none';
  let variable_envelope_months_used = 0;

  /* RÉFÉRENCE CHOISIE PAR L'UTILISATEUR (migration 164). 'auto' = comportement historique : le réel
     dès qu'il est calculable, sinon l'estimation déclarée. Les deux autres forcent, avec un
     garde-fou : « réel » sans historique suffisant retombe sur l'estimation — on ne fabrique pas
     une moyenne à partir d'un seul mois. Les DEUX valeurs sont calculées et exposées, pour que
     l'écran puisse montrer « voilà ce que tu aurais dans l'autre mode ». */
  const variableMode: 'auto' | 'estimate' | 'real' = ((profile as any)?.variable_envelope_mode ?? 'auto');
  const declaredWeekly =
    Number(profile?.weekly_variable_budget ?? 0) ||
    weeklyVariableFromQ9(String(data.questionnaireAnswers?.q9 ?? ''));
  const variable_estimate_value = declaredWeekly > 0 ? declaredWeekly * WEEKS_PER_MONTH : 0;
  const variable_real_value = monthsWithData.length >= 2
    ? monthsWithData.reduce((s, m) => s + variableByPastMonth[m.key], 0) / monthsWithData.length
    : 0;
  const realAvailable = monthsWithData.length >= 2;
  const useReal = realAvailable && variableMode !== 'estimate';

  if (useReal) {
    variable_envelope_initial = variable_real_value;
    variable_envelope_source = 'history';
    variable_envelope_months_used = monthsWithData.length;
  } else if (variable_estimate_value > 0) {
    variable_envelope_initial = variable_estimate_value;
    variable_envelope_source = 'onboarding';
  } else if (realAvailable) {
    // Mode « estimation » demandé mais rien de déclaré → le réel vaut mieux que rien.
    variable_envelope_initial = variable_real_value;
    variable_envelope_source = 'history';
    variable_envelope_months_used = monthsWithData.length;
  }

  /* ── DÉPENSES VARIABLES DÉJÀ SAISIES POUR LA FIN DU MOIS ────────────────────────────────────────
     Une dépense variable DATÉE DANS LE FUTUR (un achat prévu le 25) est déjà déduite du point bas :
     `computeCashflowTrough` la rejoue jour après jour. Or l'enveloppe restante, elle, continuait de
     provisionner le mois entier comme si de rien n'était — la même dépense était donc retirée DEUX
     FOIS du Relyka. Constat mesuré : 200 € saisis pour le 25 faisaient tomber le Relyka de 567 € à
     367 €, alors que les mêmes 200 € déjà dépensés le laissaient à 567 €. Anticiper ses dépenses,
     ce que l'app encourage, était donc puni.
     BORNE au point bas : au-delà de cette date, la dépense n'est PAS dans le point bas (celui-ci est
     un minimum, pas un solde de fin de mois) — la retirer de l'enveloppe la ferait disparaître de
     tous les calculs. Elle reste alors couverte par l'estimation, comme avant. */
  const troughBound = troughDate > todayStr ? troughDate : todayStr;
  const variable_envelope_planned = monthVariableSpent(
    currentYear, currentMonth,
    troughBound < curMonthEnd ? troughBound : curMonthEnd,
    todayStr,
  );
  const variable_envelope_remaining = Math.max(
    0,
    variable_envelope_initial - variable_envelope_spent - variable_envelope_planned,
  );

  /* ── DÉPENSES ESSENTIELLES DU MOIS : ce qu'il faut couvrir pour continuer à vivre ─────────────
     Charges RÉCURRENTES du mois (loyer, abonnements, crédits, assurances…) + enveloppe variable
     retenue. C'est la base du matelas de sécurité (cf. lib/securityCushion) : « combien de temps
     je tiens sans rentrée d'argent » se mesure sur ce qui SORT, pas sur ce qui rentrait.

     Périmètre volontairement identique à celui du point bas : comptes courants, hors brouillons,
     hors projets, et hors VIREMENTS vers l'épargne ou l'investissement — mettre de côté n'est pas
     une dépense qu'on doit continuer d'assumer si le revenu s'arrête, c'est la première chose
     qu'on suspend. Les compter aurait fait fondre le matelas de ceux qui épargnent le plus. */
  let monthly_recurring_expenses = 0;
  {
    const monthStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
    for (const t of transactions) {
      if (!checkingIds.has(t.account_id) || (t as any).is_draft || (t as any).is_reserved) continue;
      if ((t as any).project_id) continue;
      if (!(t.is_recurring && t.recurrence_rule)) continue;
      // Virement sortant vers un compte à soi (épargne/invest) → pas une charge à couvrir.
      if (t.linked_account_id) continue;
      for (const occ of recurrenceOccurrencesBetween(
        t.date, t.recurrence_rule as RecurrenceRule, (t as any).recurrence_end_date ?? null,
        monthStart, curMonthEnd,
      )) {
        const amt = realSignedAt(t, occ);
        if (amt < 0) monthly_recurring_expenses += -amt;
      }
    }
  }
  const monthly_essential_expenses = monthly_recurring_expenses + variable_envelope_initial;

  /* ── L'UTILISATEUR A-T-IL RENSEIGNÉ SES CHARGES ? ────────────────────────────────────────────
     Question binaire, et VOLONTAIREMENT plus large que le montant calculé juste au-dessus. Celui-ci
     applique un périmètre strict (comptes courants du périmètre, hors projets, hors virements) : un
     utilisateur qui couvre ses charges par un VIREMENT MENSUEL vers un compte joint — où le crédit
     et les charges de copropriété sont prélevés — obtenait donc « 0 € de charges », donc « tes
     charges ne sont pas renseignées », alors qu'il venait précisément de les saisir.
     Ici on répond à « a-t-il saisi au moins une dépense récurrente ? », sans périmètre : c'est ce
     qui décide si l'app a de quoi mesurer un train de vie. Seuls les virements vers SA PROPRE
     épargne ou ses placements sont écartés — mettre de côté n'est pas une charge. */
  const setAsideIds = new Set(
    accounts.filter((a) => a.type === 'savings' || a.type === 'investment').map((a) => a.id),
  );
  const has_recurring_expenses = transactions.some((t) => (
    t.is_recurring && t.recurrence_rule
    && !(t as any).is_draft
    && Number(t.amount) < 0
    && !(t.linked_account_id && setAsideIds.has(t.linked_account_id))
  ));

  /* Répartition CHOISIE par l'utilisateur, si elle est exploitable (cf. lib/finance/recoMode) :
     `null` en mode automatique. Lue ici une fois, appliquée plus bas aux champs d'allocation. */
  const manualAlloc = resolveRecoMode(profile as any).manualAllocation;

  // ── Référence de variable UNIFIÉE (Pilotage ET Reporting) ────────────────────────────────────
  // C'est L'ENVELOPPE elle-même : le questionnaire tant qu'on n'a pas 2 mois de données réelles,
  // puis la moyenne réelle sur jusqu'à 6 mois d'historique (plus l'historique grandit, plus la
  // fenêtre s'élargit). Le Reporting compare donc à la MÊME référence que le curseur « dont variables »
  // du Pilotage — plus d'écart « 600 € ici / 5 000 € là ».
  const avg_variable_expenses_3m = variable_envelope_initial;
  /** Part de l'enveloppe DÉJÀ consommée (0-100+). Sert à l'affichage, pas à juger un comportement. */
  const variable_trend_percentage = avg_variable_expenses_3m > 0
    ? (current_month_variable / avg_variable_expenses_3m) * 100
    : 0;
  /* RYTHME (≠ remplissage) : le dépensé rapporté à l'AVANCEMENT du mois — 100 = pile le rythme
     habituel, quel que soit le jour où on regarde. `variable_trend_percentage` ci-dessus vaut
     mécaniquement 5 % le 3 du mois et 95 % le 28 : en tirer « dépenses en baisse / en hausse »
     revenait à juger le calendrier, pas l'utilisateur (cf. lib/spendingPace). `null` = trop tôt
     dans le mois pour conclure ; les lecteurs doivent alors ne RIEN conclure. */
  const variable_pace_percentage = variablePacePercentage({
    spent: variable_envelope_spent,
    envelope: variable_envelope_initial,
    dayOfMonth: now.getDate(),
    daysInMonth: new Date(currentYear, currentMonth, 0).getDate(),
  });

  // σ des dépenses variables (mois FIABLES uniquement) — alimente le cône de la Projection.
  // < 2 mois fiables → 0 (les écrans utilisent alors leur repli : fraction de l'enveloppe).
  let variable_sigma = 0;
  if (monthsWithData.length >= 2) {
    const vals = monthsWithData.map((m) => variableByPastMonth[m.key]);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    variable_sigma = Math.sqrt(vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / vals.length);
  }

  // ── Confiance : signaux bruts. Le niveau/fourchette sont calculés par confidenceEngine côté écrans
  // avec le VRAI Relyka (resteDisponible), pour n'avoir qu'UNE seule fonction de doute partout.
  // lastVerifiedAt = date de la dernière régularisation dans le périmètre (= dernière « vérification »).
  // Une régularisation DATÉE DANS LE FUTUR ne vérifie rien : elle affirmerait que les chiffres
  // d'aujourd'hui ont déjà été contrôlés. Même borne que l'ancre de création juste en dessous.
  let lastRegulAt: string | null = null;
  for (const t of transactions) {
    if (!isRegul(t)) continue;
    const d = String((t as any).date ?? '').slice(0, 10);
    if (d && d <= todayStr && (!lastRegulAt || d > lastRegulAt)) lastRegulAt = d;
  }
  /* ── ANCRE « VÉRIFICATION N° 0 » : LE PLUS ANCIEN COMPTE QUI VIT ENCORE ───────────────────────
     La création d'un compte courant est une vérification : le solde initial est recopié depuis la
     banque, l'écart est nul ce jour-là (init_date si constaté à une autre date).

     Deux écueils à éviter, en sens inverse :

      • prendre l'ancre la plus RÉCENTE — ouvrir un deuxième compte courant faisait repasser toute
        l'app en « À jour », y compris pour un compte principal que personne n'avait vérifié depuis
        des mois. Or la vérification du solde porte sur TOUS les comptes à la fois (cf. l'écran
        « Mettre à jour mon solde ») : elle ne peut pas être plus fraîche que le compte le moins
        bien couvert ;

      • prendre l'ancre la plus ANCIENNE sans distinction — un vieux compte qui ne BOUGE PAS
        maintiendrait éternellement l'app en « estimation », alors qu'un compte sans mouvement ne
        peut pas dériver : le doute vient des opérations non saisies, pas du temps qui passe.

     On ne retient donc que les comptes qui ont eu au moins une opération depuis leur ancre — eux
     seuls ont pu s'écarter de la réalité — et parmi eux le plus ancien. Si AUCUN ne bouge, on garde
     l'ancre la plus récente : zéro opération enregistrée sur un compte courant pendant des mois veut
     plutôt dire que l'app est aveugle, pas que le compte dort — mieux vaut alors laisser le doute
     s'installer que d'afficher un « À jour » qui ne repose sur rien. */
  const anchorByChecking = new Map<string, string>();
  for (const a of accounts) {
    if (a.type !== 'checking') continue;
    const d = String((a as any).init_date ?? (a as any).created_at ?? '').slice(0, 10);
    if (!d || d > todayStr) continue;
    anchorByChecking.set(a.id, d);
  }
  const movedSinceAnchor = new Set<string>();
  for (const t of transactions as any[]) {
    if (t.is_draft) continue;
    const anchor = anchorByChecking.get(t.account_id);
    if (!anchor) continue;
    const d = String(t.date ?? '').slice(0, 10);
    // Une opération FUTURE ne prouve rien sur ce qui s'est déjà passé sur le compte.
    if (d && d > anchor && d <= todayStr) movedSinceAnchor.add(t.account_id);
  }
  let oldestAnchor: string | null = null;
  for (const [id, d] of anchorByChecking) {
    if (!movedSinceAnchor.has(id)) continue;
    if (!oldestAnchor || d < oldestAnchor) oldestAnchor = d;
  }
  if (!oldestAnchor) {
    for (const d of anchorByChecking.values()) if (!oldestAnchor || d > oldestAnchor) oldestAnchor = d;
  }
  // Une régul postérieure à l'ancre remet bien tout le monde à jour (elle couvre tous les comptes).
  const lastVerifiedAt: string | null =
    lastRegulAt && oldestAnchor ? (lastRegulAt > oldestAnchor ? lastRegulAt : oldestAnchor)
    : (lastRegulAt ?? oldestAnchor);
  const reliability_calib = ((profile as any)?.reliability_calib ?? null) as DriftCalibration | null;
  const confidence_floor_base = Math.max(avgMonthlyIncome, variable_envelope_initial, 0);
  /* ── SIGNAUX D'OBSERVATION (fenêtre glissante de OBSERVATION_WINDOW_DAYS jours) ────────────────
     Le doute ne doit pas dépendre de la seule horloge : il mesure ce qui a pu échapper à la saisie.
     Deux séries JOURNALIÈRES le permettent, consommées par confidenceEngine :

       • `activityDays` — les jours portant au moins une SAISIE MANUELLE (date de saisie
         `created_at`, pas la date de la transaction) → l'ASSIDUITÉ, qui amortit le doute. Exclus :
         réguls (ce sont déjà des vérifications), occurrences matérialisées (automatiques, pas un
         geste du user), modèles récurrents et brouillons. On ne filtre PLUS sur le mois de la
         transaction : saisir le 2 août les dépenses du 30 juillet est du suivi, pas du bruit.

       • `variableSpentByDay` — les dépenses VARIABLES constatées, par jour de transaction → ce qui
         a été observé ne peut plus compter comme « ce qui a échappé ». Mêmes prédicats que
         l'enveloppe (`isBudgetExpense` / `isRecurringTx`) : comparer un dépensé plus large que sa
         propre référence est exactement l'asymétrie que ce fichier a déjà corrigée une fois.

     Des JOURS bruts plutôt que des totaux : la fenêtre réellement utilisée dépend des réglages
     admin (que ce moteur ne connaît pas), et proratiser un agrégat aurait faussé le cas même qu'on
     traite — celui du user assidu. Trente entrées au plus, une seule passe. */
  const windowStart = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (OBSERVATION_WINDOW_DAYS - 1)));
  const activityDaySet = new Set<string>();
  const variableSpentByDay: Record<string, number> = {};
  for (const t of transactions as any[]) {
    const isTemplateOrAuto = t.is_draft || t.materialized_from || (t.is_recurring && t.recurrence_rule);
    if (!isTemplateOrAuto && !isRegul(t)) {
      const created = String(t.created_at ?? '').slice(0, 10);
      if (created && created >= windowStart && created <= todayStr) activityDaySet.add(created);
    }
    // Dépensé variable du jour — le périmètre EXACT de l'enveloppe, plus les bornes de la fenêtre.
    if (t.is_draft || t.is_reserved || isRecurringTx(t) || !isBudgetExpense(t)) continue;
    const d = String(t.date ?? '').slice(0, 10);
    if (!d || d < windowStart || d > todayStr) continue;
    const amt = Number(t.amount);
    // Même règle que `monthVariableSpent` : un montant positif ne se déduit que sur une VRAIE
    // catégorie de dépense (remboursement) ; sinon c'est une recette / un apport / une régul.
    if (amt >= 0 && !(t.category && t.category.type === 'expense')) continue;
    variableSpentByDay[d] = (variableSpentByDay[d] ?? 0) + -amt;
  }
  const activityDays = [...activityDaySet];

  // ── Soldes projetés 6 mois (trajectoire de l'écran Projection, virements épargne/invest inclus)
  // pour le garde-fou marge des recommandations. Overrides SIGNÉS tous mois, format `${id}:${y}:${m}`.
  const signedOvrAllMonths: Record<string, number> = {};
  for (const o of (data as any).monthOverrides ?? []) {
    // Converti en devise de référence (cf. `overrideToRef`) : la trajectoire raisonne dans cette
    // devise, comme l'écran Projection qui affiche la même courbe.
    if (o.override_amount != null) signedOvrAllMonths[`${o.transaction_id}:${o.year}:${o.month}`] = overrideToRef(o);
  }
  const projection_rows_12m = computeTresoRows({
    transactions,
    accounts,
    overridesMap: signedOvrAllMonths,
    variableMonthly: variable_envelope_initial,
    variableRemaining: variable_envelope_remaining,
    monthsCount: 12,
    now,
  });
  const projection_balances_12m = projection_rows_12m.map((r) => r.balance);
  const projection_balances_6m = projection_balances_12m.slice(0, 6);
  // Revenus (recettes) attendus par mois — même trajectoire que la Projection, overrides inclus.
  // Alimente la ligne « revenus attendus mois par mois » du snapshot Conseils IA (bien plus juste
  // pour un indépendant qu'une seule ligne « X €/mois »).
  const projection_income_12m = projection_rows_12m.map((r) => ({
    ym: `${r.year}-${String(r.month).padStart(2, '0')}`,
    income: Math.round(r.income),
  }));

  return {
    safe_to_spend,
    current_checking_balance,
    remaining_fixed_expenses,
    committed_allocations,
    monthly_commitments,
    same_account_reserved,
    month_income_remaining,
    cashflow_trough: trough,
    cashflow_trough_date: troughDate,
    cashflow_horizon_end: horizonEnd,
    next_income_date: nextIncomeDate,
    next_income_amount,
    expected_monthly_income: expectedIncome.monthlyAmount,
    avg_monthly_income: avgMonthlyIncome,
    expected_income_source: expectedIncome.source,
    expected_income_confidence: expectedIncome.confidence,
    projection_min_buffer,
    projection_in_danger,
    prudence,
    monthly_savings_planned,
    monthly_savings_remaining,
    monthly_invest_planned,
    monthly_invest_remaining,
    month_savings_total,
    month_savings_future,
    month_invest_total,
    month_invest_future,
    real_savings_excl_projects,
    real_invest,
    monthly_reserve_planned,
    month_expenses_total,
    month_expenses_past,
    month_expenses_remaining,
    reserved_by_project,
    avg_variable_expenses_3m,
    current_month_variable,
    variable_trend_percentage,
    variable_pace_percentage,
    variable_envelope_initial,
    variable_envelope_spent,
    variable_envelope_planned,
    variable_envelope_remaining,
    variable_envelope_source,
    variable_envelope_mode: variableMode,
    variable_estimate_value,
    variable_real_value,
    variable_real_available: realAvailable,
    variable_real_months: monthsWithData.length,
    variable_envelope_months_used,
    monthly_recurring_expenses,
    monthly_essential_expenses,
    projected_surplus,
    recommendation,
    safety_margin_percent,
    safety_margin_amount,
    financial_profile: profile?.financial_profile ?? undefined,
    /* RÉPARTITION ATTACHÉE À L'UTILISATEUR. Les colonnes `allocation_*_percent` sont réécrites par le
       moteur de profil à chaque changement de palier : elles reflètent donc l'AUTOMATIQUE. Quand
       l'utilisateur a posé ses propres pourcentages (migration 205), ce sont EUX qui s'appliquent —
       et deux consommateurs annonçaient sinon les mauvais chiffres en les attribuant à l'utilisateur :
       le contexte envoyé aux conseils IA (« répartition paramétrée par l'utilisateur ») et l'export
       de données. On corrige à la source plutôt que chez chacun d'eux. */
    allocation_save_percent: manualAlloc?.save ?? profile?.allocation_save_percent ?? undefined,
    allocation_invest_percent: manualAlloc?.invest ?? profile?.allocation_invest_percent ?? undefined,
    allocation_enjoy_percent: manualAlloc?.enjoy ?? profile?.allocation_enjoy_percent ?? undefined,
    allocation_keep_percent: manualAlloc?.keep ?? profile?.allocation_keep_percent ?? undefined,
    initial_onboarding_completed: profile?.initial_onboarding_completed ?? false,
    available_savings,
    projects_with_progress,
    global_projects_percentage,
    total_checking,
    total_savings,
    total_invested,
    has_savings_account,
    has_recurring_expenses,
    safety_threshold_min,
    safety_threshold_optimal,
    safety_threshold_comfort,
    current_savings,
    // Overrides du mois courant exposés à l'écran (modaux Épargne/Investi/Dépensé) pour qu'ils
    // affichent le même montant RÉEL que les curseurs (et non le montant figé du template).
    monthOverrides: ovrByTx,
    // Périmètre & confiance (packages Fiabilité / Comptes partagés).
    joint_share_outside_perimeter,
    joint_share_in_checking,
    variable_sigma,
    consecutive_overdraft_months,
    confidence_inputs: {
      lastVerifiedAt, activityDays, variableSpentByDay, calibration: reliability_calib,
      floorBase: confidence_floor_base,
      // Base du COLD START : seules les dépenses variables peuvent vraiment être « perdues de vue ».
      variableBase: variable_envelope_initial,
    },
    projection_balances_6m,
    projection_balances_12m,
    projection_income_12m,
  };
}
