/**
 * reportingEngine — calculs PURS de la page Reporting, alignés sur le moteur Pilotage.
 *
 * Entrées attendues (préparées par l'écran) :
 *  • `fluxTx`  : transactions de la VUE FLUX (périmètre appliqué via lib/perimeter →
 *                transformFluxTransactions). Devise de référence. Les virements internes gardent
 *                `linked_account_id` ; les franchissements de frontière joint sont déjà synthétisés.
 *  • `allTx` / `accounts` : données PATRIMOINE complètes (part du user des joints incluse au %).
 *
 * Règles clés (cohérentes avec le reste de l'app) :
 *  • Revenus/dépenses : on EXCLUT les régularisations de solde (isRegul), les virements internes
 *    (linked_account_id) et les brouillons. Un + = revenu, un − = dépense.
 *  • Épargne du mois = argent ARRIVÉ sur un compte épargne/investissement (jambe entrante d'un
 *    virement interne), pas le simple surplus de cash.
 *  • Patrimoine : reconstruit à rebours du solde actuel en excluant brouillons ET transactions
 *    datées dans le FUTUR (sinon les points passés sont faussés).
 */
import { isRegul } from './regul';
import { isInvestmentDeposit } from './investment';
import { CURRENCY_SYMBOL } from './currency';
import { recurringAmountForMonth } from './recurrenceMonth';

export type ReportingPeriod = 3 | 6 | 12;

export interface MonthBucket { year: number; month: number; ym: string; label: string }

export interface ReportTx {
  id?: string;
  date: string;
  amount: number;
  account_id: string;
  linked_account_id?: string | null;
  is_draft?: boolean;
  category_id?: string | null;
  regul_target?: number | null;
  note?: string | null;
  category?: { name?: string } | null;
  /** Modèle récurrent (son ancre est toujours dans le FUTUR après matérialisation). */
  is_recurring?: boolean | null;
  recurrence_rule?: string | null;
  recurrence_end_date?: string | null;
  /** Occurrence déjà matérialisée d'un modèle récurrent (= ligne réelle, pas une projection). */
  materialized_from?: string | null;
  /**
   * Compte d'investissement : NATURE de l'opération (migration 196) — 'deposit' = versement de
   * capital, 'gain'/'loss' = plus/moins-value. C'est ce marqueur qui distingue « j'ai mis 5 000 € »
   * de « mon placement a pris 5 000 € » quand la saisie est DIRECTE (pas un virement).
   */
  investment_kind?: string | null;
  /** Échéance de crédit à venir (flux virtuel, cf. hooks/useCreditFlows) — jamais une dépense variable. */
  is_credit_flow?: boolean | null;
}

export interface MonthlyFlux {
  ym: string;
  label: string;
  income: number;
  expense: number;
  net: number;
  rate: number;
  /** Mois À VENIR : les montants sont une PRÉVISION, pas un relevé. */
  forecast?: boolean;
  /** Part « dépenses variables estimées » incluse dans `expense` (mois prévus uniquement). */
  variableEstimate?: number;
}

/** Type d'une catégorie : 'income' (recette) / 'expense' / null (sans catégorie → côté dépense). */
export type CategoryTypeResolver = (categoryId: string | null | undefined) => 'income' | 'expense' | null;

/** Fenêtre des N derniers mois, bornée à `dataStartYM` (1ʳᵉ donnée) inclus. */
export function monthsWindow(maxN: number, dataStartYM: string | null, now = new Date()): MonthBucket[] {
  const out: MonthBucket[] = [];
  for (let i = maxN - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (dataStartYM && ym < dataStartYM) continue;
    out.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      ym,
      label: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
    });
  }
  return out;
}

/** Fenêtre des N mois À VENIR (le mois courant est exclu : il appartient à l'historique). */
export function futureMonthsWindow(n: number, now = new Date()): MonthBucket[] {
  const out: MonthBucket[] = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
    });
  }
  return out;
}

/** Modèle récurrent VIVANT (à projeter), par opposition à une occurrence déjà matérialisée. */
export function isRecurringTemplate(t: ReportTx): boolean {
  return !!t.is_recurring && !!t.recurrence_rule;
}

/** Une transaction compte-t-elle comme revenu/dépense « réel » ? (hors régul / virement interne / brouillon) */
export function isRealFlux(t: ReportTx): boolean {
  if (t.is_draft) return false;
  if (t.linked_account_id) return false; // virement interne (neutre)
  /* La RÉGULARISATION compte, désormais rangée dans sa sous-catégorie (migration 175) : c'est de
     l'argent réellement parti ou arrivé. L'écarter ici revenait à créer une catégorie qui
     n'apparaît dans aucun graphe — et à faire mentir le total des dépenses du mois.
     ⚠️ Elle reste exclue du REVENU DE RÉFÉRENCE (lib/incomeAverage) : une correction de solde à la
     hausse n'est pas un salaire, et la compter fausserait le matelas de sécurité et le profil. */
  return true;
}

/**
 * Revenus / dépenses / net / taux par mois.
 * REVENUS = uniquement les vraies RECETTES (catégorie de type « income ») — pas un montant positif
 * quelconque (remboursement, régul déjà exclue, non catégorisé…). DÉPENSES = montants négatifs
 * (hors recettes), nets des remboursements — mais SEULEMENT ceux portés par une catégorie de
 * DÉPENSE : un positif sans catégorie (entrée inclassée, « reçu du compte partagé »…) ne doit ni
 * compter en revenu ni effacer les dépenses du mois.
 */
export function buildMonthlyFlux(
  fluxTx: ReportTx[],
  months: MonthBucket[],
  categoryType: CategoryTypeResolver,
  opts?: {
    /**
     * N'AGRÉGER QUE LES `upToDay` PREMIERS JOURS de chaque mois — pour comparer deux mois « à la
     * même date ». Sans ça, le mois EN COURS (qui n'a que ses premiers jours) était comparé à un
     * mois précédent COMPLET : le 4 du mois, l'app annonçait « tes dépenses sont 78 % plus basses
     * que le mois dernier 📉 » et félicitait l'utilisateur pour un mois qui n'avait pas commencé.
     */
    upToDay?: number;
  },
): MonthlyFlux[] {
  const upToDay = opts?.upToDay;
  const acc: Record<string, { income: number; expense: number }> = {};
  months.forEach((m) => { acc[m.ym] = { income: 0, expense: 0 }; });
  for (const t of fluxTx) {
    if (!isRealFlux(t)) continue;
    const date = t.date ?? '';
    const ym = date.substring(0, 7);
    if (!acc[ym]) continue;
    // Date illisible → `Number('')` vaut 0, donc la ligne est CONSERVÉE : on ne masque jamais une
    // opération sur un défaut de format.
    if (upToDay != null && Number(date.substring(8, 10)) > upToDay) continue;
    const amt = Number(t.amount);
    const ty = categoryType(t.category_id);
    if (ty === 'income') {
      if (amt > 0) acc[ym].income += amt; // recette
    } else if (amt < 0) {
      acc[ym].expense += -amt; // dépense (catégorie de dépense ou sans catégorie)
    } else if (ty === 'expense') {
      acc[ym].expense -= amt; // remboursement sur une catégorie de dépense
    }
    // positif sans catégorie → ignoré (ni revenu ni « anti-dépense »)
  }
  return months.map((m) => {
    const income = acc[m.ym].income;
    const expense = Math.max(0, acc[m.ym].expense);
    const net = income - expense;
    const rate = income > 0 ? (net / income) * 100 : 0;
    return { ym: m.ym, label: m.label, income, expense, net, rate };
  });
}

/* ══════════════ MOIS À VENIR (prévision) ══════════════════════════════════════════════════════ */

/**
 * Occurrences PROJETÉES des modèles récurrents sur des mois à venir, sous forme de transactions
 * synthétiques directement consommables par `buildMonthlyFlux` : la prévision passe donc par
 * EXACTEMENT les mêmes règles que l'historique (recette = catégorie « income », dépense = négatif
 * hors régul/virement…). Sans ça, les barres passées et futures auraient chacune leur définition.
 *
 * ⚠️ N'inclut QUE les récurrentes : les ponctuels déjà saisis sur un mois futur sont de vraies
 * lignes, à passer tels quels à `buildMonthlyFlux` (cf. buildForecastFlux).
 */
export function projectRecurringFlux(
  fluxTx: ReportTx[],
  months: MonthBucket[],
  overridesMap: Record<string, number> = {},
): ReportTx[] {
  const out: ReportTx[] = [];
  for (const t of fluxTx) {
    if (!isRecurringTemplate(t) || t.is_draft) continue;
    if (t.linked_account_id) continue; // virement interne : neutre pour le budget, comme dans le passé
    for (const m of months) {
      const amount = recurringAmountForMonth(
        { id: t.id ?? '', date: t.date, amount: Number(t.amount), recurrence_rule: t.recurrence_rule, recurrence_end_date: t.recurrence_end_date },
        m.year, m.month, overridesMap,
      );
      if (!amount) continue;
      // Date = 1er du mois projeté : seul le MOIS compte pour le regroupement.
      out.push({ ...t, id: undefined, date: `${m.ym}-01`, amount, is_recurring: false, recurrence_rule: null });
    }
  }
  return out;
}

/**
 * Part de chaque compte dans les dépenses VARIABLES (non récurrentes) observées sur `months`.
 * Sert à répartir l'enveloppe variable estimée quand l'utilisateur filtre sur UN compte courant :
 * lui attribuer l'enveloppe entière gonflerait ses dépenses prévues de tout ce qu'il dépense
 * ailleurs. Comptes sans historique → part 0 (on n'invente rien).
 */
export function variableShareByAccount(fluxTx: ReportTx[], months: MonthBucket[]): Record<string, number> {
  const ymSet = new Set(months.map((m) => m.ym));
  const byAccount: Record<string, number> = {};
  let total = 0;
  for (const t of fluxTx) {
    if (!isRealFlux(t) || isRecurringTemplate(t) || t.materialized_from) continue;
    /* Ni les RÉGULARISATIONS (une correction de solde n'est pas une course), ni les ÉCHÉANCES DE
       CRÉDIT (c'est l'inverse d'une dépense variable) ne définissent l'enveloppe du quotidien. Les
       compter ici attribuait à un compte une part de dépenses variables qu'il ne porte pas. */
    if (isRegul(t) || t.is_credit_flow) continue;
    if (!ymSet.has((t.date ?? '').substring(0, 7))) continue;
    const amt = Number(t.amount);
    if (amt >= 0) continue; // dépenses seulement
    byAccount[t.account_id] = (byAccount[t.account_id] ?? 0) + -amt;
    total += -amt;
  }
  if (total <= 0) return {};
  const share: Record<string, number> = {};
  for (const [id, v] of Object.entries(byAccount)) share[id] = v / total;
  return share;
}

/**
 * Revenus / dépenses PRÉVUS des mois à venir : récurrentes projetées + ponctuels déjà saisis, plus
 * l'enveloppe de dépenses variables estimée.
 *
 * Pourquoi ajouter l'enveloppe variable : les mois passés contiennent TOUT ce qui a réellement été
 * dépensé, courses et imprévus compris. Un mois futur ne contient que les charges connues — sans
 * l'estimation, ses barres seraient mécaniquement deux fois plus courtes et donneraient à lire une
 * chute des dépenses qui n'existe pas. La part estimée est renvoyée à part (`variableEstimate`)
 * pour que l'écran puisse le dire.
 */
export function buildForecastFlux(input: {
  fluxTx: ReportTx[];
  months: MonthBucket[];
  categoryType: CategoryTypeResolver;
  overridesMap?: Record<string, number>;
  /** Enveloppe variable mensuelle estimée (déjà proratisée si un seul compte est affiché). */
  variableMonthly?: number;
}): MonthlyFlux[] {
  const { fluxTx, months, categoryType, overridesMap = {}, variableMonthly = 0 } = input;
  if (months.length === 0) return [];
  // Ponctuels déjà saisis sur ces mois (vraies lignes) + occurrences projetées des récurrentes.
  const oneOff = fluxTx.filter((t) => !isRecurringTemplate(t));
  const projected = projectRecurringFlux(fluxTx, months, overridesMap);
  const rows = buildMonthlyFlux([...oneOff, ...projected], months, categoryType);
  const variable = Math.max(0, variableMonthly);
  return rows.map((r) => {
    const expense = r.expense + variable;
    const net = r.income - expense;
    return {
      ...r,
      expense,
      net,
      rate: r.income > 0 ? (net / r.income) * 100 : 0,
      forecast: true,
      variableEstimate: variable,
    };
  });
}

/**
 * Épargne réellement mise de côté par mois = argent ARRIVÉ sur un compte épargne/investissement.
 * `typeById` : id compte → type.
 *
 * Deux façons d'alimenter ces comptes, et il faut les DEUX :
 *  • la jambe entrante d'un VIREMENT interne (courant → épargne, épargne → invest…) ;
 *  • sur un compte d'INVESTISSEMENT, la saisie DIRECTE d'un versement — le bouton « Apport » du
 *    détail de compte crée une ligne sans compte lié, marquée `investment_kind = 'deposit'`
 *    (migration 196). Ne compter que les virements revenait à ignorer ces apports : « Mis de côté »
 *    et le taux d'épargne les perdaient, et surtout « Gain hors apports » les recomptait en
 *    PERFORMANCE — l'app annonçait un gain de 5 000 € à qui venait simplement de verser 5 000 €.
 *
 * `opts.todayISO` : ne compter que ce qui est DÉJÀ arrivé. C'est la même règle que la valeur du
 * portefeuille (`buildBalanceSeries`) et que l'apport de `lib/contributed` — sans elle, un virement
 * programmé pour le 28 gonflait les apports d'un mois où l'argent n'a pas encore bougé, et « Gain
 * hors apports » devenait faux du même montant.
 */
export function buildSavingsSeries(
  allTx: ReportTx[],
  months: MonthBucket[],
  typeById: Record<string, string>,
  opts?: { todayISO?: string },
): { ym: string; label: string; saved: number; savings: number; invest: number }[] {
  const today = opts?.todayISO;
  const acc: Record<string, { savings: number; invest: number }> = {};
  months.forEach((m) => { acc[m.ym] = { savings: 0, invest: 0 }; });
  for (const t of allTx) {
    if (t.is_draft) continue;
    if (today && (t.date ?? '') > today) continue; // pas encore arrivé
    const amt = Number(t.amount);
    if (amt <= 0) continue; // argent qui ARRIVE
    const destType = typeById[t.account_id];
    if (destType !== 'savings' && destType !== 'investment') continue;
    if (t.linked_account_id) {
      // Compte SEULEMENT si l'argent vient d'un compte d'un AUTRE type (courant→épargne, épargne→invest…).
      // Un virement entre deux comptes de MÊME type (épargne↔épargne, invest↔invest) = simple réorganisation,
      // pas une mise de côté.
      const srcType = typeById[t.linked_account_id];
      if (srcType === destType) continue;
    } else if (!(destType === 'investment' && isInvestmentDeposit(t))) {
      // Saisie directe : seul un APPORT marqué compte. Une plus-value, un intérêt versé ou une
      // entrée inclassée font monter la VALEUR du compte — ce n'est pas de l'argent mis de côté.
      continue;
    }
    const ym = (t.date ?? '').substring(0, 7);
    if (!acc[ym]) continue;
    if (destType === 'savings') acc[ym].savings += amt;
    else acc[ym].invest += amt;
  }
  return months.map((m) => {
    const { savings, invest } = acc[m.ym];
    return { ym: m.ym, label: m.label, savings, invest, saved: savings + invest };
  });
}

/** Répartition des DÉPENSES d'un mois par grande catégorie : top N + « Autres ». */
export function buildCategoryBreakdown(
  fluxTx: ReportTx[],
  ym: string,
  grandCategoryName: (categoryId: string | null | undefined) => string,
  categoryType: CategoryTypeResolver,
  topN = 7,
): { label: string; amount: number }[] {
  const by: Record<string, number> = {};
  for (const t of fluxTx) {
    if (!isRealFlux(t)) continue;
    if (categoryType(t.category_id) === 'income') continue; // pas les recettes
    if (Number(t.amount) >= 0) continue; // dépenses uniquement
    if ((t.date ?? '').substring(0, 7) !== ym) continue;
    const name = grandCategoryName(t.category_id);
    by[name] = (by[name] ?? 0) + Math.abs(Number(t.amount));
  }
  const sorted = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([label, amount]) => ({ label, amount }));
  if (sorted.length <= topN) return sorted;
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN).reduce((s, r) => s + r.amount, 0);
  if (rest > 0) top.push({ label: 'Autres', amount: rest });
  return top;
}

/**
 * Top postes de dépense (grande catégorie) : mois `curYm` vs `prevYm`.
 *
 * `upToDay` arrête LES DEUX mois au même jour tant que le mois en cours n'est pas terminé. Sans
 * cette borne, chaque poste s'affichait « ▼ ‑X € vs mois préc. » du 1ᵉʳ au 25 du mois : une baisse
 * qui ne disait rien d'autre que « le mois n'est pas fini ».
 */
export function buildTopCategoriesCompare(
  fluxTx: ReportTx[],
  curYm: string,
  prevYm: string,
  grandCategoryName: (categoryId: string | null | undefined) => string,
  categoryType: CategoryTypeResolver,
  topN = 5,
  upToDay?: number,
): { label: string; current: number; previous: number }[] {
  const cur: Record<string, number> = {};
  const old: Record<string, number> = {};
  for (const t of fluxTx) {
    if (!isRealFlux(t)) continue;
    if (categoryType(t.category_id) === 'income') continue;
    if (Number(t.amount) >= 0) continue;
    const date = t.date ?? '';
    const ym = date.substring(0, 7);
    if (ym !== curYm && ym !== prevYm) continue;
    if (upToDay != null && Number(date.substring(8, 10)) > upToDay) continue;
    const name = grandCategoryName(t.category_id);
    const amt = Math.abs(Number(t.amount));
    if (ym === curYm) cur[name] = (cur[name] ?? 0) + amt;
    else old[name] = (old[name] ?? 0) + amt;
  }
  return Object.entries(cur)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([label, current]) => ({ label, current, previous: old[label] ?? 0 }));
}

/**
 * Séries de patrimoine (soldes fin de mois) par ensemble de comptes, reconstruites à rebours du
 * solde actuel. Exclut brouillons et transactions FUTURES (date > today) pour ne pas fausser le passé.
 */
export function buildBalanceSeries(
  ids: Set<string>,
  accounts: { id: string; balance: number }[],
  allTx: ReportTx[],
  months: MonthBucket[],
  todayISO: string,
): { ym: string; label: string; value: number }[] {
  const startNow = accounts.filter((a) => ids.has(a.id)).reduce((s, a) => s + Number(a.balance), 0);
  const deltas: Record<string, number> = {};
  for (const t of allTx) {
    if (t.is_draft || !ids.has(t.account_id)) continue;
    if ((t.date ?? '') > todayISO) continue; // ignore le futur (récurrences non encore réalisées)
    const ym = (t.date ?? '').substring(0, 7);
    deltas[ym] = (deltas[ym] ?? 0) + Number(t.amount);
  }
  const points: { ym: string; label: string; value: number }[] = [];
  let running = startNow;
  for (let i = months.length - 1; i >= 0; i--) {
    points.unshift({ ym: months[i].ym, label: months[i].label, value: running });
    running -= deltas[months[i].ym] ?? 0;
  }
  return points;
}

// ── Bilan intelligent ────────────────────────────────────────────────────────

export type InsightTone = 'alert' | 'win' | 'tip';
export interface Insight { tone: InsightTone; icon: string; text: string; priority: number }

/**
 * Comparaison des dépenses avec le mois précédent, À LA MÊME DATE tant que le mois en cours n'est
 * pas terminé. Obligatoire : c'est la seule façon d'empêcher qu'un mois de 4 jours soit comparé à
 * un mois de 31 (cf. `buildMonthlyFlux`, option `upToDay`).
 */
export interface ExpenseCompare {
  /** Dépenses du mois en cours sur la période comparée. */
  current: number;
  /** Dépenses du mois précédent sur la MÊME période. */
  previous: number;
  /** true = comparaison arrêtée au jour du mois (mois en cours non terminé) → à le DIRE. */
  toDate: boolean;
  /** Jour du mois auquel la comparaison s'arrête (utile seulement si `toDate`). */
  day: number;
}

export interface InsightInputs {
  monthlyFlux: MonthlyFlux[];
  savingsSeries: { saved: number }[];
  netWorthTotal: { value: number; label?: string }[];
  categoryBreakdown: { label: string; amount: number }[];
  monthIncome: number;
  monthSaved: number;
  /** Dépenses M vs M-1 à périmètre de temps COMPARABLE. `null` = pas de mois précédent connu. */
  expenseCompare: ExpenseCompare | null;
  /**
   * RYTHME de dépenses variables : 100 = pile le budget variable habituel, au rythme actuel.
   * `null` = trop tôt dans le mois pour conclure (cf. lib/spendingPace) → aucun constat.
   * ⚠️ Ne PAS y brancher un taux de remplissage (dépensé ÷ enveloppe) : il vaut mécaniquement 5 %
   * le 3 du mois, ce qui faisait féliciter l'utilisateur (« 95 % sous ton budget ») avant même
   * qu'il ait eu le temps de dépenser.
   */
  variablePacePct: number | null;
  hasVariableBaseline: boolean;
}

/**
 * Génère les constats du bilan, triés par ordre d'affichage : alertes (priorité haute) → réussites →
 * opportunités. `priority` plus BAS = plus important. Cap conseillé côté écran (ex. 5).
 */
export function buildInsights(inp: InsightInputs): Insight[] {
  const out: Insight[] = [];
  const flux = inp.monthlyFlux;
  const last = flux[flux.length - 1];
  const cmp = inp.expenseCompare;
  /** Écart de dépenses en %, sur une période comparable. `null` si M-1 est à 0 (division impossible). */
  const cmpDelta = cmp && cmp.previous > 0
    ? Math.round(((cmp.current - cmp.previous) / cmp.previous) * 100)
    : null;
  /** « au 12 du mois » — à accoler à tout constat bâti sur un mois en cours. */
  const cmpWhen = cmp?.toDate ? ` (au ${cmp.day} du mois, des deux côtés)` : '';

  // — ALERTES —
  // (Le Reporting ne parle PAS de vérification de solde : c'est un bilan d'analyse, la fiabilité se
  // gère sur le Pilotage. Aucun message « ces chiffres sont des estimations » ici.)
  // Dépenses variables au-dessus des habitudes.
  if (inp.hasVariableBaseline && inp.variablePacePct != null) {
    const delta = Math.round(inp.variablePacePct - 100);
    if (delta >= 12) out.push({ tone: 'alert', icon: 'trending-up', priority: 10,
      text: `À ce rythme, tes dépenses variables finiront ${delta} % au-dessus de ton budget variable habituel — surveille les sorties non prévues.` });
  }
  // Mois déficitaire (dépenses > revenus).
  // PRÉSENT, pas passé composé : le mois en cours n'est pas terminé quand ce constat s'affiche.
  if (last && last.income > 0 && last.net < 0) {
    out.push({ tone: 'alert', icon: 'warning', priority: 12,
      text: `Ce mois-ci, tes dépenses dépassent tes revenus de ${Math.abs(Math.round((last.net / last.income) * 100))} % (déficit de ${fmtEur(-last.net)}).` });
  }
  // Concentration des dépenses sur une catégorie.
  const totalCat = inp.categoryBreakdown.reduce((s, c) => s + c.amount, 0);
  const top = inp.categoryBreakdown[0];
  if (top && totalCat > 0) {
    const share = Math.round((top.amount / totalCat) * 100);
    if (share >= 40 && top.label !== 'Autres') out.push({ tone: 'alert', icon: 'pie-chart', priority: 14,
      text: `${share} % de tes dépenses du mois passent dans « ${top.label} » (${fmtEur(top.amount)}). Un poste à surveiller.` });
  }
  // Dépenses en forte hausse vs mois dernier — à période COMPARABLE (cf. ExpenseCompare).
  if (cmp && cmpDelta != null && cmpDelta >= 15) {
    out.push({ tone: 'alert', icon: 'swap-vertical', priority: 16,
      text: `Tes dépenses (${fmtEur(cmp.current)}) dépassent de ${cmpDelta} % celles du mois dernier${cmpWhen}.` });
  }

  // — RÉUSSITES —
  if (inp.monthIncome > 0 && inp.monthSaved > 0) {
    const rate = Math.round((inp.monthSaved / inp.monthIncome) * 100);
    if (rate >= 10) out.push({ tone: 'win', icon: 'shield-checkmark', priority: 20,
      text: `Tu mets de côté ${rate} % de tes revenus ce mois-ci (${fmtEur(inp.monthSaved)}). ${rate >= 20 ? 'Rythme excellent 🎯' : 'Beau rythme.'}` });
  }
  /* Croissance du TOTAL DES COMPTES. Volontairement pas « patrimoine » : ce total ne couvre que
     l'argent des comptes — ni les biens possédés, ni le capital restant dû des crédits. C'est le
     même choix de mot que la page Comptes (« Vue d'ensemble »), pour que les deux écrans ne
     promettent pas deux choses différentes. Le repère de départ est DATÉ (« depuis fin mars »)
     plutôt qu'annoncé « sur les 6 derniers mois » : entre le 1ᵉʳ et le 6ᵉ point, il s'est écoulé
     5 mois, pas 6. */
  const nw = inp.netWorthTotal;
  if (nw.length >= 2) {
    const growth = nw[nw.length - 1].value - nw[0].value;
    const since = nw[0].label ? ` depuis fin ${nw[0].label}` : '';
    if (growth > 0 && nw[0].value !== 0) {
      const pct = Math.round((growth / Math.abs(nw[0].value)) * 100);
      out.push({ tone: 'win', icon: 'trending-up', priority: 22,
        text: `Le total de tes comptes a progressé de ${fmtEur(growth)}${pct > 0 ? ` (+${pct} %)` : ''}${since}. 📈` });
    }
  }
  // Dépenses variables sous contrôle.
  if (inp.hasVariableBaseline && inp.variablePacePct != null) {
    const delta = Math.round(inp.variablePacePct - 100);
    if (delta <= -12) out.push({ tone: 'win', icon: 'trending-down', priority: 24,
      text: `À ce rythme, tes dépenses variables finiront ${Math.abs(delta)} % sous ton budget variable habituel. Beau contrôle 👌` });
  }
  // Dépenses en baisse vs mois dernier — à période COMPARABLE (cf. ExpenseCompare).
  if (cmp && cmpDelta != null && cmpDelta <= -12) {
    out.push({ tone: 'win', icon: 'trending-down', priority: 26,
      text: `Tes dépenses (${fmtEur(cmp.current)}) sont ${Math.abs(cmpDelta)} % plus basses que le mois dernier${cmpWhen}. 📉` });
  }

  // — OPPORTUNITÉS —
  if (inp.monthIncome > 0 && inp.monthSaved > 0) {
    const rate = (inp.monthSaved / inp.monthIncome) * 100;
    if (rate > 0 && rate < 10) out.push({ tone: 'tip', icon: 'bulb', priority: 30,
      text: `Tu épargnes ${Math.round(rate)} % de tes revenus. Un petit virement récurrent de plus et tu passes un cap.` });
  }
  if (inp.monthIncome > 0 && inp.monthSaved === 0) {
    out.push({ tone: 'tip', icon: 'bulb', priority: 32,
      text: `Rien mis de côté ce mois-ci. Même ${fmtEur(20)}/mois automatisés, c'est un cap de franchi.` });
  }

  return out.sort((a, b) => a.priority - b.priority);
}

function fmtEur(n: number): string {
  // Devise de référence du profil (jamais un « € » en dur — cf. lib/finance/currency).
  return Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;
}
