/**
 * FIABILITÉ DU PROFIL — « à quel point Relyka sait-il de quoi il parle ? »
 * ────────────────────────────────────────────────────────────────────────
 *
 * Le profil se déduit des données saisies. Deux utilisateurs dans la MÊME situation réelle peuvent
 * donc tomber dans deux paliers différents si l'un a renseigné ses charges et l'autre non. Ce n'est
 * pas un défaut du classement : c'est la nature d'une mesure. Ce qui serait un défaut, c'est de ne
 * pas le dire.
 *
 * ── UNE NOTION STRICTEMENT INDÉPENDANTE ─────────────────────────────────────────────────────────
 * La fiabilité ne déplace JAMAIS un palier. Si elle le faisait, on aurait deux moteurs de profil
 * dont l'un serait caché, et le palier cesserait d'être reproductible. Elle dit seulement sur quoi
 * le classement repose — et surtout ce qu'il manque pour qu'il repose sur mieux.
 *
 * ── TROIS NIVEAUX, ET UNE RÈGLE D'ÉCRITURE ──────────────────────────────────────────────────────
 * Jamais de badge nu. Chaque niveau porte SES CAUSES, et chaque cause porte LE GESTE qui la lève.
 * « Profil estimé » tout seul est une inquiétude sans issue ; « ajoute tes charges récurrentes »
 * est une action. C'est la différence entre signaler un doute et aider quelqu'un.
 *
 *   🟢 fiable     — les trois piliers sont là : revenu constaté, épargne connue, charges connues,
 *                   et assez d'historique pour que les moyennes veuillent dire quelque chose ;
 *   🟡 estimé     — rien ne manque vraiment, mais quelque chose est deviné ou trop récent ;
 *   🔴 incomplet  — une donnée STRUCTURANTE manque : le palier affiché peut être franchement faux.
 *
 * ⚠️ ET AUCUNE CONSÉQUENCE MÉCANIQUE, NULLE PART. Cet en-tête affirmait que le moteur de
 * recommandations plafonnait l'investissement quand le profil repose sur des données incomplètes.
 * Ce n'est plus vrai : ce plafond (`applyReliabilityBounds`) a été retiré, précisément pour que la
 * fiabilité ne devienne pas un second moteur de décision invisible depuis l'échelle
 * (cf. lib/finance/recoMode, qui documente ce qui borne — ou non — la répartition). Laisser la
 * promesse dans ce fichier,
 * c'était décrire un garde-fou qui n'existe plus — le genre de commentaire qu'on finit par croire.
 * Ce que l'app ne sait pas se DIT, avec le geste qui le comble. Rien d'autre.
 */

export type ProfileReliabilityLevel = 'reliable' | 'estimated' | 'incomplete';

/** Ton sémantique — les écrans le traduisent dans LEUR palette (jamais de couleur en dur ici). */
export type ProfileReliabilityTone = 'good' | 'warn' | 'bad';

export interface ProfileReliabilityInputs {
  /** Revenu mensuel de référence constaté (0 = rien de détecté). */
  avgMonthlyIncome: number;
  /** D'où vient la rentrée d'argent attendue : déclarée en récurrente, devinée, ou introuvable. */
  incomeSource: 'explicit' | 'inferred' | 'none';
  /** Au moins un compte d'épargne connu de l'app. */
  hasSavingsAccount: boolean;
  /** Au moins une charge récurrente saisie. */
  hasRecurringExpenses: boolean;
  /** Base réellement utilisée pour le matelas (cf. lib/finance/securityCushion). */
  cushionBase: 'expenses' | 'income' | null;
  /** Référence des dépenses variables : historique réel, estimation d'accueil, ou rien. */
  variableEnvelopeSource: 'history' | 'onboarding' | 'none';
  /** Mois COMPLETS d'utilisation de l'app (0 = arrivé ce mois-ci). */
  monthsOfHistory: number;
  /** Jours depuis la dernière vérification de solde (null = jamais vérifié / inconnu). */
  daysSinceVerification: number | null;
}

export interface ProfileReliabilityGap {
  id: string;
  /** Ce qui manque, du point de vue de l'utilisateur. */
  label: string;
  /** Le geste qui le lève, à l'impératif. */
  action: string;
  /** Route de l'app où le faire (facultatif : certains manques se comblent avec le temps). */
  route?: string;
  /** `blocking` = le palier peut être franchement faux ; `weakening` = il est juste moins sûr. */
  severity: 'blocking' | 'weakening';
}

export interface ProfileReliability {
  level: ProfileReliabilityLevel;
  tone: ProfileReliabilityTone;
  /** Titre court, affichable tel quel. */
  title: string;
  /** Une phrase qui dit sur quoi le profil repose — jamais un jugement sur l'utilisateur. */
  summary: string;
  /** Les manques, du plus structurant au plus anecdotique. Vide quand tout est là. */
  gaps: ProfileReliabilityGap[];
}

/** Au-delà, un solde jamais confirmé fait douter de tout ce qui en découle. */
const STALE_VERIFICATION_DAYS = 45;

/** En dessous, les moyennes portent encore trop peu de mois pour être des repères. */
const YOUNG_HISTORY_MONTHS = 2;

export function computeProfileReliability(i: ProfileReliabilityInputs): ProfileReliability {
  const gaps: ProfileReliabilityGap[] = [];

  /* ── CE QUI PEUT RENDRE LE PALIER FAUX ──────────────────────────────────────────────────────
     Ces trois manques ne dégradent pas la précision : ils changent le résultat. Sans revenu, rien
     n'est calculable ; sans compte d'épargne, le matelas vaut zéro alors qu'il existe peut-être
     ailleurs ; sans charge, le dénominateur du matelas est amputé du loyer — et le matelas gonfle. */
  if (!(i.avgMonthlyIncome > 0)) {
    gaps.push({
      id: 'income',
      label: 'Aucune rentrée d’argent détectée',
      action: 'Enregistre ton salaire (ou ta pension) en opération récurrente.',
      route: '/(tabs)/transactions',
      severity: 'blocking',
    });
  }
  if (!i.hasSavingsAccount) {
    gaps.push({
      id: 'savings_account',
      label: 'Aucun compte d’épargne connu',
      action: 'Ajoute ton livret : sans lui, ta réserve est comptée à zéro.',
      route: '/(tabs)/comptes',
      severity: 'blocking',
    });
  }
  if (!i.hasRecurringExpenses) {
    gaps.push({
      id: 'recurring_expenses',
      label: 'Tes charges fixes ne sont pas renseignées',
      action: 'Saisis ton loyer et tes abonnements en récurrents.',
      route: '/(tabs)/transactions',
      severity: 'blocking',
    });
  }

  /* ── CE QUI REND LE PALIER MOINS SÛR ────────────────────────────────────────────────────────
     Ici, rien n'est faux : quelque chose est deviné, ou trop récent pour valoir moyenne. */
  if (i.incomeSource === 'inferred' && i.avgMonthlyIncome > 0) {
    gaps.push({
      id: 'income_inferred',
      label: 'Ta rentrée d’argent est déduite de ton historique',
      action: 'Enregistre-la en récurrente pour qu’elle cesse d’être une estimation.',
      route: '/(tabs)/transactions',
      severity: 'weakening',
    });
  }
  // Le matelas mesuré sur le REVENU faute de dépenses connues : prudent, mais approximatif.
  if (i.cushionBase === 'income' && i.hasRecurringExpenses) {
    gaps.push({
      id: 'cushion_on_income',
      label: 'Ta réserve est mesurée sur ton revenu, pas sur tes dépenses',
      action: 'Complète tes charges récurrentes pour l’affiner.',
      route: '/(tabs)/transactions',
      severity: 'weakening',
    });
  }
  /* Une troisième base existait — la tranche de revenu DÉCLARÉE au questionnaire d'accueil — avec
     son propre manque (« ta réserve repose sur une estimation »). Ce repli a été retiré du matelas
     avec le questionnaire : la branche ne pouvait plus se déclencher, et elle décrivait à qui la
     lisait un état que l'app ne sait plus produire. */
  if (i.variableEnvelopeSource !== 'history') {
    gaps.push({
      id: 'variable_estimated',
      label: 'Tes dépenses variables sont une estimation',
      action: 'Elles s’ajusteront toutes seules après deux mois de saisies.',
      severity: 'weakening',
    });
  }
  if (i.monthsOfHistory < YOUNG_HISTORY_MONTHS) {
    gaps.push({
      id: 'young',
      label: 'Peu d’historique pour l’instant',
      action: 'Ton profil se stabilisera au fil des mois.',
      severity: 'weakening',
    });
  }
  if (i.daysSinceVerification != null && i.daysSinceVerification > STALE_VERIFICATION_DAYS) {
    gaps.push({
      id: 'stale_balance',
      label: 'Tes soldes n’ont pas été confirmés depuis un moment',
      action: 'Mets à jour un solde : tout le calcul en dépend.',
      route: '/(tabs)/comptes/solde',
      severity: 'weakening',
    });
  }

  const blocking = gaps.filter((g) => g.severity === 'blocking');

  if (blocking.length > 0) {
    return {
      level: 'incomplete',
      tone: 'bad',
      title: 'Profil incomplet',
      /* On NOMME ce qui manque dès la phrase de résumé : « incomplet » sans objet se lit comme un
         reproche, alors que c'est une information sur l'app, pas sur la personne. */
      summary: blocking.length === 1
        ? `${blocking[0].label} : ton profil peut changer nettement une fois cette donnée ajoutée.`
        : 'Plusieurs données manquent : ton profil peut changer nettement une fois complétées.',
      gaps,
    };
  }

  if (gaps.length > 0) {
    return {
      level: 'estimated',
      tone: 'warn',
      title: 'Profil estimé',
      summary: i.monthsOfHistory < YOUNG_HISTORY_MONTHS
        ? 'Relyka dispose de peu d’historique : ton profil peut encore évoluer rapidement.'
        : 'Une partie du calcul repose sur des estimations : ton profil peut encore bouger.',
      gaps,
    };
  }

  return {
    level: 'reliable',
    tone: 'good',
    title: 'Profil fiable',
    summary: `Relyka dispose de tes comptes, de tes charges et de ${
      i.monthsOfHistory >= 6 ? 'plus de 6 mois' : `${i.monthsOfHistory} mois`
    } de données réelles.`,
    gaps: [],
  };
}

/**
 * Mois COMPLETS écoulés depuis l'arrivée de l'utilisateur.
 *
 * Le mois d'inscription ne compte pas : il est presque toujours partiel (on arrive le 12, le 26…)
 * et ne dit rien d'un rythme mensuel. Même règle que le revenu de référence
 * (cf. lib/finance/incomeAverage) — deux façons de compter l'ancienneté finiraient par diverger.
 */
export function monthsOfHistorySince(createdAt: string | null | undefined, today: Date = new Date()): number {
  if (!createdAt) return 0;
  const c = new Date(String(createdAt).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(c.getTime())) return 0;
  const months = (today.getFullYear() - c.getFullYear()) * 12 + (today.getMonth() - c.getMonth());
  return Math.max(0, months - 1);
}
