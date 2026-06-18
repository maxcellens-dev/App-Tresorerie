/**
 * recoContext — phrase motivante affichée sous chaque recommandation pour donner envie de l'utiliser.
 * - Investir : projection à 10/20 ans (estimation sur la reco si rien investi, sinon basée sur le réel).
 * - Épargner : invite à créer un projet d'épargne.
 * - Conserver : économie cumulée sur le compte courant (mois prochain + 6 mois si maintenu).
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
}

/** Retourne la phrase contextuelle (ou null si non pertinent / montant nul). */
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
    const y10base = futureValue(fin.totalInvested, 0, 10);
    const y10plus = futureValue(fin.totalInvested, monthly, 10);
    return `💡 Tes ${fmt(fin.totalInvested)} ${S} déjà investis pourraient devenir ~${fmt(y10base)} ${S} dans 10 ans à 7 %/an. En ajoutant ${fmt(monthly)} ${S}/mois : ~${fmt(y10plus)} ${S}.`;
  }

  if (type === 'save') {
    return `💡 Et si tu créais un projet d'épargne ? Donne un cap à ces ${fmt(amount)} ${S} (voyage, apport, sécurité…) et vois-les grandir mois après mois.`;
  }

  if (type === 'keep') {
    const nextMonth = fin.currentChecking + amount;
    const sixMonths = fin.currentChecking + amount * 6;
    return `💡 En conservant ${fmt(amount)} ${S}/mois, ton compte courant passerait de ${fmt(fin.currentChecking)} ${S} à ~${fmt(nextMonth)} ${S} le mois prochain, et ~${fmt(sixMonths)} ${S} dans 6 mois.`;
  }

  return null;
}
