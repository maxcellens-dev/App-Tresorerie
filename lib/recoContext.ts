/**
 * recoContext — phrase motivante affichée sous chaque recommandation pour donner envie de l'utiliser.
 * - Investir : projection à 10/20 ans (estimation sur la reco si rien investi, sinon basée sur le réel).
 * - Épargner : invite à créer un projet d'épargne.
 * - Conserver : effet sur le SOLDE DE FIN DE MOIS projeté (avec / sans la somme), pas le solde actuel,
 *   + marge cumulée si on répète chaque mois.
 * Hypothèse de rendement : 7 %/an (intérêts composés mensuels).
 */
import { CURRENCY_SYMBOL } from './currency';
import type { RecoType, RecurringFit } from './recommendationEngine';

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

/** Phrase de tenue en virement récurrent (vide si la trajectoire est indisponible). */
function fitSentence(fit: RecurringFit | undefined, S: string): string {
  if (!fit) return '';
  // Le critère est la DURABILITÉ (le solde ne décline pas), pas seulement « la marge tient ce
  // mois-ci ». On le dit donc en clair : ce qui compte pour l'utilisateur, c'est de ne pas finir
  // dans le rouge à force de répéter le geste.
  if (fit.kind === 'sustainable') return `Tu peux créer un virement mensuel de ${fmt(fit.monthly)} ${S} sans risquer de vider ton compte.`;
  if (fit.kind === 'capped') return `Chaque mois, ne dépasse pas ${fmt(fit.monthly)} ${S} : au-delà, ton compte baisserait mois après mois.`;
  return 'À faire une fois, pas tous les mois : répété, ce montant finirait par vider ton compte.';
}

/**
 * Retourne la phrase contextuelle (ou null si non pertinent / montant nul).
 * `amount` = montant ACTIONNABLE de la reco (borne basse quand les montants sont en fourchette).
 * `fit` = tenue en virement récurrent : la projection est calculée sur le montant RÉELLEMENT
 * tenable (sinon on projetterait 350 €/mois juste après avoir dit « reste sous 160 €/mois »).
 */
export function getRecoContextText(type: RecoType, amount: number, fin: RecoFinancials, fit?: RecurringFit): string | null {
  const S = CURRENCY_SYMBOL;
  if (!(amount > 0)) return null;

  if (type === 'invest' || type === 'save') {
    const a = fitSentence(fit, S);
    // Rythme mensuel retenu pour la projection : le montant tenable, 0 si rien n'est tenable,
    // et le montant de la reco quand la trajectoire est inconnue (hypothèse « si tu le refais »).
    const rate = fit ? (fit.kind === 'month_only' ? 0 : fit.monthly) : amount;

    let b: string;
    if (type === 'invest') {
      if (rate > 0) {
        const y10 = futureValue(fin.totalInvested, rate, 10);
        const y20 = futureValue(fin.totalInvested, rate, 20);
        const tail = `tu pourrais atteindre ~${fmt(y10)} ${S} dans 10 ans et ~${fmt(y20)} ${S} dans 20 ans, avec un placement à 7 %/an.`;
        if (fin.totalInvested > 0) {
          b = a
            ? `En plus de tes ${fmt(fin.totalInvested)} ${S} déjà placés, ${tail}`
            : `En investissant ${fmt(rate)} ${S}/mois, en plus de tes ${fmt(fin.totalInvested)} ${S} déjà placés, ${tail}`;
        } else {
          b = a ? `À ce rythme, ${tail}` : `En investissant ${fmt(rate)} ${S}/mois, ${tail}`;
        }
      } else {
        // Versement ponctuel : on projette le capital, sans versement récurrent.
        const y10 = futureValue(fin.totalInvested + amount, 0, 10);
        b = fin.totalInvested > 0
          ? `Tes ${fmt(fin.totalInvested)} ${S} déjà placés + ces ${fmt(amount)} ${S} pourraient devenir ~${fmt(y10)} ${S} dans 10 ans, à 7 %/an.`
          : `Ces ${fmt(amount)} ${S} pourraient devenir ~${fmt(y10)} ${S} dans 10 ans, à 7 %/an.`;
      }
    } else {
      // Épargne : accumulation SIMPLE (pas de rendement supposé sur un livret).
      if (rate > 0) {
        const tail = `tu pourrais mettre de côté ~${fmt(rate * 12)} ${S} en 1 an et ~${fmt(rate * 60)} ${S} en 5 ans.`;
        b = a ? `À ce rythme, ${tail}` : `En épargnant ${fmt(rate)} ${S}/mois, ${tail}`;
      } else {
        b = `Ces ${fmt(amount)} ${S} renforcent directement ton épargne de sécurité.`;
      }
    }
    return `💡 ${a ? a + ' ' : ''}${b}`;
  }

  if (type === 'keep') {
    // Effet sur le solde de FIN DE MOIS projeté (pas le solde actuel). On annonce directement le
    // solde obtenu (et celui qu'on aurait sans) : dire « ça te laisse X de plus » était une évidence.
    const endWith = fin.projectedEndChecking ?? fin.currentChecking;
    const endWithout = endWith - amount;
    return `💡 Conserver ${fmt(amount)} ${S} te laissera ~${fmt(endWith)} ${S} sur ton compte en fin de mois, au lieu de ~${fmt(endWithout)} ${S} si tu les dépensais.`;
  }

  return null;
}
