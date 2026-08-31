/**
 * DÉFINITION UNIQUE du « dépensé variable » — extraite À L'IDENTIQUE de `pilotageEngine`.
 *
 * POURQUOI CE MODULE : la règle vivait en closures internes à `computePilotageData`
 * (`isBudgetExpense`, `isRecurringTx`, `monthVariableSpent`), donc inaccessible au reste de l'app.
 * Le module Budgets a besoin EXACTEMENT du même « dépensé », décliné par catégorie : le recopier
 * aurait créé une seconde définition — précisément la faute que le commentaire de `pilotageEngine`
 * raconte avoir déjà coûté cher (« 1 890 € dépensés / 303 € estimés »).
 *
 * ⚠️ DÉPLACEMENT SANS CHANGEMENT DE RÈGLE. Aucune condition n'a été ajoutée, retirée ni réordonnée
 * au passage. `pilotageEngine` appelle désormais ces fonctions et doit rendre les mêmes valeurs
 * qu'avant, au centime — c'est ce que vérifie `__tests__/variableSpend.test.ts`.
 *
 * Toute évolution de la règle se fait ICI, et se répercute alors partout à la fois : Pilotage,
 * Budgets, Pouls. C'est l'intérêt de l'extraction.
 */
import { isProjectSpendTx } from './projectTx';

/** Type des comptes par id — `accounts.forEach(a => map[a.id] = a.type)`. */
export type AccountTypeMap = Record<string, string>;

/**
 * Sortie qui pèse sur le budget quotidien : depuis un compte courant, hors virement, hors projet
 * (sauf « dépenser petit à petit » qui sort vraiment), catégorie de dépense (ou sans catégorie).
 *
 * La RÉGULARISATION de solde en fait partie : elle porte sa propre sous-catégorie
 * « Frais variables › Régularisation Solde » (migration 175). Constater après coup qu'il manque
 * 80 € sur le compte, c'est 80 € dépensés — la seule différence avec les courses, c'est qu'on ne
 * sait pas en quoi.
 */
export function isBudgetExpense(t: any, accountTypeById: AccountTypeMap): boolean {
  if (accountTypeById[t.account_id] !== 'checking') return false;
  if (t.linked_account_id) return false;
  if (t.project_id && !isProjectSpendTx(t)) return false;
  const cat = t.category;
  if (cat && cat.type !== 'expense') return false;
  return true;
}

/**
 * « Variable » = tout ce qui n'est PAS récurrent.
 * ⚠ Une occurrence MATÉRIALISÉE d'une récurrente est une vraie ligne avec `is_recurring = false`
 * et `materialized_from` renseigné : sans ce second test, chaque loyer déjà matérialisé
 * basculerait en « variable » et gonflerait à la fois l'historique et le dépensé du mois.
 */
export function isRecurringTx(t: any): boolean {
  return (Boolean(t.is_recurring) && Boolean(t.recurrence_rule)) || Boolean(t.materialized_from);
}

/** Bornes d'une fenêtre de calcul. `prefix` = 'YYYY-MM' (un mois) ou 'YYYY' (une année). */
export interface VariableSpendWindow {
  /** Préfixe de date à matcher : '2026-09' pour un mois, '2026' pour une année. */
  prefix: string;
  /** Borne haute INCLUSE (ISO) — le mois courant s'arrête à aujourd'hui. */
  upTo?: string;
  /** Borne basse EXCLUE (ISO) — ne garder que ce qui est daté APRÈS cette date. */
  after?: string;
}

/**
 * Contribution SIGNÉE d'une transaction au dépensé variable, ou `null` si elle n'y entre pas.
 * Dépense (montant −) → valeur positive ; remboursement (montant +) sur une vraie catégorie de
 * dépense → valeur négative (il vient en déduction).
 */
export function variableContribution(t: any, accountTypeById: AccountTypeMap): number | null {
  if (t.is_draft || t.is_reserved) return null;
  if (isRecurringTx(t)) return null;
  if (!isBudgetExpense(t, accountTypeById)) return null;
  const amt = Number(t.amount);
  // Montant positif : ce n'est un remboursement (à déduire) que sur une VRAIE catégorie de
  // dépense. Sinon c'est une recette / un apport / une régul → hors dépenses variables.
  if (amt >= 0 && !(t.category && t.category.type === 'expense')) return null;
  return -amt;
}

/** La transaction tombe-t-elle dans la fenêtre demandée ? */
function inWindow(t: any, w: VariableSpendWindow): boolean {
  const d = String(t.date ?? '');
  if (!d.startsWith(w.prefix)) return false;
  if (w.upTo && d > w.upTo) return false;
  if (w.after && d <= w.after) return false;
  return true;
}

/**
 * Dépenses VARIABLES réellement passées sur une fenêtre, en NET.
 * MÊME fonction pour le dépensé du mois et pour les mois d'historique qui calibrent l'enveloppe.
 */
export function sumVariableSpent(
  transactions: any[],
  accountTypeById: AccountTypeMap,
  window: VariableSpendWindow,
): number {
  let sum = 0;
  for (const t of transactions) {
    if (!inWindow(t, window)) continue;
    const c = variableContribution(t, accountTypeById);
    if (c == null) continue;
    sum += c;
  }
  return Math.max(0, sum);
}

/**
 * Même calcul, ventilé PAR CATÉGORIE (clé = `category_id`, ou `''` pour les sans-catégorie).
 *
 * ⚠️ Le total de cette ventilation n'est PAS forcément `sumVariableSpent` : celui-ci plafonne le
 * total à 0 (un mois où les remboursements dépassent les dépenses ne « rapporte » pas), là où
 * chaque catégorie est renvoyée telle quelle, négatif compris. Les deux sont justes dans leur
 * registre — c'est au consommateur de ne pas les additionner comme s'ils étaient interchangeables.
 */
export function variableSpentByCategory(
  transactions: any[],
  accountTypeById: AccountTypeMap,
  window: VariableSpendWindow,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of transactions) {
    if (!inWindow(t, window)) continue;
    const c = variableContribution(t, accountTypeById);
    if (c == null) continue;
    const key = String(t.category_id ?? '');
    out.set(key, (out.get(key) ?? 0) + c);
  }
  return out;
}

/** Clé de mois d'une date ISO : '2026-09-18' → '2026-09'. */
export function monthPrefix(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}
