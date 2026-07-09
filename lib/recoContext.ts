/**
 * recoContext — phrase motivante affichée sous chaque recommandation pour donner envie de l'utiliser.
 * - Investir : projection à 10/20 ans (estimation sur la reco si rien investi, sinon basée sur le réel).
 * - Épargner : invite à créer un projet d'épargne.
 * - Conserver : effet sur le SOLDE DE FIN DE MOIS projeté (avec / sans la somme), pas le solde actuel,
 *   + marge cumulée si on répète chaque mois.
 * Hypothèse de rendement : 7 %/an (intérêts composés mensuels).
 */
import { CURRENCY_SYMBOL } from './currency';
import type { RecoType } from './recommendationEngine';

const ANNUAL_RATE = 0.07; // 7 %/an

/** Valeur future : capital initial + versements mensuels, intérêts composés mensuels. */
function futureValue(principal: number, monthly: number, years: number, annualRate = ANNUAL_RATE): number {
  const r = annualRate / 12;
  const n = years * 12;
  const fvPrincipal = principal * Math.pow(1 + r, n);
  const fvMonthly = r === 0 ? monthly * n : monthly * ((Math.pow(1 + r, n) - 1) / r);
  return fvPrincipal + fvMonthly;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('fr-FR');
}

export interface RecoFinancials {
  /** Total déjà placé sur les comptes d'investissement. */
  totalInvested: number;
  /** Solde courant actuel. */
  currentChecking: number;
  /**
   * Solde courant PROJETÉ en fin de mois courant (même trajectoire que l'écran Projection :
   * revenus − dépenses habituelles − virements planifiés). Sert de base à la reco « Conserver »
   * (bien plus juste que le solde actuel). Optionnel : repli sur `currentChecking` si absent.
   */
  projectedEndChecking?: number;
}

/**
 * Retourne la phrase contextuelle (ou null si non pertinent / montant nul).
 * `amount` = montant ACTIONNABLE de la reco (borne basse quand les montants sont en fourchette).
 */
export function getRecoContextText(type: RecoType, amount: number, fin: RecoFinancials): string | null {
  const S = CURRENCY_SYMBOL;
  if (!(amount > 0)) return null;

  if (type === 'invest') {
    const monthly = amount; // la reco est un montant mensuel
    if (fin.totalInvested <= 0) {
      const y10 = futureValue(0, monthly, 10);
      const y20 = futureValue(0, monthly, 20);
      return `💡 Et si tu te lançais ? ${fmt(monthly)} ${S}/mois à 7 %/an, ça pourrait faire ~${fmt(y10)} ${S} dans 10 ans et ~${fmt(y20)} ${S} dans 20 ans.`;
    }
    // Projection en RÉPÉTANT le versement chaque mois (avec l'existant comme capital de départ) —
    // bien plus parlant que la seule croissance de l'existant.
    const y10 = futureValue(fin.totalInvested, monthly, 10);
    const y20 = futureValue(fin.totalInvested, monthly, 20);
    return `💡 En investissant ${fmt(monthly)} ${S}/mois (en plus de tes ${fmt(fin.totalInvested)} ${S} déjà placés), tu pourrais avoir ~${fmt(y10)} ${S} dans 10 ans et ~${fmt(y20)} ${S} dans 20 ans, à 7 %/an.`;
  }

  if (type === 'save') {
    return `💡 Et si tu créais un projet d'épargne ? Donne un cap à ces ${fmt(amount)} ${S} (voyage, apport, sécurité…) et vois-les grandir mois après mois.`;
  }

  if (type === 'keep') {
    // Effet sur le solde de FIN DE MOIS projeté (pas le solde actuel) : conserver cette somme la
    // laisse sur le compte, la dépenser la retire d'autant → on montre les deux (écart = la somme).
    const endWith = fin.projectedEndChecking ?? fin.currentChecking;
    const endWithout = endWith - amount;
    const sixMonths = amount * 6;
    return `💡 Conserver ${fmt(amount)} ${S}/mois te laisse ~${fmt(amount)} ${S} de plus sur ton compte en fin de mois : ~${fmt(endWith)} ${S} au lieu de ~${fmt(endWithout)} ${S} si tu la dépensais.`;
  }

  return null;
}
