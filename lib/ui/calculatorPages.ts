/**
 * Les pages qui peuvent porter la calculatrice flottante (CalculatorButton), rangées par sujet pour
 * la liste repliable des Paramètres. Fonction PURE pour lire le choix enregistré.
 *
 * Les identifiants sont ceux enregistrés chez les utilisateurs (profiles.ui_prefs.calculator_pages) :
 * on n'en change jamais un sans le rattacher dans LEGACY.
 */
export const CALCULATOR_GROUPS = [
  { title: 'Ton suivi', pages: [
    { id: 'jardin', label: 'Accueil', icon: 'home-outline' },
    { id: 'pepin', label: 'Pépin', icon: 'chatbubble-ellipses-outline' },
  ] },
  { title: 'Ton argent', pages: [
    { id: 'argent', label: 'Mon argent', icon: 'wallet-outline' },
    { id: 'comptes', label: 'Comptes et crédits', icon: 'card-outline' },
    { id: 'placements', label: 'Mes placements', icon: 'nutrition-outline' },
    { id: 'tresorerie', label: 'Plan de trésorerie', icon: 'stats-chart-outline' },
    { id: 'budgets', label: 'Budgets', icon: 'pie-chart-outline' },
  ] },
  { title: 'Tes projets et tes saisies', pages: [
    { id: 'projets', label: 'Projets', icon: 'flower-outline' },
    { id: 'transactions', label: 'Saisie d’une opération', icon: 'add-circle-outline' },
  ] },
] as const;

export type CalculatorPageId = (typeof CALCULATOR_GROUPS)[number]['pages'][number]['id'];
export const CALCULATOR_PAGES = CALCULATOR_GROUPS.flatMap((g) => g.pages as readonly { id: CalculatorPageId; label: string; icon: string }[]);

/** Défaut (rien d'enregistré) : là où l'on compte le plus souvent. */
export const DEFAULT_CALCULATOR_PAGES: CalculatorPageId[] = ['transactions', 'argent'];

/** Anciens identifiants → leur page d'aujourd'hui (null = page qui ne la propose plus). */
const LEGACY: Record<string, CalculatorPageId | null> = { 'conseils-ia': 'pepin', projection: null, reporting: null, pilotage: 'jardin' };

/** Le choix enregistré, ramené aux pages actuelles ; rien d'enregistré → le défaut. */
export function resolveCalculatorPages(stored: unknown): CalculatorPageId[] {
  if (!Array.isArray(stored)) return DEFAULT_CALCULATOR_PAGES;
  const valid = new Set<string>(CALCULATOR_PAGES.map((p) => p.id));
  const out = new Set<CalculatorPageId>();
  for (const raw of stored) {
    const id = raw in LEGACY ? LEGACY[raw] : raw;
    if (id && valid.has(id)) out.add(id as CalculatorPageId);
  }
  return [...out];
}
