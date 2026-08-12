/**
 * Tableau de trésorerie — utilitaires PURS : fenêtre de mois affichée, clés de mois, regroupement
 * des catégories parent/enfant, et index des échéances modifiées.
 *
 * Extraits de `app/(tabs)/tresorerie.tsx` (2 000+ lignes) où ils étaient noyés dans le rendu :
 * ici, ils sont testables sans monter l'écran (cf. `__tests__/treasuryTable.test.ts`).
 */
import type { Category } from '../../types/database';

export function getMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Les `count` mois affichés à partir d'un décalage (0 = mois courant, négatif = passé).
 * @param now horloge de référence — paramètre, pour que la fenêtre soit reproductible en test.
 */
export function getMonthsFromOffset(monthOffset: number, count: number, now: Date = new Date()): { year: number; month: number; key: string }[] {
  const out: { year: number; month: number; key: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + monthOffset + i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1, key: getMonthKey(d.getFullYear(), d.getMonth() + 1) });
  }
  return out;
}

/** Sépare les catégories racines de leurs sous-catégories, indexées par parent. */
export function groupCategories(categories: Category[]) {
  const parents = categories.filter((c) => !c.parent_id);
  const byParent: Record<string, Category[]> = {};
  for (const c of categories) {
    if (c.parent_id) {
      byParent[c.parent_id] = byParent[c.parent_id] ?? [];
      byParent[c.parent_id].push(c);
    }
  }
  return { parents, byParent };
}

// Créer un map des overrides pour accès rapide
export function createOverridesMap(overrides: Array<{ transaction_id: string; year: number; month: number; override_amount: number | null }>) {
  const map: Record<string, number> = {};
  overrides.forEach((o) => {
    if (o.override_amount == null) return; // override date-only (#2) → pas de montant à appliquer
    const key = `${o.transaction_id}:${o.year}:${o.month}`;
    map[key] = o.override_amount;
  });
  return map;
}

export const getOverrideKey = (transactionId: string, year: number, month: number): string => {
  return `${transactionId}:${year}:${month}`;
};
