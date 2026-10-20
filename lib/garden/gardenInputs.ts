/**
 * Des données RÉELLES de l'app aux entrées du moteur de l'arbre (lib/garden/treeState).
 *
 * Fonction pure : elle ne lit que des valeurs déjà calculées ailleurs, par les moteurs existants.
 *   - comptes courants, marge, épargne, placements, virements récurrents : `pilotage_data` ;
 *   - mois de secours et leur référence : `computeSecurityCushion`, avec EXACTEMENT les mêmes
 *     entrées que la page Profil financier et le moteur de profil (sinon l'arbre et le profil
 *     annonceraient deux matelas différents) ;
 *   - gains des placements : `computeInvestmentGains` (plus/moins-values marquées) ;
 *   - confort du mois : la recommandation « Confort » telle que le tableau de bord l'affiche ;
 *   - série : l'état de gamification ;
 *   - capital restant dû : `computeAmortization(...).crdAtDate`, avec les événements du crédit.
 *
 * ── LE SEUL CHOIX PROPRE AU JARDIN : QU'EST-CE QU'UN CRÉDIT CHER ? ───────────────────────────────
 * L'app ne connaît pas de « crédit renouvelable » : un crédit a un type (immobilier, consommation,
 * auto, autre) et un taux. Les ronces se dessinent donc à partir du TAUX, au-dessus de
 * `EXPENSIVE_CREDIT_RATE` — un seuil d'affichage, qui ne change aucun calcul financier.
 */
import { computeSecurityCushion } from '../finance/securityCushion';
import type { GardenCredit, GardenInputs } from './treeState';

/** Taux annuel (en %) à partir duquel un crédit est dessiné en ronces plutôt qu'en cabane. */
export const EXPENSIVE_CREDIT_RATE = 10;

/** Sous-ensemble de `PilotageData` dont l'arbre a besoin. */
export interface PilotageForGarden {
  current_checking_balance?: number | null;
  safety_margin_amount?: number | null;
  current_savings?: number | null;
  monthly_essential_expenses?: number | null;
  has_recurring_expenses?: boolean | null;
  avg_monthly_income?: number | null;
  total_invested?: number | null;
  monthly_savings_planned?: number | null;
  monthly_invest_planned?: number | null;
}

export interface CreditForGarden {
  id: string;
  /** Taux annuel en %. */
  rateAnnual: number;
  /** Capital emprunté. */
  principal: number;
  /** Capital restant dû aujourd'hui. */
  remaining: number;
}

export interface GardenSources {
  pilotage: PilotageForGarden;
  /** Somme des plus/moins-values des placements (computeInvestmentGains().gains). */
  investmentGains: number;
  /** Relyka du mois (€) : remplit l'arrosoir. */
  relyka?: number;
  /** Nombre de placements (comptes d'investissement non vides). */
  investmentCount?: number;
  /** Montant de la recommandation « Confort » du mois (0 s'il n'y en a pas). */
  enjoyAmount: number;
  streakWeeks: number;
  credits: CreditForGarden[];
}

const num = (v: unknown) => (Number.isFinite(v as number) ? (v as number) : 0);

export function creditKind(rateAnnual: number): GardenCredit['kind'] {
  return num(rateAnnual) >= EXPENSIVE_CREDIT_RATE ? 'expensive' : 'healthy';
}

export function buildGardenInputs(s: GardenSources): GardenInputs {
  const p = s.pilotage;
  const cushion = computeSecurityCushion({
    availableSavings: num(p.current_savings),
    monthlyEssentialExpenses: num(p.monthly_essential_expenses),
    recurringExpensesKnown: !!p.has_recurring_expenses,
    avgMonthlyIncome: num(p.avg_monthly_income),
  });
  const invested = Math.max(0, num(p.total_invested));
  return {
    currentBalance: num(p.current_checking_balance),
    minimumToKeep: Math.max(0, num(p.safety_margin_amount)),
    relyka: s.relyka,
    monthlyReference: cushion.reference,
    securityMonths: cushion.months,
    investedValue: invested,
    // Versements = valeur − gains : le moteur de l'arbre ne lit que leur différence (les gains).
    investedContributed: invested - num(s.investmentGains),
    investmentCount: s.investmentCount,
    enjoyThisMonth: Math.max(0, num(s.enjoyAmount)),
    recurringSavingsMonthly: Math.max(0, num(p.monthly_savings_planned)),
    recurringInvestMonthly: Math.max(0, num(p.monthly_invest_planned)),
    // Aucune donnée existante ne compte les mois d'épargne d'affilée : l'arrosage régulier se
    // déduit donc des seuls virements récurrents (on n'invente pas de mesure).
    consecutiveSavingMonths: 0,
    streakWeeks: Math.max(0, num(s.streakWeeks)),
    credits: s.credits.map((c) => ({ id: c.id, kind: creditKind(c.rateAnnual), remaining: Math.max(0, num(c.remaining)), borrowed: Math.max(0, num(c.principal)) })),
  };
}
