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

export type ReportingPeriod = 3 | 6 | 12;

export interface MonthBucket { year: number; month: number; ym: string; label: string }

export interface ReportTx {
  date: string;
  amount: number;
  account_id: string;
  linked_account_id?: string | null;
  is_draft?: boolean;
  category_id?: string | null;
  regul_target?: number | null;
  note?: string | null;
  category?: { name?: string } | null;
}

export interface MonthlyFlux { ym: string; label: string; income: number; expense: number; net: number; rate: number }

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

/** Une transaction compte-t-elle comme revenu/dépense « réel » ? (hors régul / virement interne / brouillon) */
export function isRealFlux(t: ReportTx): boolean {
  if (t.is_draft) return false;
  if (t.linked_account_id) return false; // virement interne (neutre)
  if (isRegul(t)) return false;
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
export function buildMonthlyFlux(fluxTx: ReportTx[], months: MonthBucket[], categoryType: CategoryTypeResolver): MonthlyFlux[] {
  const acc: Record<string, { income: number; expense: number }> = {};
  months.forEach((m) => { acc[m.ym] = { income: 0, expense: 0 }; });
  for (const t of fluxTx) {
    if (!isRealFlux(t)) continue;
    const ym = (t.date ?? '').substring(0, 7);
    if (!acc[ym]) continue;
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

/**
 * Épargne réellement mise de côté par mois = argent ARRIVÉ sur un compte épargne/investissement
 * (jambe entrante d'un virement interne). `typeById` : id compte → type.
 */
export function buildSavingsSeries(
  allTx: ReportTx[],
  months: MonthBucket[],
  typeById: Record<string, string>,
): { ym: string; label: string; saved: number; savings: number; invest: number }[] {
  const acc: Record<string, { savings: number; invest: number }> = {};
  months.forEach((m) => { acc[m.ym] = { savings: 0, invest: 0 }; });
  for (const t of allTx) {
    if (t.is_draft || !t.linked_account_id) continue; // jambe d'un virement interne uniquement
    const amt = Number(t.amount);
    if (amt <= 0) continue; // jambe ENTRANTE (argent qui arrive)
    const destType = typeById[t.account_id];
    if (destType !== 'savings' && destType !== 'investment') continue;
    // Compte SEULEMENT si l'argent vient d'un compte d'un AUTRE type (courant→épargne, épargne→invest…).
    // Un virement entre deux comptes de MÊME type (épargne↔épargne, invest↔invest) = simple réorganisation,
    // pas une mise de côté.
    const srcType = typeById[t.linked_account_id];
    if (srcType === destType) continue;
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

/** Top postes de dépense (grande catégorie) : mois `curYm` vs `prevYm`. */
export function buildTopCategoriesCompare(
  fluxTx: ReportTx[],
  curYm: string,
  prevYm: string,
  grandCategoryName: (categoryId: string | null | undefined) => string,
  categoryType: CategoryTypeResolver,
  topN = 5,
): { label: string; current: number; previous: number }[] {
  const cur: Record<string, number> = {};
  const old: Record<string, number> = {};
  for (const t of fluxTx) {
    if (!isRealFlux(t)) continue;
    if (categoryType(t.category_id) === 'income') continue;
    if (Number(t.amount) >= 0) continue;
    const ym = (t.date ?? '').substring(0, 7);
    const name = grandCategoryName(t.category_id);
    const amt = Math.abs(Number(t.amount));
    if (ym === curYm) cur[name] = (cur[name] ?? 0) + amt;
    else if (ym === prevYm) old[name] = (old[name] ?? 0) + amt;
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

export interface InsightInputs {
  monthlyFlux: MonthlyFlux[];
  savingsSeries: { saved: number }[];
  netWorthTotal: { value: number }[];
  categoryBreakdown: { label: string; amount: number }[];
  monthIncome: number;
  monthSaved: number;
  variableTrendPct: number | null; // 100 = pile la moyenne
  hasVariableBaseline: boolean;
  daysSinceVerification: number | null;
}

/**
 * Génère les constats du bilan, triés par ordre d'affichage : alertes (priorité haute) → réussites →
 * opportunités. `priority` plus BAS = plus important. Cap conseillé côté écran (ex. 5).
 */
export function buildInsights(inp: InsightInputs): Insight[] {
  const out: Insight[] = [];
  const flux = inp.monthlyFlux;
  const last = flux[flux.length - 1];
  const prev = flux[flux.length - 2];

  // — ALERTES —
  // Solde non vérifié (fiabilité).
  if (inp.daysSinceVerification != null && inp.daysSinceVerification > 10) {
    out.push({ tone: 'alert', icon: 'alert-circle', priority: 5,
      text: `Ton solde n'a pas été vérifié depuis un moment — ces chiffres sont des estimations. Une vérif de 30 s et tout redevient net.` });
  }
  // Dépenses variables au-dessus des habitudes.
  if (inp.hasVariableBaseline && inp.variableTrendPct != null) {
    const delta = Math.round(inp.variableTrendPct - 100);
    if (delta >= 12) out.push({ tone: 'alert', icon: 'trending-up', priority: 10,
      text: `Tes dépenses variables sont ${delta} % au-dessus de ta moyenne des 3 derniers mois — surveille les sorties non prévues.` });
  }
  // Mois déficitaire (dépenses > revenus).
  if (last && last.income > 0 && last.net < 0) {
    out.push({ tone: 'alert', icon: 'warning', priority: 12,
      text: `Ce mois-ci tu as dépensé ${Math.abs(Math.round((last.net / last.income) * 100))} % de plus que tes revenus (déficit de ${fmtEur(-last.net)}).` });
  }
  // Concentration des dépenses sur une catégorie.
  const totalCat = inp.categoryBreakdown.reduce((s, c) => s + c.amount, 0);
  const top = inp.categoryBreakdown[0];
  if (top && totalCat > 0) {
    const share = Math.round((top.amount / totalCat) * 100);
    if (share >= 40 && top.label !== 'Autres') out.push({ tone: 'alert', icon: 'pie-chart', priority: 14,
      text: `${share} % de tes dépenses du mois passent dans « ${top.label} » (${fmtEur(top.amount)}). Un poste à surveiller.` });
  }
  // Dépenses en forte hausse vs mois dernier.
  if (last && prev && prev.expense > 0) {
    const d = Math.round(((last.expense - prev.expense) / prev.expense) * 100);
    if (d >= 15) out.push({ tone: 'alert', icon: 'swap-vertical', priority: 16,
      text: `Tes dépenses (${fmtEur(last.expense)}) dépassent de ${d} % celles du mois dernier.` });
  }

  // — RÉUSSITES —
  if (inp.monthIncome > 0 && inp.monthSaved > 0) {
    const rate = Math.round((inp.monthSaved / inp.monthIncome) * 100);
    if (rate >= 10) out.push({ tone: 'win', icon: 'shield-checkmark', priority: 20,
      text: `Tu mets de côté ${rate} % de tes revenus ce mois-ci (${fmtEur(inp.monthSaved)}). ${rate >= 20 ? 'Rythme excellent 🎯' : 'Beau rythme.'}` });
  }
  // Croissance du patrimoine sur les N derniers mois (N concret, pas « la période »).
  const nw = inp.netWorthTotal;
  if (nw.length >= 2) {
    const growth = nw[nw.length - 1].value - nw[0].value;
    const span = nw.length; // nb de mois couverts
    if (growth > 0 && nw[0].value !== 0) {
      const pct = Math.round((growth / Math.abs(nw[0].value)) * 100);
      out.push({ tone: 'win', icon: 'trending-up', priority: 22,
        text: `Ton patrimoine a progressé de ${fmtEur(growth)}${pct > 0 ? ` (+${pct} %)` : ''} sur les ${span} derniers mois. 📈` });
    }
  }
  // Dépenses variables sous contrôle.
  if (inp.hasVariableBaseline && inp.variableTrendPct != null) {
    const delta = Math.round(inp.variableTrendPct - 100);
    if (delta <= -12) out.push({ tone: 'win', icon: 'trending-down', priority: 24,
      text: `Tes dépenses variables sont ${Math.abs(delta)} % sous ta moyenne des 3 derniers mois. Beau contrôle 👌` });
  }
  // Dépenses en baisse vs mois dernier.
  if (last && prev && prev.expense > 0) {
    const d = Math.round(((last.expense - prev.expense) / prev.expense) * 100);
    if (d <= -12) out.push({ tone: 'win', icon: 'trending-down', priority: 26,
      text: `Tes dépenses (${fmtEur(last.expense)}) sont ${Math.abs(d)} % plus basses que le mois dernier. 📉` });
  }

  // — OPPORTUNITÉS —
  if (inp.monthIncome > 0 && inp.monthSaved > 0) {
    const rate = (inp.monthSaved / inp.monthIncome) * 100;
    if (rate > 0 && rate < 10) out.push({ tone: 'tip', icon: 'bulb', priority: 30,
      text: `Tu épargnes ${Math.round(rate)} % de tes revenus. Un petit virement récurrent de plus et tu passes un cap.` });
  }
  if (inp.monthIncome > 0 && inp.monthSaved === 0) {
    out.push({ tone: 'tip', icon: 'bulb', priority: 32,
      text: `Aucun euro mis de côté ce mois-ci. Même 20 €/mois automatisés, c'est un cap de franchi.` });
  }

  return out.sort((a, b) => a.priority - b.priority);
}

function fmtEur(n: number): string {
  return Math.round(n).toLocaleString('fr-FR') + ' €';
}
