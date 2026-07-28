/**
 * PROFIL PROGRESSIF — la file des questions qui ne sont PAS posées au démarrage.
 *
 * Pourquoi ce moteur existe
 * ─────────────────────────
 * Le démarrage ne pose plus que ce qu'il installe réellement (comptes, revenu, charges). Trois
 * réponses restent nécessaires au moteur de profils (q4, q6) ou à la justesse des calculs (q8, q9)
 * et ne peuvent pas être déduites des données au jour 0. Elles sont donc posées À L'USAGE.
 *
 * Règles (validées produit)
 * ─────────────────────────
 *  • Une seule question à la fois, la plus prioritaire.
 *  • Déclencheurs COURTS et CERTAINS : tout ce que l'utilisateur fait forcément en naviguant les
 *    premières minutes (ouvrir un onglet, saisir, ouvrir le détail du Relyka). Jamais un événement
 *    lointain ou hypothétique (clôture de mois, bilan) : il pourrait ne jamais arriver.
 *  • PAS de quota journalier. Si l'utilisateur enchaîne, on le guide jusqu'au bout : la question
 *    suivante apparaît dès l'action suivante. C'est une courte série, pas un goutte-à-goutte.
 *  • Toujours passable, sans reproche. « Plus tard » = reporté à la prochaine ouverture de l'app
 *    (mémoire de session) ; « Je ne sais pas » est une VRAIE réponse (valeur neutre enregistrée),
 *    pour que la question cesse de revenir.
 *  • Chaque question dit à quoi elle sert, et la série annonce son but : affiner le profil financier.
 *
 * Ce moteur est une FONCTION PURE (comme lib/appStateEngine) : il ne lit rien, il décide. Les
 * données et la persistance sont l'affaire de hooks/useProgressiveProfile.
 *
 * État persisté dans `profiles.onboarding_state` (jsonb déjà existant → AUCUNE migration).
 */

import { Q4_OPTIONS, Q6_OPTIONS } from './financialProfileEngine';

export type ProgressiveKey = 'q4' | 'q6' | 'q8' | 'q9';

/** Nature de la saisie attendue. */
export type ProgressiveKind = 'choice' | 'amount';

export interface ProgressiveOption {
  /** Valeur EXACTE stockée en base — le moteur de profils compare des chaînes littérales. */
  value: string;
  /** Libellé affiché : reformulé pour être compris, jamais égal à la valeur stockée par hasard. */
  label: string;
}

export interface ProgressiveQuestion {
  key: ProgressiveKey;
  /** Question, à la 2ᵉ personne. */
  title: string;
  /** Pourquoi on la pose — une phrase, concrète. */
  why: string;
  /** Précision de cadrage affichée au-dessus des choix (ex. « en général, pas seulement le mois dernier »). */
  frame?: string;
  kind: ProgressiveKind;
  options?: ProgressiveOption[];
  /** Saisie de montant : libellé du champ + unité. */
  amountLabel?: string;
  amountUnit?: 'month' | 'week';
  /** Libellé du bouton « je ne sais pas » (réponse neutre, enregistrée). */
  unknownLabel: string;
  /** Valeur enregistrée quand l'utilisateur répond « je ne sais pas ». */
  unknownValue: string;
  /** La réponse fait-elle bouger le profil financier ? (affiché dans l'en-tête de la série) */
  affectsProfile: boolean;
}

/* ── Compteurs d'événements ──────────────────────────────────────────────────
 * `any` est incrémenté par TOUTE interaction significative (arrivée sur un onglet principal,
 * enregistrement d'une transaction, ouverture du détail du Relyka). C'est lui qui garantit qu'on
 * ne dépend jamais d'un événement unique qui pourrait ne pas se produire.
 */
export interface ProgressiveEvents {
  /** Interactions significatives depuis la fin du démarrage. */
  any: number;
  /** Ouvertures du détail « d'où vient ce chiffre ». */
  relyka: number;
  /** Visites de l'onglet Comptes. */
  comptes: number;
  /** Visites de l'onglet Transactions (l'utilisateur est entré dans sa saisie). */
  tx: number;
}

export interface ProgressiveState {
  events: ProgressiveEvents;
  /** Clés déjà répondues (y compris « je ne sais pas »). */
  answered: Record<string, boolean>;
  /** Clés reportées pour CETTE session (mémoire volatile — elles reviendront au prochain lancement). */
  snoozed: Record<string, boolean>;
  /** Le socle de démarrage est-il terminé ? Aucune question avant. */
  socleDone: boolean;
}

/** Seuil d'événements à partir duquel chaque question devient posable. */
const TRIGGER: Record<ProgressiveKey, (e: ProgressiveEvents) => boolean> = {
  // Les deux questions de profil d'abord : ce sont les seules qui manquent au calcul.
  q4: (e) => e.any >= 1,
  q6: (e) => e.any >= 2,
  // La marge : dès qu'il a ouvert le détail du Relyka (il vient d'y lire « marge : à définir »),
  // ou à défaut au bout de quelques interactions.
  q8: (e) => e.relyka >= 1 || e.any >= 4,
  // L'enveloppe variable : dès qu'il est entré dans ses transactions (le sujet est là), ou à
  // défaut au bout de quelques interactions.
  q9: (e) => e.tx >= 1 || e.any >= 6,
};

/** Ordre de priorité (le profil d'abord : c'est lui qui change les recommandations). */
export const PROGRESSIVE_ORDER: ProgressiveKey[] = ['q4', 'q6', 'q8', 'q9'];

export const PROGRESSIVE_QUESTIONS: Record<ProgressiveKey, ProgressiveQuestion> = {
  q4: {
    key: 'q4',
    title: 'En fin de mois, une fois toutes tes dépenses passées, il te reste…',
    why: 'Avec ta réponse précédente, c’est ce qui fixe la répartition entre épargner, investir, confort et conserver.',
    frame: 'Réponds sur ton habitude générale, pas seulement sur le mois dernier.',
    kind: 'choice',
    affectsProfile: true,
    options: [
      { value: Q4_OPTIONS[0], label: 'Le plus souvent rien — il m’arrive de finir à découvert' },
      { value: Q4_OPTIONS[1], label: 'De quoi vivre correctement, mais je n’épargne pas vraiment' },
      { value: Q4_OPTIONS[2], label: 'Une somme que j’arrive à mettre de côté la plupart des mois' },
      { value: Q4_OPTIONS[3], label: 'Une somme que j’épargne et que j’investis, à peu près autant l’un que l’autre' },
      { value: Q4_OPTIONS[4], label: 'Un montant confortable, que j’investis en priorité' },
    ],
    unknownLabel: 'Ça dépend vraiment des mois',
    // « Ça dépend » = le cas moyen : on vit correctement sans épargner systématiquement.
    // Surtout PAS la 1ʳᵉ option, qui vaut « découvert » et classe d'office au profil le plus bas.
    unknownValue: Q4_OPTIONS[1],
  },
  q6: {
    key: 'q6',
    title: 'Quelle part de tes revenus arrives-tu à mettre de côté ?',
    why: 'C’est la dernière pièce qui manque pour arrêter ton profil financier.',
    frame: 'Une moyenne sur l’année suffit — épargne et investissement compris.',
    kind: 'choice',
    affectsProfile: true,
    options: [
      { value: Q6_OPTIONS[0], label: 'Rien pour l’instant' },
      { value: Q6_OPTIONS[1], label: 'Moins de 10 %' },
      { value: Q6_OPTIONS[2], label: 'Entre 10 et 20 %' },
      { value: Q6_OPTIONS[3], label: 'Entre 20 et 30 %' },
      { value: Q6_OPTIONS[4], label: 'Plus de 30 %' },
      { value: Q6_OPTIONS[5], label: 'Je n’ai plus besoin d’augmenter mon épargne' },
    ],
    unknownLabel: 'Je ne sais pas',
    unknownValue: Q6_OPTIONS[6],
  },
  q8: {
    key: 'q8',
    title: 'Combien veux-tu avoir au minimum sur tes comptes courants en fin de mois ?',
    why: 'On te dira ce que tu peux utiliser avant d’entamer ce montant. Il reste sur ton compte : l’app ne le déplace nulle part.',
    kind: 'amount',
    affectsProfile: false,
    amountLabel: 'Ma marge de sécurité',
    amountUnit: 'month',
    unknownLabel: 'Aucune pour l’instant',
    unknownValue: '',
  },
  q9: {
    key: 'q9',
    title: 'Tu dépenses environ combien par semaine en courses, sorties et imprévus ?',
    why: 'Sans cette estimation, l’app te présente comme disponible de l’argent que tu vas dépenser de toute façon.',
    frame: 'Une approximation suffit : dès deux mois d’utilisation, on se basera sur tes dépenses réelles.',
    kind: 'amount',
    affectsProfile: false,
    amountLabel: 'Mes dépenses variables',
    amountUnit: 'week',
    unknownLabel: 'Je ne sais pas → estime-le pour moi',
    unknownValue: '',
  },
};

export interface ProgressivePick {
  question: ProgressiveQuestion;
  /** Rang dans la série (1-based), pour « 2 sur 4 ». */
  step: number;
  /** Nombre total de questions de la série. */
  total: number;
  /** Combien restent après celle-ci. */
  remaining: number;
}

/**
 * LA question à poser maintenant, ou null.
 * Aucune question tant que le socle n'est pas terminé : on ne superpose jamais une question à
 * l'installation initiale.
 */
export function nextProgressiveQuestion(state: ProgressiveState): ProgressivePick | null {
  if (!state.socleDone) return null;

  const total = PROGRESSIVE_ORDER.length;
  for (let i = 0; i < PROGRESSIVE_ORDER.length; i++) {
    const key = PROGRESSIVE_ORDER[i];
    if (state.answered[key]) continue;
    if (state.snoozed[key]) continue;
    if (!TRIGGER[key](state.events)) continue;

    const remaining = PROGRESSIVE_ORDER.filter((k) => k !== key && !state.answered[k]).length;
    return { question: PROGRESSIVE_QUESTIONS[key], step: i + 1, total, remaining };
  }
  return null;
}

/** Reste-t-il des questions de PROFIL sans réponse ? (→ le profil est affiché comme provisoire) */
export function profileStillProvisional(answered: Record<string, boolean>): boolean {
  return PROGRESSIVE_ORDER.some((k) => PROGRESSIVE_QUESTIONS[k].affectsProfile && !answered[k]);
}
