/**
 * GLOSSAIRE — source unique des explications de vocabulaire propriétaire.
 *
 * Règle : chaque notion est expliquée LÀ OÙ elle apparaît, en 2 phrases maximum, via la pastille
 * `<InfoDot term="…" />`. Le texte vit ICI et nulle part ailleurs : corriger une formulation la
 * corrige partout (avant, chaque écran embarquait sa propre variante, d'où les incohérences
 * « réserve » / « marge » / « matelas »).
 *
 * LEXIQUE FIGÉ — trois notions distinctes qu'on ne mélange plus jamais :
 *   • marge de sécurité → le minimum que tu veux garder sur tes comptes courants ;
 *   • réservé           → l'argent de ton Relyka que tu mets de côté via « Conserver » ;
 *   • matelas de sécurité → ton épargne, exprimée en mois de DÉPENSES qu'elle couvre.
 * Le mot « réserve » employé seul est banni : il a longtemps désigné les deux dernières.
 */

export type GlossaryTerm =
  | 'relyka'
  | 'marge_securite'
  | 'reserve'
  | 'matelas'
  | 'point_bas'
  | 'recurrent'
  | 'variable'
  | 'enveloppe_variable'
  | 'maj_solde'
  | 'profil_financier'
  | 'epargner'
  | 'investir'
  | 'confort'
  | 'conserver'
  | 'compte_principal'
  | 'confiance';

export interface GlossaryEntry {
  /** Titre de la fiche (le terme, tel qu'on l'écrit dans l'app). */
  title: string;
  /** 2 phrases maximum. Tutoiement. Jamais de définition circulaire. */
  text: string;
  /** Précision facultative affichée en plus petit (ex. conséquence si non renseigné). */
  hint?: string;
  /** Clé de couleur sémantique de useAppColors (accent de la fiche). */
  color?: 'green' | 'blue' | 'violet' | 'orange' | 'teal' | 'yellow';
  /** Icône Ionicons. */
  icon?: string;
}

export const GLOSSARY: Record<GlossaryTerm, GlossaryEntry> = {
  relyka: {
    title: 'Ton Relyka',
    text: "C'est ce qu'il te reste vraiment à décider ce mois-ci, une fois tout ce qui est déjà prévu couvert : tes charges, tes dépenses habituelles, ce que tu as mis de côté et ta marge de sécurité.",
    hint: "Ce n'est pas ce qui restera sur ton compte à la fin du mois : ta marge de sécurité, elle, y reste en plus.",
    color: 'green',
    icon: 'sparkles-outline',
  },
  marge_securite: {
    title: 'Ta marge de sécurité',
    text: "C'est le montant que tu veux avoir au minimum sur tes comptes courants à la fin du mois. Tu la fixes toi-même, et l'app te dit ce que tu peux utiliser avant d'y toucher.",
    hint: "Elle reste sur ton compte : l'app ne la déplace pas et ne la place nulle part.",
    color: 'blue',
    icon: 'lock-closed-outline',
  },
  reserve: {
    title: 'Réservé',
    text: "C'est de l'argent de ton Relyka que tu as choisi de garder pour plus tard, via la recommandation « Conserver » ou une réservation. Il reste sur ton compte mais n'est plus compté comme disponible.",
    hint: 'Tu peux le libérer à tout moment.',
    color: 'blue',
    icon: 'hourglass-outline',
  },
  matelas: {
    title: 'Ton matelas de sécurité',
    text: "C'est le nombre de mois que ton épargne te permettrait de tenir si tes rentrées d'argent s'arrêtaient. On divise ton épargne par tes dépenses d'un mois : tes charges récurrentes (loyer, abonnements, crédits) et ton budget de dépenses variables.",
    hint: "Rien à voir avec la marge de sécurité : le matelas, c'est ton épargne ; la marge, c'est le minimum que tu gardes sur ton compte courant.",
    color: 'green',
    icon: 'shield-checkmark-outline',
  },
  point_bas: {
    title: 'Le point bas',
    text: "C'est le moment du mois où ton compte courant descend le plus bas, une fois toutes tes opérations prévues passées. Ton Relyka part de là, pas de ton solde d'aujourd'hui.",
    hint: 'Ta prochaine rentrée d\'argent le fera remonter.',
    color: 'orange',
    icon: 'trending-down-outline',
  },
  recurrent: {
    title: 'Une dépense récurrente',
    text: "C'est une opération qui revient à chaque période : loyer, abonnement, salaire, assurance. Tu ne la saisis qu'une fois, l'app la reconduit toute seule.",
    color: 'blue',
    icon: 'repeat-outline',
  },
  variable: {
    title: 'Une dépense variable',
    text: "C'est ce qui change d'un mois à l'autre : courses, restaurants, loisirs, imprévus. Impossible à prévoir à l'unité, alors l'app en estime une enveloppe mensuelle.",
    color: 'orange',
    icon: 'cart-outline',
  },
  enveloppe_variable: {
    title: 'Ton enveloppe variable',
    text: "C'est ce que tu dépenses habituellement en courses, loisirs et imprévus sur un mois. L'app la met de côté dans ses calculs pour ne pas te présenter comme disponible de l'argent que tu vas dépenser de toute façon.",
    hint: "Elle part de ton estimation, puis se base sur tes dépenses réelles dès que tu as deux mois d'historique.",
    color: 'orange',
    icon: 'basket-outline',
  },
  maj_solde: {
    title: 'Mettre à jour ton solde',
    text: "Tu recopies le solde affiché par ta banque, et l'app place l'écart en dépenses variables. C'est le geste le plus rapide pour que tous tes chiffres redeviennent justes.",
    hint: 'Une fois par semaine suffit.',
    color: 'green',
    icon: 'refresh-outline',
  },
  profil_financier: {
    title: 'Ton profil financier',
    text: "Il décide des proportions entre les 4 recommandations — épargner, investir, confort, conserver — mais jamais des montants. Il évolue tout seul dès que ta situation réelle change.",
    color: 'violet',
    icon: 'person-circle-outline',
  },
  // ⚠️ Une fiche définit une NOTION, jamais l'état du compte de celui qui la lit. Ces deux-là
  // décrivaient la situation d'un utilisateur sans matelas (« cette part reste à 0 % tant que… ») :
  // hors sujet, et carrément à côté de la plaque pour quelqu'un dont l'épargne est déjà solide.
  // Le « pourquoi c'est à 0 ce mois-ci » se dit sur la carte concernée, pas dans le glossaire.
  epargner: {
    title: 'Épargner',
    text: "Mettre de l'argent de côté sur un compte d'épargne, disponible dès que tu en as besoin. C'est ce qui construit ton matelas de sécurité.",
    color: 'green',
    icon: 'shield-outline',
  },
  investir: {
    title: 'Investir',
    text: "Placer une partie de ton argent pour le faire travailler sur le long terme, en acceptant que sa valeur varie à la hausse comme à la baisse.",
    hint: 'Simulation indicative. Investir comporte des risques de perte en capital. Relyka ne fournit pas de conseil en investissement.',
    color: 'violet',
    icon: 'trending-up-outline',
  },
  confort: {
    title: 'Confort',
    text: "C'est la part totalement libre de ton Relyka, une fois tes dépenses habituelles déjà couvertes. Tu en fais ce que tu veux, sans culpabiliser.",
    color: 'orange',
    icon: 'sparkles-outline',
  },
  conserver: {
    title: 'Conserver',
    text: "Garder cet argent sur ton compte courant sans le dépenser ni le placer, pour amortir le début du mois suivant ou un imprévu. Il devient du « réservé ».",
    color: 'blue',
    icon: 'hourglass-outline',
  },
  compte_principal: {
    title: 'Ton compte principal',
    text: "C'est le compte courant sur lequel arrivent tes revenus et partent tes charges. Il sert de compte proposé par défaut à la saisie — tu peux en ajouter d'autres et changer lequel est principal.",
    color: 'blue',
    icon: 'wallet-outline',
  },
  confiance: {
    title: '« À jour » ou « estimation »',
    /* Ni « fourchette » (le mot décrit l'affichage, pas l'enjeu), ni la mise à jour du solde comme
       seul remède : noter ses dépenses affine déjà le Relyka, et c'est le geste le plus simple. */
    text: "Plus le temps passe sans que tu notes tes dépenses, moins Relyka peut être précis : il annonce alors un ordre de grandeur plutôt qu'un chiffre au centime. Note tes dépenses au fil de l'eau — ou mets ton solde à jour — et ton Relyka redevient net.",
    color: 'yellow',
    icon: 'help-circle-outline',
  },
};

/** Entrée du glossaire, ou null si le terme est inconnu (jamais d'exception à l'affichage). */
export function glossaryEntry(term: GlossaryTerm | string): GlossaryEntry | null {
  return (GLOSSARY as Record<string, GlossaryEntry>)[term] ?? null;
}
