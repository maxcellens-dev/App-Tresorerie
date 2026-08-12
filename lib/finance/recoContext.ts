/**
 * recoContext — phrase affichée sous chaque recommandation pour dire ce que le geste ENGAGE.
 *
 * ── Épargner / Investir : deux messages, et deux seulement ────────────────────────────────────────
 *  • RÉCURRENT (le solde ne baisse pas à ce rythme) → on propose un virement mensuel : c'est le seul
 *    cas où l'app peut parler de long terme, puisqu'elle a vérifié que le geste se répète sans
 *    creuser le compte (cf. computeRecurringFit : transition + durabilité).
 *  • PONCTUEL (rien n'est tenable en récurrent, ou trajectoire inconnue) → on s'en tient au mois en
 *    cours : « voilà ce que tu peux mettre ce mois-ci sans risque ».
 *
 * PLUS AUCUNE PROJECTION À 10 / 20 ANS. Elle s'affichait dans les DEUX cas, y compris quand l'app
 * venait de constater que le montant n'était PAS répétable : annoncer « ~48 000 € dans 10 ans » sous
 * une somme qu'il ne faut justement pas remettre tous les mois promettait un capital construit sur
 * un geste que l'app déconseille. Et un rendement supposé (7 %/an) n'est pas une donnée de
 * l'utilisateur : ce qui est vrai, vérifié et utile, c'est le montant tenable — pas le capital rêvé.
 *
 * ── Conserver ─────────────────────────────────────────────────────────────────────────────────────
 * Effet sur le SOLDE DE FIN DE MOIS projeté (avec / sans la somme), pas sur le solde actuel.
 */
import { CURRENCY_SYMBOL } from './currency';
import type { RecoType, RecurringFit } from './recommendationEngine';

function fmt(n: number): string {
  return Math.round(n).toLocaleString('fr-FR');
}

export interface RecoFinancials {
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
 * `fit` = tenue en virement récurrent, seule donnée qui autorise à parler d'autre chose que du mois
 * en cours. Absente = trajectoire indisponible → message ponctuel, comme pour `month_only`.
 */
export function getRecoContextText(type: RecoType, amount: number, fin: RecoFinancials, fit?: RecurringFit): string | null {
  const S = CURRENCY_SYMBOL;
  if (!(amount > 0)) return null;

  if (type === 'invest' || type === 'save') {
    // « placer » / « mettre de côté » : le verbe du geste, pour ne pas répéter le titre de la tuile.
    const verbe = type === 'invest' ? 'placer' : 'mettre de côté';
    const dest = type === 'invest' ? 'ton compte d’investissement' : 'ton épargne';
    const ceMois = `Tu peux ${verbe} ces ${fmt(amount)} ${S} ce mois-ci sans risque`;

    // 1) DURABLE — le montant se répète chaque mois sans faire baisser le solde. C'est LE cas où
    //    l'app propose d'automatiser : le geste n'a plus à être repris tous les mois.
    if (fit?.kind === 'sustainable') {
      return `💡 ${ceMois} : ton solde ne baisse pas à ce rythme. Tu peux même en faire un virement mensuel de ${fmt(fit.monthly)} ${S} vers ${dest} — c'est tenable sur la durée, sans y repenser.`;
    }

    // 2) PLAFONNÉ — le geste passe ce mois-ci, mais répété tel quel il creuserait le compte. On
    //    donne le montant réellement tenable : c'est la version « longue durée » de la même reco.
    if (fit?.kind === 'capped') {
      return `💡 ${ceMois}. Si tu veux en faire un virement mensuel vers ${dest}, reste à ${fmt(fit.monthly)} ${S}/mois : au-delà, ton compte baisserait mois après mois.`;
    }

    // 3) PONCTUEL — rien n'est tenable en récurrent (`month_only`), ou trajectoire indisponible
    //    (`fit` absent, ex. reco déjà plafonnée par le garde-fou projection). On ne parle QUE du
    //    mois en cours : c'est tout ce que l'app peut affirmer sans risque.
    if (fit?.kind === 'month_only') {
      return `💡 ${ceMois} : mais surveille ta projection pour les mois suivants pour ne pas descendre sous ta marge de sécurité.`;
    }
    return `💡 ${ceMois} : c'est de l'argent dont tu n'as pas besoin d'ici la fin du mois, ta marge de sécurité comprise. Mais surveille ta projection pour les mois suivants.`;
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
