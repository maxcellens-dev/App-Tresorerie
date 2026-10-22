/**
 * « Ce qui revient » en tuiles : les charges et rentrées régulières les plus courantes. Une tuile
 * ouvre la saisie rapide (transactions/add?preset=…) avec la catégorie, le libellé et le rythme
 * HABITUEL déjà choisis — tout reste modifiable au tap (rythme, date, compte, catégorie).
 * Fonctions PURES, testées.
 *
 * Chaque tuile vise une sous-catégorie de base (lib/ui/defaultCategories) par son nom ; si
 * l'utilisateur l'a renommée ou supprimée, on cherche par mots-clés, puis on retombe sur une
 * catégorie « autres » du même sens. Les tuiles « Autre » ne choisissent rien : à toi de choisir.
 */
import type { Category, RecurrenceRule } from '../../types/database';

export interface RecurringPreset {
  key: string;
  label: string;
  kind: 'expense' | 'income';
  /** Ionicons. */
  icon: string;
  /** Nom de la sous-catégorie de base visée ('' = aucune, la tuile « Autre »). */
  category: string;
  /** Repli : un de ces mots dans le nom d'une sous-catégorie. */
  keywords: string[];
  /** Rythme le plus courant pour cette charge (modifiable dans la saisie). */
  recurrence: RecurrenceRule;
  /** Libellé pré-rempli de l'opération. */
  note: string;
}

const p = (key: string, label: string, kind: RecurringPreset['kind'], icon: string, category: string, keywords: string[], recurrence: RecurrenceRule = 'monthly', note = label): RecurringPreset =>
  ({ key, label, kind, icon, category, keywords, recurrence, note });

export const RECURRING_PRESETS: RecurringPreset[] = [
  p('salary', 'Salaire', 'income', 'briefcase-outline', 'Salaire, Traitement', ['salaire', 'traitement']),
  p('caf', 'CAF / aides', 'income', 'people-outline', 'CAF', ['caf', 'aide'], 'monthly', 'CAF'),
  p('other_income', 'Autre rentrée', 'income', 'add-circle-outline', '', [], 'monthly', ''),
  p('rent', 'Loyer', 'expense', 'home-outline', 'Loyer', ['loyer']),
  p('energy', 'Électricité, gaz, eau', 'expense', 'flash-outline', 'Electricité, Eau, Gaz', ['electricite', 'gaz', 'eau', 'energie'], 'monthly', 'Énergie'),
  p('box', 'Box internet', 'expense', 'wifi-outline', 'Box internet', ['box', 'internet']),
  p('mobile', 'Forfait mobile', 'expense', 'phone-portrait-outline', 'Internet mobile', ['mobile', 'telephone', 'forfait']),
  p('streaming', 'Streaming', 'expense', 'tv-outline', 'Plateformes Streaming', ['streaming', 'netflix']),
  p('mutuelle', 'Mutuelle', 'expense', 'medkit-outline', 'Mutuelle', ['mutuelle', 'sante']),
  p('home_ins', 'Assurance habitation', 'expense', 'shield-checkmark-outline', 'Assurance habitation', ['habitation'], 'yearly'),
  p('transport', 'Transports', 'expense', 'bus-outline', 'Transports en commun', ['transport', 'navigo']),
  p('sport', 'Sport', 'expense', 'barbell-outline', 'Sport', ['sport', 'salle']),
  p('tax', 'Impôts', 'expense', 'document-text-outline', 'Impôt sur le revenu', ['impot']),
  p('property_tax', 'Taxe foncière', 'expense', 'business-outline', 'Taxe foncière', ['fonciere'], 'yearly'),
  p('other_sub', 'Abonnement', 'expense', 'repeat-outline', 'Autres abonnements', ['abonnement']),
  p('other_expense', 'Autre charge', 'expense', 'add-circle-outline', '', [], 'monthly', ''),
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** La sous-catégorie à utiliser pour une tuile, ou `null` (tuile « Autre », ou aucune de ce sens). */
export function presetCategory(preset: RecurringPreset, categories: Category[]): Category | null {
  if (!preset.category) return null;
  const subs = categories.filter((c) => c.parent_id && String(c.type).toLowerCase() === preset.kind && !/regularisation/.test(norm(c.name)));
  const exact = subs.find((c) => norm(c.name) === norm(preset.category));
  if (exact) return exact;
  const byWord = subs.find((c) => preset.keywords.some((k) => norm(c.name).includes(k)));
  if (byWord) return byWord;
  return subs.find((c) => norm(c.name).startsWith('autre')) ?? subs[0] ?? null;
}
