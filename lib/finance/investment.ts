/**
 * Investissement — apports et plus/moins-values.
 *
 * Sur un compte d'investissement, trois natures d'opérations se ressemblent EXACTEMENT en base
 * (pas de catégorie, pas de compte lié, juste un montant signé) :
 *   • APPORT           → augmente l'apport ET la valeur ;
 *   • PLUS/MOINS-VALUE → augmente la valeur, JAMAIS l'apport ;
 *   • retrait          → reconnaissable, lui, à son `linked_account_id`.
 *
 * ── POURQUOI UN MARQUEUR, ET PLUS UN LIBELLÉ ────────────────────────────────────────────────────
 * La nature se devinait à la lecture du LIBELLÉ (`/plus|moins|gain|perte/i`, `/apport/i`). Or le
 * libellé est un champ de texte libre, modifiable après coup depuis l'écran d'édition :
 *   • renommer « Plus-value » en « Revalorisation T3 » la faisait sortir des plus-values, et le
 *     montant se mettait alors à gonfler l'APPORT — la performance affichée du compte s'effondrait
 *     sans qu'aucune donnée financière n'ait bougé ;
 *   • à l'inverse, « Apport moins les frais » contient « moins » : c'était compté en moins-value.
 *
 * La nature est donc désormais une DONNÉE (`transactions.investment_kind`, migration 196), écrite
 * par le bouton qui crée l'opération. Le libellé redevient un commentaire.
 *
 * Le repli par libellé SUBSISTE, et doit subsister : il lit les lignes d'avant la migration que la
 * reprise n'a pas pu marquer. Il n'est jamais consulté quand le marqueur est présent.
 *
 * Source unique : le détail de compte (saisie), le calcul d'apport (lib/contributed) et le Pouls
 * lisent la MÊME définition — sinon deux écrans annonceraient des totaux différents.
 */

export const INVESTMENT_GAIN_NOTE = 'Plus-value';
export const INVESTMENT_LOSS_NOTE = 'Moins-value';

/** Nature d'une opération sur un compte d'investissement. `null` = tout le reste. */
export type InvestmentKind = 'gain' | 'loss' | 'deposit';

/** Ce que le prédicat a besoin de connaître d'une transaction. */
export interface InvestmentMarked {
  investment_kind?: InvestmentKind | string | null;
  note?: string | null;
}

/**
 * REPLI HISTORIQUE — ne s'applique qu'aux lignes sans marqueur (créées avant la migration 196).
 * Ne pas appeler directement : passer par `isInvestmentGainLoss` / `isInvestmentDeposit`, qui
 * consultent le marqueur d'abord.
 */
function noteLooksLikeGainLoss(note: string | null | undefined): boolean {
  return !!note && /plus|moins|gain|perte/i.test(note);
}

function noteLooksLikeDeposit(note: string | null | undefined): boolean {
  return !!note && /apport/i.test(note);
}

/** true si la transaction est une plus ou moins-value (variation de valeur, pas un versement). */
export function isInvestmentGainLoss(t: InvestmentMarked | null | undefined): boolean {
  if (!t) return false;
  const kind = t.investment_kind;
  // Marqueur présent → il fait foi, quel que soit le libellé. Y compris `deposit`, qui répond
  // explicitement « non » ici : c'est tout l'intérêt d'avoir marqué les apports eux aussi.
  if (kind === 'gain' || kind === 'loss') return true;
  if (kind === 'deposit') return false;
  return noteLooksLikeGainLoss(t.note);
}

/**
 * true si la transaction est un VERSEMENT sur le compte (apport de capital).
 *
 * ⚠️ Le montant doit être positif ET la ligne ne doit pas être un virement — ces deux conditions
 * restent à la charge de l'appelant, qui seul connaît le contexte (cf. lib/contributed, où un
 * virement entrant est déjà traité comme un apport par son `linked_account_id`).
 */
export function isInvestmentDeposit(t: InvestmentMarked | null | undefined): boolean {
  if (!t) return false;
  const kind = t.investment_kind;
  if (kind === 'deposit') return true;
  if (kind === 'gain' || kind === 'loss') return false;
  return noteLooksLikeDeposit(t.note);
}

export interface InvestmentTx extends InvestmentMarked {
  amount: number;
  is_draft?: boolean | null;
  account?: { type?: string | null } | null;
  linked_account_id?: string | null;
}

/**
 * Bilan des investissements : ce qui a été VERSÉ (virements entrants), ce que ça a RAPPORTÉ
 * (somme des plus/moins-values) — le solde actuel vient des comptes, pas d'ici.
 */
export function computeInvestmentGains(transactions: InvestmentTx[]): { gains: number; deposits: number } {
  let gains = 0;
  let deposits = 0;
  for (const t of transactions) {
    if (t.is_draft) continue;
    if (t.account?.type !== 'investment') continue;
    const amount = Number(t.amount);
    if (!Number.isFinite(amount)) continue;
    if (isInvestmentGainLoss(t)) gains += amount;
    else if (amount > 0 && t.linked_account_id) deposits += amount; // jambe de crédit d'un virement
  }
  return { gains, deposits };
}
