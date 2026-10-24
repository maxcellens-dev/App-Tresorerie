/**
 * Les mots du Jardin — UNE seule source pour tous les libellés de la nouvelle interface.
 *
 * Changer un mot se fait ici, en une ligne, et non écran par écran.
 *
 * ── LA RÈGLE DES MOTS ────────────────────────────────────────────────────────────────────────────
 * Le mot COURANT d'abord, partout, y compris sur les fiches du dessin : « Épargne », « Placements »,
 * « Plaisir », « Crédit ». Le jardin est un décor, pas un vocabulaire : on ne demande jamais à
 * l'utilisateur de traduire « racines » en « épargne ». Les mots du dessin (`drawn`) ne servent
 * qu'à nommer ce qu'on touche sur l'illustration, en second. Un terme qui demande une explication
 * est un mauvais terme.
 *
 * Tutoiement partout (règle de l'app), sauf pages légales et admin.
 */

/** Ce qui est dessiné : le vrai terme, ce qu'il veut dire en clair, et l'élément du dessin. */
export const TREE_PARTS = {
  can: { name: 'Comptes courants', meaning: 'ton argent du quotidien', drawn: 'Arrosoir' },
  roots: { name: 'Épargne', meaning: 'ton argent de secours', drawn: 'Racines' },
  /* La clé `branches` (les placements) est gardée pour ne pas tout renommer. */
  branches: { name: 'Placements', meaning: 'ton argent qui travaille', drawn: 'Fruits' },
  fruits: { name: 'Gains', meaning: 'ce que tes placements rapportent', drawn: 'Fruits mûrs' },
  flowers: { name: 'Plaisir', meaning: 'pour te faire plaisir', drawn: 'Fleurs' },
  brambles: { name: 'Crédit cher', meaning: 'à rembourser en premier', drawn: 'Ronces' },
  cabin: { name: 'Crédits', meaning: 'ce qu’il te reste à rembourser', drawn: 'Cabane' },
  rings: { name: 'Série', meaning: 'semaines d’affilée', drawn: 'Anneaux' },
} as const;

export type TreePart = keyof typeof TREE_PARTS;

/** Les cinq onglets. */
export const TABS = {
  garden: 'Accueil',
  money: 'Mon argent',
  add: 'Ajouter',
  projects: 'Projets',
  pico: 'Pépin',
} as const;

/** Vues de « Mon argent ». */
export const MONEY_VIEWS = { today: "Aujourd'hui", month: 'Ce mois', tomorrow: 'Demain' } as const;

/** Libellés courants (vrais mots). */
export const WORDS = {
  relyka: 'Ton Relyka',
  picoChoices: 'Les choix de Pépin',
  myChoices: 'Mes choix',
  changeChoices: 'Changer les choix',
  monthGestures: 'Mes gestes du mois',
  transferDone: "J'ai fait le virement",
  later: 'Plus tard',
  pending: 'En attente',
  spent: 'Dépensé',
  leftToSpend: 'Encore prévu ce mois-ci',
  leftToSpendHint: 'prévision',
  /** Prélèvements récurrents pas encore passés : ils sortiront vraiment. */
  recurringLeft: 'Prélèvements encore à passer',
  /** Dépenses courantes habituelles : une prévision, pas une obligation. */
  dailyForecast: 'Dépenses du quotidien prévues',
  dailyBudget: 'Budget du quotidien',
  minimumToKeep: 'Réserve minimum',
  lowestDay: 'Jour le plus bas',
  setAside: 'Argent mis de côté',
  recurring: 'Tes opérations récurrentes',
  operations: 'Opérations',
  upcoming: 'À venir',
  credit: 'Crédit',
  expensiveCredit: 'Crédit cher',
  projects: 'Projets',
  sharedProjects: 'Projets partagés',
  sharedAccounts: 'Comptes partagés',
  monthPlan: 'Plan de trésorerie',
  review: 'Bilan',
  myJourney: 'Mon parcours',
  myStep: 'Ton étape',
  successes: 'Succès',
  streak: 'Série',
  settings: 'Paramètres',
  appearance: 'Apparence',
  shop: 'Boutique',
  gardenTour: 'Mettre à jour le solde de mes comptes',
  gardenTourHint: 'recopie ce que ta banque affiche',
  momentRelyka: 'Le Moment Relyka',
  nextStep: 'Prochain pas',
} as const;

/**
 * Objectif d'épargne, dit simplement (« Vise 3 mois d'épargne de secours »). Le trait est en mois
 * de dépenses, comme partout dans l'app.
 */
export function rootsGoal(months: number): string {
  return `Vise ${months} mois d'épargne de secours`;
}

/* Les mots des états spéciaux du Relyka (règle « un mot, pas un chiffre ») : lib/garden/relykaWords. */
