/**
 * MOTEUR DES BUDGETS — calcul PUR : budget effectif, dépensé, restant, rythme.
 *
 * RÈGLE FONDATRICE : le budget n'entre dans AUCUN calcul de trésorerie. Ce module ne produit que
 * de l'affichage. Il ne modifie rien, il ne s'exporte vers aucun moteur, et supprimer tous les
 * budgets d'un profil ne change aucun chiffre de l'app.
 *
 * Le « dépensé » vient de `lib/finance/variableSpend` — la MÊME définition que le Pilotage, pas une
 * copie. C'est ce qui garantit que le total des budgets et le « dépensé ce mois » du tableau de
 * bord ne peuvent pas diverger.
 *
 * ⚠️ Les transactions attendues sont celles de la VUE FLUX (périmètre appliqué,
 * `transformFluxTransactions`), en devise de référence. Passer les transactions brutes ferait
 * compter un compte partagé à 100 % au lieu du % d'impact — et les deux écrans divergeraient.
 *
 * Couverture : `__tests__/budgetEngine.test.ts`.
 */
import { isRegul } from './regul';
import { isMovementsCategory } from '../ui/defaultCategories';
import { variablePacePercentage } from './spendingPace';
import {
  sumVariableSpent,
  variableSpentByCategory,
  variableContribution,
  type AccountTypeMap,
} from './variableSpend';

export type BudgetPeriod = 'month' | 'year';

/** Une ligne de la table `budgets`. */
export interface BudgetRecord {
  id: string;
  period: BudgetPeriod;
  period_key: string;
  /** Toujours renseignée : il n'y a plus de budget global (cf. migration 218). */
  category_id: string;
  amount: number;
}

/** Catégorie, réduite à ce dont le moteur a besoin. */
export interface BudgetCategory {
  id: string;
  name: string;
  parent_id?: string | null;
  type?: string;
  /** Icône choisie par l'utilisateur — transportée telle quelle jusqu'à l'affichage. */
  icon?: string | null;
}

/** Budget effectif d'un périmètre à une période — propre ou hérité d'une période antérieure. */
export interface EffectiveBudget {
  amount: number;
  /** `true` quand la valeur vient d'une période antérieure (report implicite). */
  inherited: boolean;
  /** Période d'où vient réellement la valeur ('2026-08' quand on regarde septembre). */
  fromKey: string;
}

/** Une ligne affichée : une catégorie budgétée, avec ses sous-catégories budgétées. */
export interface BudgetLine {
  categoryId: string;
  name: string;
  /** Icône de la catégorie (peut être absente : l'affichage la déduit alors du nom). */
  icon?: string | null;
  /** `sub` quand la catégorie a un parent, `parent` sinon. */
  level: 'parent' | 'sub';
  period: BudgetPeriod;
  budget: number;
  inherited: boolean;
  fromKey: string;
  /** Dépensé de la catégorie ET de toutes ses descendantes (rollup). */
  spent: number;
  /** `budget - spent` — NÉGATIF en cas de dépassement, jamais écrêté. */
  remaining: number;
  /** `null` quand le budget vaut 0 : pas de pourcentage sans limite. */
  pct: number | null;
  children: BudgetLine[];
}

export interface ComputeBudgetsInput {
  /** Transactions de la vue FLUX, en devise de référence. */
  fluxTx: any[];
  accountTypeById: AccountTypeMap;
  categories: BudgetCategory[];
  budgets: BudgetRecord[];
  /** Mois affiché ('2026-09'). Le moteur en dérive aussi l'année pour les budgets annuels. */
  monthKey: string;
  /** Aujourd'hui (ISO). Borne le « dépensé » du mois en cours. */
  today: string;
}

export interface ComputeBudgetsResult {
  /**
   * TOTAL du mois — la somme des budgets mensuels posés, et le dépensé des catégories concernées.
   *
   * Ce n'est PAS un « budget global » : l'utilisateur n'en déclare aucun (cf. migration 218). C'est
   * la somme de ce qu'il a réellement décidé, en face du dépensé correspondant. `spentAll` donne le
   * dépensé variable du mois entier, budgété ou non, pour situer l'ensemble.
   */
  total: {
    budget: number;
    spent: number;
    remaining: number;
    pct: number | null;
    hasBudget: boolean;
    /** Dépensé variable du mois, toutes catégories — budgétées ou pas. */
    spentAll: number;
  };
  /** Catégories budgétées au MOIS, arborescentes (parentes portant leurs sous-catégories). */
  rows: BudgetLine[];
  /** Catégories budgétées à l'ANNÉE, à plat — fenêtre différente, jamais mêlée au mois. */
  annual: BudgetLine[];
  /** Dépensé du mois hors catégories budgétées. Information, jamais erreur. */
  outside: number;
  /** Dépenses variables du mois DÉJÀ SAISIES pour les jours à venir. */
  plannedRest: number;
  /** Rythme rapporté à l'avancement du mois, ou `null` s'il est trop tôt pour conclure. */
  pace: number | null;
  /** Part de régularisation de solde dans le dépensé du mois — isolée à l'affichage. */
  regulPart: number;
  /** Aucun budget d'aucune sorte : les écrans s'effacent au lieu d'afficher des zéros. */
  isEmpty: boolean;
}

/** '2026-09-18' → '2026-09'. */
export function monthKeyOf(iso: string): string {
  return String(iso).slice(0, 7);
}

/** '2026-09-18' ou '2026-09' → '2026'. */
export function yearKeyOf(iso: string): string {
  return String(iso).slice(0, 4);
}

/** Libellé court d'une période, pour les mentions « Repris de… ». */
const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];
export function periodLabel(period: BudgetPeriod, key: string): string {
  if (period === 'year') return key;
  const m = Number(key.slice(5, 7));
  const name = MONTH_NAMES[m - 1] ?? key;
  return `${name} ${key.slice(0, 4)}`;
}

/**
 * Budget effectif d'un périmètre à une période — c'est ICI que vit le REPORT IMPLICITE.
 *
 * On prend la ligne de la période demandée si elle existe, sinon la plus récente ligne ANTÉRIEURE
 * de même cadence et de même périmètre. Un budget posé en août vaut donc encore en décembre, sans
 * que l'utilisateur ait à le ressaisir — et sans qu'aucune ligne soit écrite dans son dos.
 *
 * Les clés se comparent en TEXTE : '2026-08' < '2026-09' et '2026' < '2027' sont vrais
 * lexicographiquement, tant que le format est bien celui que la contrainte SQL impose.
 */
export function effectiveBudget(
  budgets: BudgetRecord[],
  period: BudgetPeriod,
  periodKey: string,
  categoryId: string,
): EffectiveBudget | null {
  let best: BudgetRecord | null = null;
  for (const b of budgets) {
    if (b.period !== period) continue;
    if (b.category_id !== categoryId) continue;
    if (b.period_key > periodKey) continue;
    if (!best || b.period_key > best.period_key) best = b;
  }
  if (!best) return null;
  return {
    amount: Number(best.amount) || 0,
    inherited: best.period_key !== periodKey,
    fromKey: best.period_key,
  };
}

/** Pourcentage consommé, ou `null` quand il n'y a pas de limite à consommer. */
function pctOf(spent: number, budget: number): number | null {
  if (!(budget > 0)) return null;
  return (spent / budget) * 100;
}

/**
 * Ids de la catégorie « Mouvements » ET de ses sous-catégories — hors budget partout.
 *
 * On ne se fixe pas de limite sur un virement interne : l'argent change de poche sans quitter le
 * patrimoine. Ces lignes sont d'ailleurs déjà écartées du dépensé (`isBudgetExpense` refuse tout ce
 * qui porte un `linked_account_id`), donc un budget posé dessus afficherait un dépensé
 * éternellement à 0.
 */
function movementCategoryIds(categories: BudgetCategory[]): Set<string> {
  const roots = categories.filter((c) => !c.parent_id && isMovementsCategory(c.name)).map((c) => c.id);
  const out = new Set(roots);
  for (const c of categories) if (c.parent_id && out.has(c.parent_id)) out.add(c.id);
  return out;
}

/** Index parent → enfants, pour le rollup. */
function childrenIndex(categories: BudgetCategory[]): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const c of categories) {
    const p = c.parent_id ?? null;
    if (!p) continue;
    const list = idx.get(p);
    if (list) list.push(c.id);
    else idx.set(p, [c.id]);
  }
  return idx;
}

/**
 * Dépensé d'une catégorie ET de toutes ses descendantes.
 *
 * C'est la règle anti-double-comptage : une dépense de 40 € en Restaurants compte une fois dans
 * Restaurants, une fois dans Alimentation — deux LECTURES du même euro, jamais deux euros. Le
 * total global, lui, ne s'obtient pas en additionnant les catégories : il vient directement de
 * `sumVariableSpent`, donc les deux ne peuvent pas se contredire.
 */
function rolledSpent(
  categoryId: string,
  spentByCat: Map<string, number>,
  kids: Map<string, string[]>,
): number {
  let sum = spentByCat.get(categoryId) ?? 0;
  for (const child of kids.get(categoryId) ?? []) sum += rolledSpent(child, spentByCat, kids);
  return sum;
}

/** La catégorie a-t-elle un ancêtre lui aussi budgété ? (sert au calcul de `outside`) */
function hasBudgetedAncestor(
  category: BudgetCategory,
  byId: Map<string, BudgetCategory>,
  budgeted: Set<string>,
): boolean {
  let p = category.parent_id ?? null;
  const seen = new Set<string>();
  while (p && !seen.has(p)) {
    if (budgeted.has(p)) return true;
    seen.add(p);
    p = byId.get(p)?.parent_id ?? null;
  }
  return false;
}

export function computeBudgets(input: ComputeBudgetsInput): ComputeBudgetsResult {
  const { fluxTx, accountTypeById, categories, budgets, monthKey, today } = input;
  const yearKey = yearKeyOf(monthKey);

  const byId = new Map(categories.map((c) => [c.id, c]));
  const kids = childrenIndex(categories);
  /* « Mouvements » et ses enfants sont hors budget : ce sont des virements internes. Le filtre est
     posé ICI et pas seulement dans l'écran de saisie — un budget enregistré dessus avant cette
     règle continuerait sinon de s'afficher, éternellement à 0 (`isBudgetExpense` écarte tout ce qui
     porte un `linked_account_id`). */
  const excluded = movementCategoryIds(categories);

  // Le mois COURANT s'arrête à aujourd'hui ; un mois passé ou futur se lit en entier. Sans cette
  // distinction, un mois futur n'afficherait jamais ce qui y est déjà saisi.
  const isCurrentMonth = monthKeyOf(today) === monthKey;
  const monthWindow = { prefix: monthKey, upTo: isCurrentMonth ? today : undefined };

  const spentAll = sumVariableSpent(fluxTx, accountTypeById, monthWindow);
  const spentByCat = variableSpentByCategory(fluxTx, accountTypeById, monthWindow);
  const spentByCatYear = variableSpentByCategory(fluxTx, accountTypeById, {
    prefix: yearKey,
    upTo: isCurrentMonth || monthKey > monthKeyOf(today) ? today : undefined,
  });

  // ── Lignes de catégories ──────────────────────────────────────────────────
  // Un budget à 0 n'est PAS un budget : c'est la façon de le retirer (on ne supprime pas la ligne,
  // sinon le report ferait revenir celle du mois précédent). La catégorie disparaît donc de la vue,
  // exactement comme si elle n'avait jamais été budgétée.
  const monthBudgeted = new Set<string>();
  const yearBudgeted = new Set<string>();
  for (const b of budgets) {
    if (!b.category_id) continue;
    if (excluded.has(b.category_id)) continue;
    const key = b.period === 'year' ? yearKey : monthKey;
    if (b.period_key > key) continue;
    const eff = effectiveBudget(budgets, b.period, key, b.category_id);
    if (!eff || !(eff.amount > 0)) continue;
    (b.period === 'year' ? yearBudgeted : monthBudgeted).add(b.category_id);
  }

  const buildLine = (
    categoryId: string,
    period: BudgetPeriod,
    budgetedSet: Set<string>,
    spentMap: Map<string, number>,
  ): BudgetLine | null => {
    const cat = byId.get(categoryId);
    if (!cat) return null;
    const eff = effectiveBudget(budgets, period, period === 'year' ? yearKey : monthKey, categoryId);
    if (!eff) return null;
    const spent = rolledSpent(categoryId, spentMap, kids);
    const children = (kids.get(categoryId) ?? [])
      .filter((id) => budgetedSet.has(id))
      .map((id) => buildLine(id, period, budgetedSet, spentMap))
      .filter((l): l is BudgetLine => l != null)
      .sort((a, b) => b.spent - a.spent);
    return {
      categoryId,
      name: cat.name,
      icon: cat.icon ?? null,
      level: cat.parent_id ? 'sub' : 'parent',
      period,
      budget: eff.amount,
      inherited: eff.inherited,
      fromKey: eff.fromKey,
      spent,
      remaining: eff.amount - spent,
      pct: pctOf(spent, eff.amount),
      children,
    };
  };

  // Racines de la « forêt » budgétaire : les catégories budgétées sans ancêtre budgété. Ce sont
  // elles qu'on affiche au premier niveau, et elles seules qu'on retranche du global.
  const monthRoots = [...monthBudgeted].filter((id) => {
    const c = byId.get(id);
    return c ? !hasBudgetedAncestor(c, byId, monthBudgeted) : false;
  });
  const yearRoots = [...yearBudgeted].filter((id) => {
    const c = byId.get(id);
    return c ? !hasBudgetedAncestor(c, byId, yearBudgeted) : false;
  });

  const rows = monthRoots
    .map((id) => buildLine(id, 'month', monthBudgeted, spentByCat))
    .filter((l): l is BudgetLine => l != null)
    .sort((a, b) => b.spent - a.spent);

  const annual = yearRoots
    .map((id) => buildLine(id, 'year', yearBudgeted, spentByCatYear))
    .filter((l): l is BudgetLine => l != null)
    .sort((a, b) => b.spent - a.spent);

  // ── Hors catégories budgétées ─────────────────────────────────────────────
  // Une dépense sans budget de catégorie n'est PAS une erreur : elle apparaît en une ligne grise,
  // sans jauge. On plafonne à 0 parce que le dépensé l'est lui-même : sur un mois très remboursé,
  // la soustraction pourrait sinon rendre un négatif qui ne veut rien dire.
  const budgetedSpent = rows.reduce((s, r) => s + r.spent, 0);
  const outside = Math.max(0, spentAll - budgetedSpent);

  // ── Total du mois ─────────────────────────────────────────────────────────
  // La somme de ce que l'utilisateur a DÉCIDÉ, en face du dépensé correspondant. Ce n'est pas un
  // budget global — il n'en déclare plus (cf. migration 218) : c'est un cumul, et il ne compte que
  // les catégories RACINES, sinon une sous-catégorie budgétée sous sa parente compterait deux fois.
  const totalBudget = rows.reduce((s, r) => s + r.budget, 0);

  const plannedRest = sumVariableSpent(fluxTx, accountTypeById, { prefix: monthKey, after: today });

  // ── Rythme ────────────────────────────────────────────────────────────────
  // Rapporté à l'AVANCEMENT du mois (lib/spendingPace) : le 4 du mois, 10 % consommé n'est ni un
  // exploit ni une alerte. La fonction rend `null` tant qu'il est trop tôt pour conclure.
  const daysInMonth = new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0).getDate();
  const dayOfMonth = isCurrentMonth ? Number(today.slice(8, 10)) : daysInMonth;
  const pace = variablePacePercentage({ spent: budgetedSpent, envelope: totalBudget, dayOfMonth, daysInMonth });

  // ── Part de régularisation ────────────────────────────────────────────────
  // Elle COMPTE dans le dépensé (cohérence avec tout le reste de l'app depuis la migration 175),
  // mais elle est isolée à l'affichage : l'utilisateur n'a pas « choisi » de la dépenser.
  let regulPart = 0;
  for (const t of fluxTx) {
    if (!isRegul(t)) continue;
    const d = String(t.date ?? '');
    if (!d.startsWith(monthKey)) continue;
    if (isCurrentMonth && d > today) continue;
    const c = variableContribution(t, accountTypeById);
    if (c != null) regulPart += c;
  }

  return {
    total: {
      budget: totalBudget,
      spent: budgetedSpent,
      remaining: totalBudget - budgetedSpent,
      pct: pctOf(budgetedSpent, totalBudget),
      hasBudget: totalBudget > 0,
      spentAll,
    },
    rows,
    annual,
    outside,
    plannedRest,
    pace,
    regulPart: Math.max(0, regulPart),
    isEmpty: rows.length === 0 && annual.length === 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RÉSOLUTION À LA SAISIE
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export interface ResolveBudgetInput {
  categoryId: string | null | undefined;
  /** Date SAISIE (ISO). C'est elle qui décide de la période lue, pas la date du jour. */
  date: string;
  /** Montant en cours de saisie (positif), pour projeter « après cette dépense ». */
  amount: number;
  fluxTx: any[];
  accountTypeById: AccountTypeMap;
  categories: BudgetCategory[];
  budgets: BudgetRecord[];
  today: string;
  /** Transaction en cours de MODIFICATION : exclue du dépensé, sinon elle se compterait deux fois. */
  excludeTxId?: string | null;
}

export interface ResolvedBudget {
  /** Niveau réellement retenu — la sous-catégorie l'emporte sur sa parente. */
  level: 'sub' | 'parent';
  categoryId: string;
  name: string;
  period: BudgetPeriod;
  periodKey: string;
  budget: number;
  inherited: boolean;
  fromKey: string;
  /** Déjà consommé sur la période AVANT la saisie en cours. */
  spentBefore: number;
  /** Ce que deviendra le consommé une fois cette dépense enregistrée. */
  spentAfter: number;
  remainingAfter: number;
  /** La période visée est-elle dans le futur ? Le vocabulaire change alors (« déjà saisi »). */
  isFuture: boolean;
}

/**
 * Le budget à montrer pour UNE dépense en cours de saisie — ou `null` s'il n'y en a pas.
 *
 * Ordre strict : sous-catégorie choisie → sa catégorie parente → RIEN. Pas de repli sur le budget
 * global, et c'est délibéré : au moment de saisir 40 € de courses, « il te reste 220 € sur
 * 1 000 € » n'apprend rien d'actionnable. Le global se consulte, il ne s'affiche pas dans un
 * formulaire.
 *
 * Tout est piloté par la DATE saisie : une dépense datée du 12 novembre interroge le budget de
 * novembre (celui qui y sera reporté s'il n'a pas encore été saisi) et le consommé de novembre.
 */
export function resolveBudgetFor(input: ResolveBudgetInput): ResolvedBudget | null {
  const { categoryId, date, amount, fluxTx, accountTypeById, categories, budgets, today, excludeTxId } = input;
  if (!categoryId || !date || date.length < 10) return null;

  const byId = new Map(categories.map((c) => [c.id, c]));
  const cat = byId.get(categoryId);
  if (!cat) return null;
  // Un virement interne ne consomme aucun budget : rien à afficher sous le formulaire.
  if (movementCategoryIds(categories).has(categoryId)) return null;

  const mKey = monthKeyOf(date);
  const yKey = yearKeyOf(date);

  // Candidats, du plus spécifique au moins spécifique. Chaque candidat est testé sur les DEUX
  // cadences : un poste annuel doit gagner sur sa parente mensuelle s'il est plus spécifique.
  const candidates: Array<{ id: string; level: 'sub' | 'parent' }> = [];
  if (cat.parent_id) {
    candidates.push({ id: cat.id, level: 'sub' });
    const parent = byId.get(cat.parent_id);
    if (parent) candidates.push({ id: parent.id, level: 'parent' });
  } else {
    candidates.push({ id: cat.id, level: 'parent' });
  }

  for (const c of candidates) {
    for (const period of ['month', 'year'] as BudgetPeriod[]) {
      const key = period === 'year' ? yKey : mKey;
      const eff = effectiveBudget(budgets, period, key, c.id);
      if (!eff || !(eff.amount > 0)) continue;

      const name = byId.get(c.id)?.name ?? '';
      const kids = childrenIndex(categories);
      // Le mois/l'année en cours s'arrête à aujourd'hui ; une période passée ou future se lit en
      // entier — sinon un mois futur afficherait 0 alors qu'il porte déjà des dépenses saisies.
      const isCurrent = period === 'year' ? yearKeyOf(today) === key : monthKeyOf(today) === key;
      const source = excludeTxId ? fluxTx.filter((t) => t.id !== excludeTxId) : fluxTx;
      const spentMap = variableSpentByCategory(source, accountTypeById, {
        prefix: key,
        upTo: isCurrent ? today : undefined,
      });
      const spentBefore = rolledSpent(c.id, spentMap, kids);
      const spentAfter = spentBefore + Math.max(0, amount);

      return {
        level: c.level,
        categoryId: c.id,
        name,
        period,
        periodKey: key,
        budget: eff.amount,
        inherited: eff.inherited,
        fromKey: eff.fromKey,
        spentBefore,
        spentAfter,
        remainingAfter: eff.amount - spentAfter,
        isFuture: date > today,
      };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// HISTORIQUE (page Budget + Reporting)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export interface BudgetMonthPoint {
  monthKey: string;
  label: string;
  budget: number;
  spent: number;
  /** `budget - spent` : positif = tenu, négatif = dépassé. `null` si aucun budget ce mois-là. */
  gap: number | null;
  hasBudget: boolean;
}

/**
 * Un point par mois : budget de CE mois-là (report compris) et dépensé de ce mois-là.
 *
 * Le budget suit son historique : s'il est passé de 950 à 1 000 € en juillet, le repère change de
 * hauteur à ce mois-là. Un trait plat sur six mois mentirait sur ce qui s'est réellement passé —
 * et c'est précisément l'information qu'on vient chercher dans un reporting.
 */
export function buildBudgetHistory(
  monthKeys: string[],
  fluxTx: any[],
  accountTypeById: AccountTypeMap,
  budgets: BudgetRecord[],
  today: string,
  categories: BudgetCategory[] = [],
  /** Limiter à UNE catégorie (et ses enfants) ; sinon : tous les budgets mensuels cumulés. */
  categoryId?: string,
): BudgetMonthPoint[] {
  const todayMonth = monthKeyOf(today);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const kids = childrenIndex(categories);
  // Toutes les catégories jamais budgétées au mois : c'est sur elles qu'on cumule, mois par mois.
  const everBudgeted = [...new Set(budgets.filter((b) => b.period === 'month').map((b) => b.category_id))];

  return monthKeys.map((mk) => {
    const upTo = mk === todayMonth ? today : undefined;
    const spentMap = variableSpentByCategory(fluxTx, accountTypeById, { prefix: mk, upTo });

    if (categoryId) {
      const eff = effectiveBudget(budgets, 'month', mk, categoryId);
      const budget = eff?.amount ?? 0;
      const spent = Math.max(0, rolledSpent(categoryId, spentMap, kids));
      const hasBudget = budget > 0;
      return { monthKey: mk, label: periodLabel('month', mk), budget, spent, gap: hasBudget ? budget - spent : null, hasBudget };
    }

    /* Cumul : on ne retient que les catégories RACINES du mois — celles dont aucun ancêtre n'est
       lui-même budgété ce mois-là. Sans ce filtre, une sous-catégorie budgétée sous sa parente
       compterait son budget ET son dépensé deux fois. */
    const budgetedThisMonth = new Set(
      everBudgeted.filter((id) => (effectiveBudget(budgets, 'month', mk, id)?.amount ?? 0) > 0),
    );
    let budget = 0;
    let spent = 0;
    for (const id of budgetedThisMonth) {
      const cat = byId.get(id);
      if (cat && hasBudgetedAncestor(cat, byId, budgetedThisMonth)) continue;
      budget += effectiveBudget(budgets, 'month', mk, id)?.amount ?? 0;
      spent += rolledSpent(id, spentMap, kids);
    }
    spent = Math.max(0, spent);
    const hasBudget = budget > 0;
    return { monthKey: mk, label: periodLabel('month', mk), budget, spent, gap: hasBudget ? budget - spent : null, hasBudget };
  });
}

/** « Tu tiens ton budget 4 mois sur 6 » — sur les seuls mois qui portaient un budget. */
export function countMonthsRespected(points: BudgetMonthPoint[]): { respected: number; total: number } {
  const withBudget = points.filter((p) => p.hasBudget);
  return {
    respected: withBudget.filter((p) => (p.gap ?? 0) >= 0).length,
    total: withBudget.length,
  };
}
