import { useQuery, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { weeklyVariableFromQ9, WEEKS_PER_MONTH } from '../lib/financialProfileEngine';
import { convertAmount, type RatesMap } from '../lib/currency';
import { fetchSharedContribution } from './useSharedContribution';
import { buildCreditPilotTxs } from './useCreditFlows';
import { buildPerimeterCtx, splitPerimeterAccounts, transformFluxTransactions } from '../lib/perimeter';
import { isRegul } from '../lib/regul';
import { isProjectSpendTx, projectMode } from '../lib/projectTx';
import { computeTresoRows } from '../lib/tresoProjection';
import { computeCashflowTrough } from '../lib/relyka';
import { computeAvgMonthlyIncome } from '../lib/incomeAverage';
import type { DriftCalibration } from '../lib/confidenceEngine';
import type { Account, Transaction, Project, Profile, Category, FinancialProfile, RecurrenceRule, TransactionWithDetails } from '../types/database';

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
  variable_trend_percentage: number;

  // Enveloppe des dépenses variables (estimation dynamique)
  variable_envelope_initial: number;    // enveloppe estimée du mois (historique ou onboarding)
  variable_envelope_spent: number;      // dépenses variables déjà engagées ce mois
  variable_envelope_remaining: number;  // = max(0, initial − spent) : reste à déduire du « Reste du mois »
  variable_envelope_source: 'history' | 'onboarding' | 'none';
  variable_envelope_months_used: number; // nb de mois d'historique utilisés (si source = history)

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
  /** Signaux bruts de confiance (le niveau/fourchette sont calculés côté écrans via confidenceEngine). */
  confidence_inputs: { lastVerifiedAt: string | null; lastActivityAt: string | null; calibration: DriftCalibration | null; floorBase: number; variableBase: number };
  /** Soldes courants projetés en fin de mois sur 6 mois (index 0 = mois courant) — même trajectoire
   *  que l'écran Projection (lib/tresoProjection). Alimente le garde-fou marge des recommandations. */
  projection_balances_6m: number[];
  /** Même trajectoire prolongée à 12 mois (anticipation long terme : snapshot Conseils IA). */
  projection_balances_12m: number[];
  /** Revenus (recettes) attendus par mois sur 12 mois — même trajectoire (overrides inclus). */
  projection_income_12m: { ym: string; income: number }[];
}

// Fetch multiple data types
async function fetchPilotageData(profileId: string): Promise<{
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
}> {
  if (!supabase || !profileId) throw new Error('Not authenticated');

  // FENÊTRAGE des transactions : le moteur Pilotage ne regarde JAMAIS plus de 6 mois en arrière
  // (revenu inféré 4 mois, revenu moyen 6 mois, net 3 mois, tendance/enveloppe variables 3-6 mois) ;
  // le reste = mois courant + FUTUR + modèles récurrents. On borne donc le fetch à 8 mois glissants
  // (marge) + toutes les récurrentes (quelle que soit leur date de départ) : un compte avec des
  // années d'historique ne re-télécharge plus TOUT à chaque ouverture / après chaque saisie.
  // (Le « 1ᵉʳ mois utilisateur » de computeAvgMonthlyIncome est sécurisé par profiles.created_at.)
  const nowD = new Date();
  const histStart = isoDay(new Date(nowD.getFullYear(), nowD.getMonth() - 7, 1));

  const [profileRes, accountsRes, transactionsRes, projectsRes, qaRes, ratesRes, overridesRes, creditsRes, creditEvtRes, closuresRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', profileId).single(),
    supabase.from('accounts').select('*').eq('profile_id', profileId),
    // Jointure catégorie réduite aux champs consommés par le moteur (type/name/is_variable/parent).
    supabase.from('transactions').select('*, account:accounts!account_id(name), category:categories!category_id(id, name, type, is_variable, parent_id)')
      .eq('profile_id', profileId)
      .or(`date.gte.${histStart},is_recurring.eq.true`),
    supabase.from('projects').select('*').eq('profile_id', profileId),
    supabase.from('user_questionnaire_answers').select('*').eq('user_id', profileId).maybeSingle(),
    supabase.from('currency_rates').select('code, rate'),
    supabase.from('transaction_month_overrides').select('transaction_id, year, month, override_amount').eq('profile_id', profileId),
    supabase.from('credits').select('*, category:categories!category_id(id, name, is_variable, parent_id), insurance_category:categories!insurance_category_id(id, name, is_variable, parent_id)').eq('profile_id', profileId),
    supabase.from('credit_events').select('*').eq('profile_id', profileId),
    supabase.from('month_closures').select('month_key, status').eq('profile_id', profileId),
  ]);

  if (profileRes.error) throw profileRes.error;
  if (accountsRes.error) throw accountsRes.error;
  if (transactionsRes.error) throw transactionsRes.error;
  if (projectsRes.error) throw projectsRes.error;
  if (qaRes.error) throw qaRes.error;
  // Taux : non bloquant (si erreur → EUR seul ; la conversion laissera les montants tels quels).
  const rates: RatesMap = { EUR: 1 };
  for (const r of (ratesRes.data ?? []) as { code: string; rate: number }[]) rates[r.code] = Number(r.rate);

  // #5 — Comptes partagés/joints : PONDÉRÉS au % d'impact (au lieu d'être exclus). On prend les données
  // PERSO (hors comptes partagés) + la contribution des comptes partagés (toutes les tx de tous les
  // participants), soldes & montants ×facteur. Plus de doublon : on retire les comptes partagés du perso.
  const allAccounts = (accountsRes.data ?? []) as Account[];
  const shared = await fetchSharedContribution(profileId);
  const sharedIdSet = new Set(Object.keys(shared.factorByAccount));
  const persoAccounts = allAccounts.filter((a) => !sharedIdSet.has(a.id) && !(a as any).is_joint);
  // Échéances de crédit MATÉRIALISÉES (credit_kind, migration 143) : exclues du Pilotage — la charge
  // crédit y est représentée par les récurrentes synthétiques (creditPilotTx) qui couvrent TOUS les
  // mois (passés + futurs) ; garder les deux compterait chaque mensualité deux fois.
  const persoTransactions = (transactionsRes.data ?? []).filter((t: any) => !sharedIdSet.has(t.account_id) && !t.credit_kind);

  // Crédit (Pilotage) — mensualités en récurrentes synthétiques (remboursement + assurance, catégorisées,
  // pondérées par le % d'impact du compte si partagé). Cohérent avec tréso/projection.
  const acctById: Record<string, any> = {};
  [...persoAccounts, ...shared.accounts].forEach((a: any) => { acctById[a.id] = a; });
  const evtByCredit: Record<string, any[]> = {};
  for (const e of (creditEvtRes.data ?? []) as any[]) (evtByCredit[e.credit_id] ??= []).push(e);
  const creditPilotTx = ((creditsRes.data ?? []) as any[])
    .flatMap((c) => buildCreditPilotTxs(c as any, evtByCredit[c.id], acctById[c.account_id]));

  // Mois `estimated` (non confirmés) → exclus des baselines (moyennes variables, revenu moyen, σ).
  const estimatedMonths = new Set(
    ((closuresRes.data ?? []) as any[]).filter((c) => c.status === 'estimated').map((c) => c.month_key as string),
  );

  return {
    profile: (profileRes.data as Profile) || null,
    sharedFactor: shared.factorByAccount,
    sharedModeById: shared.modeByAccount,
    estimatedMonths,
    accounts: [...persoAccounts, ...shared.accounts],
    transactions: [
      ...persoTransactions.map((t: any) => ({ ...t, amount: Number(t.amount), account: t.account, category: t.category })),
      // Même exclusion côté comptes partagés (les synthétiques crédit sont déjà pondérées par le % d'impact).
      ...shared.transactions.filter((t: any) => !t.credit_kind),
      ...creditPilotTx,
    ] as TransactionWithCategory[],
    projects: (projectsRes.data ?? []).map((p: any) => ({
      ...p,
      target_amount: Number(p.target_amount),
      monthly_allocation: Number(p.monthly_allocation),
    })) as Project[],
    questionnaireAnswers: qaRes.data ?? null,
    monthOverrides: (overridesRes.data ?? []) as { transaction_id: string; year: number; month: number; override_amount: number | null }[],
    rates,
  };
}

// Helper: Check if a recurring transaction applies to this month
function addRecurrenceToMonth(year: number, month: number, amount: number, startDate: string, rule: RecurrenceRule, endDate: string | null, currentDate: Date): number {
  const start = new Date(startDate);
  const maxEndDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 24, 1);
  const end = endDate ? new Date(Math.min(new Date(endDate).getTime(), maxEndDate.getTime())) : maxEndDate;
  const thisMonthStart = new Date(year, month - 1, 1);
  const thisMonthEnd = new Date(year, month, 0);

  if (start > thisMonthEnd || end < thisMonthStart) return 0;
  if (rule === 'monthly') return amount;
  if (rule === 'quarterly') {
    const startMonth = start.getFullYear() * 12 + start.getMonth();
    const thisMonth = year * 12 + (month - 1);
    return (thisMonth - startMonth) % 3 === 0 && thisMonth >= startMonth ? amount : 0;
  }
  if (rule === 'yearly') return start.getMonth() === month - 1 && year >= start.getFullYear() ? amount : 0;
  if (rule === 'weekly') {
    let count = 0;
    let d = new Date(start);
    while (d <= thisMonthEnd) {
      if (d >= thisMonthStart) count++;
      d.setDate(d.getDate() + 7);
      if (d > end) break;
    }
    return count * amount;
  }
  return 0;
}

/** Montant récurrent déjà passé dans le mois courant (date ≤ todayStr). */
function recurrencePastInMonth(
  year: number, month: number, amount: number, startDate: string,
  rule: RecurrenceRule, endDate: string | null, todayStr: string, currentDate: Date,
): number {
  const total = addRecurrenceToMonth(year, month, amount, startDate, rule, endDate, currentDate);
  const start = new Date(startDate);
  const thisMonthStart = new Date(year, month - 1, 1);
  const thisMonthEnd = new Date(year, month, 0);
  const maxEndDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 24, 1);
  const end = endDate ? new Date(Math.min(new Date(endDate).getTime(), maxEndDate.getTime())) : maxEndDate;
  if (start > thisMonthEnd || end < thisMonthStart) return 0;

  if (rule === 'monthly') {
    const day = Math.min(start.getDate(), thisMonthEnd.getDate());
    const occ = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (occ < startDate.slice(0, 10)) return 0;
    return occ <= todayStr ? total : 0;
  }
  if (rule === 'weekly') {
    let past = 0;
    let d = new Date(start);
    while (d <= thisMonthEnd) {
      if (d >= thisMonthStart) {
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (ds <= todayStr) past += amount;
      }
      d.setDate(d.getDate() + 7);
      if (d > end) break;
    }
    return past;
  }
  if (rule === 'quarterly') {
    const startMonth = start.getFullYear() * 12 + start.getMonth();
    const thisMonth = year * 12 + (month - 1);
    if ((thisMonth - startMonth) % 3 !== 0 || thisMonth < startMonth) return 0;
    const day = Math.min(start.getDate(), thisMonthEnd.getDate());
    const occ = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return occ <= todayStr ? amount : 0;
  }
  if (rule === 'yearly') {
    if (start.getMonth() !== month - 1 || year < start.getFullYear()) return 0;
    const day = Math.min(start.getDate(), thisMonthEnd.getDate());
    const occ = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return occ <= todayStr ? amount : 0;
  }
  return 0;
}

// ── Horizon glissant / creux de trésorerie ──────────────────────────────────
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + days); return isoDay(d);
}
function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

/** Occurrences (ISO) d'un modèle récurrent, strictement après `afterStr` et ≤ `untilStr`. */
function recurrenceOccurrencesBetween(startDate: string, rule: RecurrenceRule, endDate: string | null, afterStr: string, untilStr: string): string[] {
  const out: string[] = [];
  const start = new Date(startDate.slice(0, 10) + 'T00:00:00');
  const until = new Date(untilStr + 'T00:00:00');
  const end = endDate ? new Date(endDate.slice(0, 10) + 'T00:00:00') : null;
  if (rule === 'weekly') {
    const d = new Date(start);
    while (isoDay(d) <= afterStr) d.setDate(d.getDate() + 7);
    let guard = 0;
    while (d <= until && (!end || d <= end) && guard++ < 200) { out.push(isoDay(d)); d.setDate(d.getDate() + 7); }
    return out;
  }
  const step = rule === 'monthly' ? 1 : rule === 'quarterly' ? 3 : rule === 'yearly' ? 12 : 0;
  if (step === 0) return out;
  const baseDay = start.getDate();
  const startTotal = start.getFullYear() * 12 + start.getMonth();
  for (let i = 0; i < 240; i++) {
    const total = startTotal + i * step;
    const yy = Math.floor(total / 12), mm = total % 12;
    const dim = new Date(yy, mm + 1, 0).getDate();
    const occ = new Date(yy, mm, Math.min(baseDay, dim));
    if (end && occ > end) break;
    const occStr = isoDay(occ);
    if (occStr > untilStr) break;
    if (occStr > afterStr) out.push(occStr);
  }
  return out;
}

export interface ExpectedIncome { monthlyAmount: number; nextDate: string | null; day: number; confidence: number; source: 'explicit' | 'inferred' | 'none' }

/** Détecte le revenu attendu : récurrent explicite, sinon inféré de l'historique (4 mois). */
function detectExpectedIncome(transactions: any[], checkingIds: Set<string>, todayStr: string): ExpectedIncome {
  const none: ExpectedIncome = { monthlyAmount: 0, nextDate: null, day: 1, confidence: 0, source: 'none' };
  // 1) Explicite : virement/recette récurrent(e) mensuel(le) entrant(e) sur un compte courant.
  const explicit = transactions.filter((t) =>
    checkingIds.has(t.account_id) && t.is_recurring && t.recurrence_rule === 'monthly'
    && Number(t.amount) > 0 && !t.is_draft && !t.linked_account_id);
  if (explicit.length > 0) {
    const top = explicit.slice().sort((a, b) => Number(b.amount) - Number(a.amount))[0];
    const occ = recurrenceOccurrencesBetween(top.date, 'monthly', top.recurrence_end_date ?? null, todayStr, addDaysIso(todayStr, 40))[0] ?? null;
    return { monthlyAmount: Number(top.amount), nextDate: occ, day: new Date(top.date).getDate(), confidence: 1, source: 'explicit' };
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
    groups[key].days.push(new Date(t.date).getDate());
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

// Compute Pilotage Dashboard Data
function computePilotageData(data: Awaited<ReturnType<typeof fetchPilotageData>>): PilotageData {
  const now = new Date();
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
  const total_invested = accounts.filter(a => a.type === 'investment').reduce((sum, a) => sum + Number(a.balance), 0);

  const safety_threshold_min = profile?.safety_threshold_min ?? 5000;
  const safety_threshold_optimal = profile?.safety_threshold_optimal ?? 10000;
  const safety_threshold_comfort = profile?.safety_threshold_comfort ?? 20000;
  const current_savings = total_savings;

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
  // Overrides du mois courant : montant modifié d'une occurrence récurrente pour CE mois. Les
  // indicateurs (dépensé, épargné, investi) doivent refléter ce RÉEL, pas le montant figé du template.
  const ovrByTx: Record<string, number> = {};
  for (const o of (data as any).monthOverrides ?? []) {
    if (o.year === currentYear && o.month === currentMonth && o.override_amount != null) ovrByTx[o.transaction_id] = Math.abs(Number(o.override_amount));
  }
  /** Montant d'une transaction pour le mois courant : override mensuel s'il existe, sinon le montant du modèle. */
  const effAbs = (t: any) => ovrByTx[t.id] ?? Math.abs(Number(t.amount));
  // Overrides TOUS MOIS (pour projeter le RÉEL au-delà du mois courant : creux, prochaines recettes).
  const ovrByTxMonth: Record<string, number> = {};
  for (const o of (data as any).monthOverrides ?? []) {
    if (o.override_amount != null) ovrByTxMonth[`${o.transaction_id}:${o.year}:${o.month}`] = Math.abs(Number(o.override_amount));
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
  // =====================================================================

  /** Sortie qui pèse sur le budget : depuis un compte courant, hors virement, hors projet (sauf
   *  « dépenser petit à petit » qui sort vraiment), catégorie de dépense (ou sans catégorie),
   *  hors régularisation de solde. */
  const isBudgetExpense = (t: any): boolean => {
    if (accountTypeById[t.account_id] !== 'checking') return false;
    if (t.linked_account_id) return false;
    if (t.project_id && !isProjectSpendTx(t)) return false;
    const cat = t.category;
    if (cat && cat.type !== 'expense') return false;
    if (cat?.name && /r[ée]gularisation/i.test(cat.name)) return false;
    return true;
  };

  /** « Variable » = tout ce qui n'est PAS récurrent.
   *  ⚠ Une occurrence MATÉRIALISÉE d'une récurrente est une vraie ligne avec `is_recurring = false`
   *  et `materialized_from` renseigné : sans ce second test, chaque loyer déjà matérialisé
   *  basculerait en « variable » et gonflerait à la fois l'historique et le dépensé du mois. */
  const isRecurringTx = (t: any): boolean =>
    (Boolean(t.is_recurring) && Boolean(t.recurrence_rule)) || Boolean(t.materialized_from);

  /**
   * Dépenses VARIABLES réellement passées sur un mois donné, en NET (un remboursement sur une
   * catégorie de dépense vient en déduction). `upTo` borne au jour près (mois courant).
   * MÊME fonction pour le dépensé du mois et pour les mois d'historique qui calibrent l'enveloppe.
   */
  const monthVariableSpent = (year: number, month: number, upTo?: string): number => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    let sum = 0;
    for (const t of transactions as any[]) {
      if (t.is_draft || t.is_reserved) continue;
      if (isRecurringTx(t)) continue;
      const d = String(t.date ?? '');
      if (!d.startsWith(prefix)) continue;
      if (upTo && d > upTo) continue;
      if (!isBudgetExpense(t)) continue;
      const amt = Number(t.amount);
      // Montant positif : ce n'est un remboursement (à déduire) que sur une VRAIE catégorie de
      // dépense. Sinon c'est une recette / un apport / une régul → hors dépenses variables.
      if (amt >= 0 && !(t.category && t.category.type === 'expense')) continue;
      sum += -amt; // dépense (−) → +, remboursement (+) → −
    }
    return Math.max(0, sum);
  };

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
  const avgMonthlyIncome = computeAvgMonthlyIncome(transactions, checkingIds, todayStr, (data.profile as any)?.created_at ?? null);

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

  if (monthsWithData.length >= 2) {
    const sum = monthsWithData.reduce((s, m) => s + variableByPastMonth[m.key], 0);
    variable_envelope_initial = sum / monthsWithData.length;
    variable_envelope_source = 'history';
    variable_envelope_months_used = monthsWithData.length;
  } else {
    // Sans historique variable suffisant : question 4 du questionnaire (champ q9, hebdo → mensuel)
    const weekly =
      Number(profile?.weekly_variable_budget ?? 0) ||
      weeklyVariableFromQ9(String(data.questionnaireAnswers?.q9 ?? ''));
    if (weekly > 0) {
      variable_envelope_initial = weekly * WEEKS_PER_MONTH;
      variable_envelope_source = 'onboarding';
    }
  }

  const variable_envelope_remaining = Math.max(0, variable_envelope_initial - variable_envelope_spent);

  // ── Référence de variable UNIFIÉE (Pilotage ET Reporting) ────────────────────────────────────
  // C'est L'ENVELOPPE elle-même : le questionnaire tant qu'on n'a pas 2 mois de données réelles,
  // puis la moyenne réelle sur jusqu'à 6 mois d'historique (plus l'historique grandit, plus la
  // fenêtre s'élargit). Le Reporting compare donc à la MÊME référence que le curseur « dont variables »
  // du Pilotage — plus d'écart « 600 € ici / 5 000 € là ».
  const avg_variable_expenses_3m = variable_envelope_initial;
  const variable_trend_percentage = avg_variable_expenses_3m > 0
    ? (current_month_variable / avg_variable_expenses_3m) * 100
    : 0;

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
  let lastVerifiedAt: string | null = null;
  for (const t of transactions) {
    if (isRegul(t)) {
      const d = String((t as any).date ?? '').slice(0, 10);
      if (d && (!lastVerifiedAt || d > lastVerifiedAt)) lastVerifiedAt = d;
    }
  }
  // La création d'un compte courant est une « vérification n° 0 » : le solde initial est recopié
  // depuis la banque, l'écart est nul ce jour-là (init_date si constaté à une autre date).
  for (const a of accounts) {
    if (a.type !== 'checking') continue;
    const d = String((a as any).init_date ?? (a as any).created_at ?? '').slice(0, 10);
    if (d && d <= todayStr && (!lastVerifiedAt || d > lastVerifiedAt)) lastVerifiedAt = d;
  }
  const reliability_calib = ((profile as any)?.reliability_calib ?? null) as DriftCalibration | null;
  const confidence_floor_base = Math.max(avgMonthlyIncome, variable_envelope_initial, 0);
  // lastActivityAt = dernière SAISIE MANUELLE d'une transaction du mois courant (date de saisie
  // `created_at`, pas la date de la transaction). Signal de SUIVI ACTIF qui amortit le doute
  // (confidenceEngine.activityDampening) : un user qui saisit le 20 est plutôt à jour, même si sa
  // dernière régul date. Exclus : réguls (déjà des vérifs), occurrences matérialisées de
  // récurrentes (automatiques, pas une action du user), modèles récurrents et brouillons.
  const currentMonthPrefix = todayStr.slice(0, 7);
  let lastActivityAt: string | null = null;
  for (const t of transactions as any[]) {
    if (t.is_draft || t.materialized_from || (t.is_recurring && t.recurrence_rule)) continue;
    if (isRegul(t)) continue;
    if (String(t.date ?? '').slice(0, 7) !== currentMonthPrefix) continue;
    const created = String(t.created_at ?? '').slice(0, 10);
    if (created && created <= todayStr && (!lastActivityAt || created > lastActivityAt)) lastActivityAt = created;
  }

  // ── Soldes projetés 6 mois (trajectoire de l'écran Projection, virements épargne/invest inclus)
  // pour le garde-fou marge des recommandations. Overrides SIGNÉS tous mois, format `${id}:${y}:${m}`.
  const signedOvrAllMonths: Record<string, number> = {};
  for (const o of (data as any).monthOverrides ?? []) {
    if (o.override_amount != null) signedOvrAllMonths[`${o.transaction_id}:${o.year}:${o.month}`] = Number(o.override_amount);
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
    variable_envelope_initial,
    variable_envelope_spent,
    variable_envelope_remaining,
    variable_envelope_source,
    variable_envelope_months_used,
    projected_surplus,
    recommendation,
    safety_margin_percent,
    safety_margin_amount,
    financial_profile: profile?.financial_profile ?? undefined,
    allocation_save_percent: profile?.allocation_save_percent ?? undefined,
    allocation_invest_percent: profile?.allocation_invest_percent ?? undefined,
    allocation_enjoy_percent: profile?.allocation_enjoy_percent ?? undefined,
    allocation_keep_percent: profile?.allocation_keep_percent ?? undefined,
    initial_onboarding_completed: profile?.initial_onboarding_completed ?? false,
    available_savings,
    projects_with_progress,
    global_projects_percentage,
    total_checking,
    total_savings,
    total_invested,
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
    confidence_inputs: {
      lastVerifiedAt, lastActivityAt, calibration: reliability_calib,
      floorBase: confidence_floor_base,
      // Base du COLD START : seules les dépenses variables peuvent vraiment être « perdues de vue ».
      variableBase: variable_envelope_initial,
    },
    projection_balances_6m,
    projection_balances_12m,
    projection_income_12m,
  };
}

const PILOTAGE_STALE_MS = 45 * 1000;

/** Clé + fetcher partagés entre le hook et le préchargement (une seule source de vérité). */
const pilotageQueryOptions = (profileId: string) => ({
  queryKey: ['pilotage_data', profileId],
  queryFn: async () => computePilotageData(await fetchPilotageData(profileId)),
  staleTime: PILOTAGE_STALE_MS,
});

/**
 * Précharge les données de Pilotage AU PLUS TÔT (dès que l'utilisateur est connu), en parallèle du
 * profil — au lieu d'attendre la redirection vers l'écran d'accueil. Écrit dans la MÊME clé de cache
 * que `usePilotageData` → quand Pilotage monte, les données sont déjà là (ou en vol), pas de 2ᵉ
 * aller-retour en cascade. Sans effet si déjà frais. Les erreurs sont avalées (le hook réessaiera).
 */
export function prefetchPilotageData(qc: QueryClient, profileId: string | undefined): void {
  if (!supabase || !profileId) return;
  qc.prefetchQuery(pilotageQueryOptions(profileId)).catch(() => {});
}

export function usePilotageData(profileId: string | undefined) {
  return useQuery({
    ...pilotageQueryOptions(profileId ?? ''),
    enabled: !!profileId,
    // PERF : ce fetch est LOURD (toutes les transactions + jointures + partagés + crédits).
    // 45 s de fraîcheur → changer d'onglet ne re-télécharge pas tout ; les MUTATIONS (ajout/édition
    // de transaction, virement, régul…) invalident déjà cette clé → les données restent justes.
    // Hors-ligne : la requête se met en PAUSE (onlineManager/NetInfo) et REPREND à la reconnexion.
  });
}
