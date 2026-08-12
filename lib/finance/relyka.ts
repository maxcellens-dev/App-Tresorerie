/**
 * LE RELYKA — « ce qu'il te reste vraiment ce mois-ci ».
 * Une seule formule, partagée par la carte du Pilotage, le bandeau « prochain geste » et le Pouls :
 * on part du POINT BAS du solde courant simulé, puis on retire tout ce qui est déjà engagé
 * (virements à venir, réservations, cumuls, enveloppe de dépenses variables restante, marge).
 */

/** Mouvement daté du solde courant simulé (`date` ISO `YYYY-MM-DD`, `amount` signé). */
export interface CashflowEvent { date: string; amount: number }

export interface CashflowTrough {
  /** Plus bas solde de FIN DE JOURNÉE atteint sur l'horizon. */
  trough: number;
  /** Date (ISO) de ce point bas — `todayStr` si aucune journée ne descend plus bas qu'aujourd'hui. */
  troughDate: string;
  /** Total des sorties d'argent sur l'horizon (valeur absolue). */
  outflowTotal: number;
}

/**
 * POINT BAS de trésorerie = plus bas solde de FIN DE JOURNÉE d'ici la fin de l'horizon.
 *
 * ⚠ L'agrégation par JOUR n'est pas un détail d'implémentation, c'est la règle métier. À
 * l'intérieur d'une même journée, l'ordre des opérations n'est ni connu ni stable (c'est l'ordre de
 * retour de la base). Dérouler les événements un par un faisait plonger le point bas de tout le
 * montant d'un prélèvement tombant LE JOUR DE LA PAIE s'il passait avant elle — un solde auquel le
 * compte ne descend jamais, et un chiffre qui pouvait changer d'un chargement à l'autre. Une banque
 * raisonne en solde de fin de journée : nous aussi.
 */
export function computeCashflowTrough(
  startBalance: number,
  events: CashflowEvent[],
  todayStr: string,
): CashflowTrough {
  const netByDay = new Map<string, number>();
  let outflowTotal = 0;
  for (const e of events) {
    netByDay.set(e.date, (netByDay.get(e.date) ?? 0) + e.amount);
    if (e.amount < 0) outflowTotal += -e.amount;
  }
  let running = startBalance;
  let trough = startBalance;
  let troughDate = todayStr;
  for (const d of [...netByDay.keys()].sort()) {
    running += netByDay.get(d)!;
    if (running < trough) { trough = running; troughDate = d; }
  }
  return { trough, troughDate, outflowTotal };
}

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
