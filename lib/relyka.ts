/**
 * LE RELYKA — « ce qu'il te reste vraiment ce mois-ci ».
 * Une seule formule, partagée par la carte du Pilotage, le bandeau « prochain geste » et le Pouls :
 * on part du POINT BAS du solde courant simulé, puis on retire tout ce qui est déjà engagé
 * (virements à venir, réservations, cumuls, enveloppe de dépenses variables restante, marge).
 */

export interface RelykaInputs {
  /** Point bas du solde courant simulé sur le mois (usePilotageData.cashflow_trough). */
  cashflowTrough: number;
  /** Virements épargne / investissement du mois encore à venir. */
  savingsFuture: number;
  investFuture: number;
  /** Réservations de projets (même compte) + brouillons conservés. */
  reservePlanned: number;
  /** Réservations manuelles du mois. */
  reservationsTotal: number;
  /** Cumuls de pré-épargne / pré-investissement. */
  cumulsTotal: number;
  /** Ce qu'il reste à dépenser sur l'enveloppe variable du mois. */
  variableEnvelopeRemaining: number;
  /** Montant que l'utilisateur garde toujours sur son compte. */
  safetyMargin: number;
}

export function computeRelyka(i: RelykaInputs): number {
  return Math.max(
    0,
    i.cashflowTrough
      - i.savingsFuture
      - i.investFuture
      - i.reservePlanned
      - i.reservationsTotal
      - i.cumulsTotal
      - i.variableEnvelopeRemaining
      - i.safetyMargin,
  );
}
