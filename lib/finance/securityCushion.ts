/**
 * MATELAS DE SÉCURITÉ — source unique de vérité.
 * ──────────────────────────────────────────────
 * Combien de temps l'utilisateur peut-il tenir SANS RENTRÉE D'ARGENT, avec son épargne disponible ?
 *
 *     mois_de_sécurité = épargne_disponible ÷ dépenses_essentielles_mensuelles
 *
 * ── POURQUOI LES DÉPENSES, ET PLUS LE REVENU ────────────────────────────────────────────────────
 * La base était le REVENU. C'est la formulation du questionnaire (« si tes revenus s'arrêtaient
 * demain… »), mais c'est une mauvaise mesure de la réalité : ce qu'il faut couvrir quand le revenu
 * s'arrête, ce n'est pas le revenu — c'est ce qu'on DÉPENSE pour vivre.
 *
 * L'écart n'est pas théorique. Quelqu'un qui gagne 4 000 € et vit avec 2 000 € tenait « 3 mois »
 * avec 12 000 € de côté ; il en tient en réalité 6. À l'inverse, quelqu'un qui gagne 1 800 € et en
 * dépense 1 750 € était crédité du même « 3 mois » qu'un autre bien plus à l'aise. Le matelas
 * gouverne le profil financier, les recommandations et la moitié des messages de l'app : cette
 * base-là décidait donc, en silence, de conseils opposés pour deux situations identiques.
 *
 * DÉPENSES ESSENTIELLES = charges récurrentes (loyer, abonnements, crédits, assurances…)
 *                       + enveloppe de dépenses variables du mois.
 * L'enveloppe variable suit le choix de l'utilisateur (estimation déclarée ou moyenne réellement
 * constatée — cf. `variable_envelope_mode`) : la même référence que celle qu'il voit dans son
 * budget du quotidien, jamais une seconde définition parallèle.
 *
 * ── LES REPLIS, DANS L'ORDRE ────────────────────────────────────────────────────────────────────
 *   1. dépenses essentielles mensuelles (la vraie mesure) ;
 *   2. à défaut, le revenu mensuel constaté — approximation prudente, mieux que rien ;
 *   3. rien d'exploitable → `null`, et les écrans MASQUENT la mention (jamais « 0 mois »).
 *
 * ⚠️ UN TROISIÈME REPLI A ÉTÉ RETIRÉ : la tranche de revenu DÉCLARÉE au questionnaire d'accueil
 * (Q3). Ce questionnaire n'existe plus — pour tout compte créé depuis, la réponse est vide, donc le
 * repli ne servait qu'aux comptes anciens. Et il ne s'activait que dans le seul cas où AUCUN revenu
 * n'est constaté… c'est-à-dire précisément celui où le classement, lui, refuse de conclure et rend
 * « Découverte ». L'app annonçait alors « ≈ 3,3 mois de sécurité » sous un profil qui dit ne rien
 * savoir : deux réponses à la même question, dont une tirée d'une case cochée il y a deux ans.
 */

export interface SecurityCushionInputs {
  /** Épargne disponible (épargne + éventuellement le courant, selon l'appelant). */
  availableSavings: number;
  /**
   * Dépenses ESSENTIELLES mensuelles : charges récurrentes + enveloppe variable retenue.
   * C'est la base de référence. 0/absent → on retombe sur le revenu.
   */
  monthlyEssentialExpenses?: number;
  /**
   * Les CHARGES RÉCURRENTES sont-elles connues ? (au moins une saisie)
   *
   * ⚠️ SANS ELLES, LE DÉNOMINATEUR EST UN LEURRE. Les « dépenses essentielles » valent
   * `charges récurrentes + enveloppe variable`. Tant qu'aucune charge n'est saisie, il ne reste que
   * l'enveloppe variable — et quelqu'un avec 3 000 € de côté, 400 €/mois de courses et un loyer de
   * 900 € que l'app ignore obtient « 7,5 mois de sécurité ». L'app se trompe, et se trompe avec
   * aplomb : c'est ce chiffre qui gouverne le profil financier.
   *
   * À `false`, on saute donc la base « dépenses » et on retombe sur le revenu — repli PRUDENT (il
   * sous-estime le matelas plutôt que de rassurer à tort). Absent = `true` : les appelants qui
   * connaissent la réponse doivent la donner, ceux qui ne la connaissent pas gardent l'ancien
   * comportement.
   */
  recurringExpensesKnown?: boolean;
  /** Revenu mensuel moyen constaté (0 = non détecté). Dernier repli quand les dépenses sont inconnues. */
  avgMonthlyIncome: number;
}

/** D'où vient le diviseur — sert à nommer la mesure honnêtement à l'écran. */
export type SecurityCushionBase = 'expenses' | 'income';

export interface SecurityCushion {
  /** Nombre de mois couverts, ou null si aucune base exploitable (→ ne rien afficher). */
  months: number | null;
  /** Montant mensuel utilisé comme diviseur. */
  reference: number;
  /** D'où vient la référence (« estimé » tant qu'on est sur le questionnaire). */
  base: SecurityCushionBase | null;
}

export function computeSecurityCushion(i: SecurityCushionInputs): SecurityCushion {
  const savings = Math.max(0, i.availableSavings);

  /* 1. LA vraie mesure : ce qu'il faut couvrir chaque mois pour continuer à vivre — et seulement
        si les charges récurrentes sont connues (cf. `recurringExpensesKnown`). Un total de dépenses
        amputé de son loyer n'est pas une mesure « imparfaite », c'est une mesure fausse dans le
        sens dangereux : elle gonfle le matelas. */
  const essential = Math.max(0, i.monthlyEssentialExpenses ?? 0);
  if (essential > 0 && i.recurringExpensesKnown !== false) {
    return { months: savings / essential, reference: essential, base: 'expenses' };
  }

  /* 2. Repli : le revenu. Sur un compte neuf, aucune charge récurrente n'est encore saisie — le
        matelas serait « infini », ce qui est bien pire que légèrement pessimiste. Le revenu étant
        toujours ≥ aux dépenses chez quelqu'un qui n'est pas en déficit, ce repli SOUS-ESTIME le
        matelas : il ne peut pas faire croire à une sécurité qui n'existe pas. */
  if (i.avgMonthlyIncome > 0) {
    return { months: savings / i.avgMonthlyIncome, reference: i.avgMonthlyIncome, base: 'income' };
  }

  return { months: null, reference: 0, base: null };
}

/** Phrase de provenance, à accoler au nombre de mois — l'utilisateur doit savoir ce qu'on divise. */
export function securityBaseLabel(base: SecurityCushionBase | null): string {
  if (base === 'expenses') return 'épargne ÷ tes dépenses mensuelles (charges + variables)';
  if (base === 'income') return 'épargne ÷ ton revenu mensuel, en attendant tes charges';
  return '';
}

/** Libellé générique et lisible : « moins d'1 mois », « 2,3 mois ». */
export function securityMonthsLabel(months: number): string {
  if (months < 0.75) return 'moins d’1 mois';
  if (months < 10) return `${months.toFixed(1).replace('.', ',').replace(',0', '')} mois`;
  return `${Math.round(months)} mois`;
}
