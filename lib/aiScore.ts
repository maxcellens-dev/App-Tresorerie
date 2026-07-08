// Score de santé financière PRÉ-CALCULÉ pour l'instantané Conseils IA — fonction PURE testable.
// But : un score TRANSPARENT et STABLE d'un mois sur l'autre (le modèle le recopie, il ne l'invente
// pas). Chaque sous-score a des seuils documentés ; le global est la moyenne PONDÉRÉE des sous-scores
// disponibles (le cash-flow s'exclut si l'historique est trop court → repondération).
//
// Choix clés (issus de tests terrain) :
//  • un patrimoine investi déjà constitué compte, même si la mise de côté du mois est à 0 % ;
//  • l'ENDETTEMENT se juge sur la capacité RÉELLE à payer (revenus récurrents réels), pas sur un
//    revenu de référence sous-estimé par un historique court → sinon score injustement sévère ;
//  • un creux de trésorerie n'est qu'UN sous-score (15 %) : il ne fait pas plonger tout le score
//    quand la réserve d'épargne est confortable.

export interface ScorePart { label: string; score: number | null; weight: number; why: string }
export interface HealthScore { global: number; parts: ScorePart[] }

/**
 * Engagements mensuels consolidés, SANS double-compte. Buckets choisis pour ne pas se recouper :
 *  • charges récurrentes directes (hors crédits) ;
 *  • crédits sur comptes PERSO (impact 100 %) ;
 *  • contribution au foyer (couvre les crédits/charges JOINTS, comptés à part < 100 %).
 * La part JOINTE des crédits est exposée pour information (déjà dans la contribution) mais PAS
 * ajoutée au total.
 */
export function deriveEngaged(
  credits: { impactPct: number; monthly: number }[],
  fixedMonthly: number,
  jointContributionMonthly: number,
) {
  const ownCredits = credits.reduce((t, cr) => t + (cr.impactPct >= 100 ? cr.monthly : 0), 0);
  const jointCredits = credits.reduce((t, cr) => t + (cr.impactPct > 0 && cr.impactPct < 100 ? cr.monthly : 0), 0);
  return { fixedMonthly, ownCredits, jointCredits, total: fixedMonthly + ownCredits + jointContributionMonthly };
}

export interface ScoreInput {
  /** Revenu de référence (ratios). 0 si inconnu. */
  income: number;
  /** Revenus récurrents réels (capacité à payer les engagements) — souvent > référence. */
  realIncome: number;
  /** Épargne totale. */
  savings: number;
  /** Patrimoine investi. */
  invested: number;
  /** Engagements mensuels consolidés à charge (sans double-compte). */
  engagedMonthly: number;
  /** Mise de côté planifiée (épargne + invest) / mois. */
  setAsideMonthly: number;
  /** Point bas du solde courant projeté (sur tout l'horizon disponible). */
  projectionMin: number | null;
  /** Marge de sécurité. */
  margin: number;
  /** Solde net moyen des mois COMPLETS fiables (hors exceptionnels, hors 1ᵉʳ mois). */
  avgNet: number | null;
  /** Nombre de mois complets fiables ayant servi à avgNet. */
  reliableMonths: number;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export function computeHealthScore(inp: ScoreInput): HealthScore {
  const income = inp.income > 0 ? inp.income : 0;
  const parts: ScorePart[] = [];

  // SÉCURITÉ (25 %) — mois de revenus couverts par l'épargne.
  if (income > 0) {
    const r = inp.savings / income;
    const s = r >= 6 ? 100 : r >= 3 ? 70 + ((r - 3) / 3) * 30 : r >= 1 ? 40 + ((r - 1) / 2) * 30 : r * 40;
    parts.push({ label: 'Sécurité', score: Math.round(clamp(s)), weight: 25, why: `épargne ≈ ${r.toFixed(1)} mois de revenus` });
  }

  // ENDETTEMENT (20 %) — engagements / capacité RÉELLE à payer (revenus récurrents réels).
  const denom = Math.max(inp.realIncome, income);
  if (denom > 0 && inp.engagedMonthly > 0) {
    const ratio = inp.engagedMonthly / denom;
    const s = ratio <= 0.35 ? 100
      : ratio <= 0.6 ? 100 - ((ratio - 0.35) / 0.25) * 40
      : ratio <= 0.9 ? 60 - ((ratio - 0.6) / 0.3) * 40
      : 20 - (ratio - 0.9) * 100;
    parts.push({ label: 'Endettement', score: Math.round(clamp(s)), weight: 20, why: `engagements ≈ ${Math.round(ratio * 100)} % des revenus réels` });
  }

  // CASH-FLOW (20 %) — excédent mensuel des mois fiables. Historique < 2 mois → « trop tôt » (exclu).
  if (income > 0) {
    if (inp.reliableMonths >= 2 && inp.avgNet != null) {
      const rate = inp.avgNet / income;
      const s = rate >= 0.15 ? 100 : rate >= 0 ? 40 + (rate / 0.15) * 60 : 40 + rate * 200;
      parts.push({ label: 'Cash-flow', score: Math.round(clamp(s)), weight: 20, why: `excédent moyen ≈ ${Math.round(rate * 100)} % du revenu` });
    } else {
      parts.push({ label: 'Cash-flow', score: null, weight: 20, why: 'historique trop court pour juger' });
    }
  }

  // INVESTISSEMENT (20 %) — patrimoine investi déjà constitué + effort de mise de côté.
  if (income > 0) {
    const years = inp.invested / (income * 12);
    const base = years >= 2 ? 90 : years >= 1 ? 70 + (years - 1) * 20 : years >= 0.5 ? 50 + (years - 0.5) * 40 : years * 100;
    const bonus = Math.min(10, (inp.setAsideMonthly / income) * 100 * 0.67);
    parts.push({ label: 'Investissement', score: Math.round(clamp(base + bonus)), weight: 20, why: `investi ≈ ${years.toFixed(1)} an(s) de revenu` });
  }

  // PROJECTION (15 %) — trajectoire du solde courant vs marge (point bas sur tout l'horizon).
  if (inp.projectionMin != null && inp.margin > 0) {
    const ratio = inp.projectionMin / inp.margin;
    const s = ratio >= 1 ? 100 : ratio >= 0 ? 40 + ratio * 40 : 40 + ratio * 40;
    parts.push({ label: 'Projection', score: Math.round(clamp(s)), weight: 15, why: `point bas projeté ≈ ${Math.round(ratio * 100)} % de la marge` });
  }

  const active = parts.filter((x) => x.score != null);
  const totW = active.reduce((t, x) => t + x.weight, 0);
  const global = totW > 0 ? Math.round(active.reduce((t, x) => t + (x.score as number) * x.weight, 0) / totW) : 0;
  return { global, parts };
}
