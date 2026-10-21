/**
 * Les mots du Jardin — UNE seule source pour tous les libellés de la nouvelle interface.
 *
 * Changer un mot se fait ici, en une ligne, et non écran par écran.
 *
 * ── LA RÈGLE DES MOTS ────────────────────────────────────────────────────────────────────────────
 * Les mots du jardin décrivent SEULEMENT ce qu'on voit sur le dessin (arrosoir, racines, branches,
 * fruits, fleurs, ronces), toujours accompagnés du vrai terme. Partout ailleurs : le mot courant,
 * celui que tout le monde comprend (« Crédit », « Opérations », « Réserve minimum »…). Pas de
 * métaphore pour la métaphore : un terme qui demande une explication est un mauvais terme.
 *
 * Tutoiement partout (règle de l'app), sauf pages légales et admin.
 */

/** Ce qui est dessiné : le nom sur l'arbre + le vrai terme affiché à côté. */
export const TREE_PARTS = {
  can: { name: 'Arrosoir', meaning: 'Comptes courants' },
  roots: { name: 'Racines', meaning: 'Épargne de secours' },
  /* Les branches nues étaient laides à l'écran : les placements sont des FRUITS (un par placement),
     qui mûrissent quand ils rapportent. La clé `branches` est gardée pour ne pas tout renommer. */
  branches: { name: 'Fruits', meaning: 'Placements' },
  fruits: { name: 'Fruits mûrs', meaning: 'Gains' },
  flowers: { name: 'Fleurs', meaning: 'Pour te faire plaisir' },
  brambles: { name: 'Ronces', meaning: 'Crédit cher' },
  /** Crédit sain : la cabane se construit à chaque mensualité, jusqu'à être vraiment à toi. */
  cabin: { name: 'Cabane', meaning: 'Crédit' },
  rings: { name: 'Anneaux', meaning: 'Série' },
  /** Épargne (ou investissement) qui revient chaque mois : un goutte-à-goutte relié aux racines ou aux branches. */
  drip: { name: 'Arrosage régulier', meaning: 'Épargne chaque mois' },
} as const;

export type TreePart = keyof typeof TREE_PARTS;

/** Les cinq onglets. */
export const TABS = {
  garden: 'Jardin',
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
  inFiveYears: 'Dans 5 ans',
  monthPlan: 'Plan mois par mois',
  review: 'Bilan',
  myJourney: 'Mon parcours',
  myStep: 'Ton étape',
  successes: 'Succès',
  streak: 'Série',
  settings: 'Paramètres',
  appearance: 'Apparence',
  shop: 'Boutique',
  gardenTour: 'Faire le tour du jardin',
  gardenTourHint: 'mettre à jour tes soldes',
  momentRelyka: 'Le Moment Relyka',
  nextStep: 'Prochain pas',
} as const;

/**
 * Objectif d'épargne de secours, dit simplement (« Renforce tes racines : atteins 3 mois d'épargne
 * disponible »). Le trait est en mois de dépenses, comme partout dans l'app.
 */
export function rootsGoal(months: number): string {
  return `Renforce tes racines : atteins ${months} mois d'épargne disponible`;
}

/* Les mots des états spéciaux du Relyka (règle « un mot, pas un chiffre ») : lib/garden/relykaWords,
   dans le langage de l'arrosoir. */
