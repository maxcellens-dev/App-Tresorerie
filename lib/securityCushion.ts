/**
 * MATELAS DE SÉCURITÉ — source unique de vérité.
 * ──────────────────────────────────────────────
 * Combien de temps l'utilisateur peut-il tenir SANS RENTRÉE D'ARGENT, avec son épargne disponible ?
 *
 * BASE = LE REVENU MENSUEL MOYEN (pas les dépenses). C'est la question du questionnaire (Q5 :
 * « si tes revenus s'arrêtaient demain… ») et la définition utilisée par le Reporting, les
 * recommandations, le Pouls et le moteur de profils P1–P5. Une seule formule partout :
 *
 *     mois_de_sécurité = épargne_disponible ÷ revenu_mensuel_de_référence
 *
 * Ordre de repli du revenu de référence (le premier disponible gagne) :
 *   1. revenu mensuel moyen constaté (6 mois d'historique, hors virements/régul) ;
 *   2. estimation du questionnaire (tranche de revenu Q3) tant qu'il n'y a pas d'historique ;
 *   3. dépenses mensuelles moyennes — dernier recours seulement (un utilisateur sans revenu détecté
 *      ni questionnaire : mieux vaut une base imparfaite que pas de matelas du tout).
 * Aucune base exploitable → `null` : les écrans MASQUENT alors la mention (jamais « 0 mois »).
 */

/** Bornes basses (prudentes) des tranches de revenu du questionnaire (Q3). */
const Q3_LOWER_BOUNDS: Record<string, number> = {
  'Moins de 1 500 €': 1200,
  'De 1 500 € à 2 500 €': 1800,
  'De 2 500 € à 4 000 €': 2800,
  'Plus de 4 000 €': 4200,
};

/** Revenu mensuel représentatif d'une tranche Q3 (borne basse prudente), ou 0 si inconnue. */
export function incomeFromQ3(q3: string | null | undefined): number {
  if (!q3) return 0;
  return Q3_LOWER_BOUNDS[q3] ?? 0;
}

export interface SecurityCushionInputs {
  /** Épargne disponible (épargne + éventuellement le courant, selon l'appelant). */
  availableSavings: number;
  /** Revenu mensuel moyen constaté (0 = non détecté). */
  avgMonthlyIncome: number;
  /** Tranche de revenu du questionnaire (repli quand l'historique est vide). */
  questionnaireQ3?: string | null;
  /** Dépenses mensuelles moyennes (dernier repli seulement). */
  avgMonthlyExpenses?: number;
}

export type SecurityCushionBase = 'income' | 'questionnaire' | 'expenses';

export interface SecurityCushion {
  /** Nombre de mois couverts, ou null si aucune base exploitable (→ ne rien afficher). */
  months: number | null;
  /** Montant mensuel utilisé comme diviseur. */
  reference: number;
  /** D'où vient la référence (pour l'affichage : « estimé » tant qu'on est sur le questionnaire). */
  base: SecurityCushionBase | null;
}

export function computeSecurityCushion(i: SecurityCushionInputs): SecurityCushion {
  const savings = Math.max(0, i.availableSavings);

  const income = i.avgMonthlyIncome > 0 ? i.avgMonthlyIncome : 0;
  if (income > 0) return { months: savings / income, reference: income, base: 'income' };

  const fromQuestionnaire = incomeFromQ3(i.questionnaireQ3);
  if (fromQuestionnaire > 0) {
    return { months: savings / fromQuestionnaire, reference: fromQuestionnaire, base: 'questionnaire' };
  }

  const expenses = i.avgMonthlyExpenses ?? 0;
  if (expenses > 0) return { months: savings / expenses, reference: expenses, base: 'expenses' };

  return { months: null, reference: 0, base: null };
}

/** Libellé générique et lisible : « moins d'1 mois », « 2,3 mois ». */
export function securityMonthsLabel(months: number): string {
  if (months < 0.75) return 'moins d’1 mois';
  if (months < 10) return `${months.toFixed(1).replace('.', ',').replace(',0', '')} mois`;
  return `${Math.round(months)} mois`;
}
