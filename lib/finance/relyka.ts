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

/* ⚠️ `?? 0` ne rattrape PAS `NaN` : il ne couvre que `null` / `undefined`. Or il suffit qu'UN des
   huit termes soit `NaN` (montant illisible, colonne numérique rendue en texte, division par zéro en
   amont) pour que toute la soustraction le devienne — et le chiffre le plus important de l'app
   s'affiche alors « NaN € », ce qu'aucun écran ne rattrape en aval. Un terme manquant vaut mieux
   qu'un tableau de bord illisible. */
const n = (v: unknown): number => (Number.isFinite(v as number) ? (v as number) : 0);

/**
 * Relyka BRUT — la soustraction, sans plancher. Il peut être NÉGATIF, et c'est indispensable :
 * c'est le signe qui distingue « à 0 parce que tout est rangé ailleurs » de « à 0 parce qu'il ne
 * reste rien », deux situations qui méritent des messages et une couleur opposés.
 *
 * ⚠️ SOURCE UNIQUE de la formule. Elle a été recopiée jusqu'à quatre fois (carte du Pilotage,
 * entrées du moteur de recos, Pouls, bandeau « prochaine action ») : une soustraction à huit termes
 * dupliquée diverge au premier terme ajouté — et deux écrans annoncent alors deux budgets libres
 * différents pour le même mois, sans que rien ne le signale.
 */
export function relykaGross(i: RelykaInputs): number {
  return n(i.cashflowTrough)
    - n(i.savingsFuture)
    - n(i.investFuture)
    - n(i.reservePlanned)
    - n(i.reservationsTotal)
    - n(i.cumulsTotal)
    - n(i.variableEnvelopeRemaining)
    - n(i.safetyMargin);
}

/** Relyka AFFICHABLE : on ne « doit » rien à personne, le budget libre ne descend pas sous 0. */
export function computeRelyka(i: RelykaInputs): number {
  return Math.max(0, relykaGross(i));
}
