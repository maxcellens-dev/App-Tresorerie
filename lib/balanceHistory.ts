/**
 * L'ÉVOLUTION DU SOLDE D'UN COMPTE — reconstituée à rebours depuis le solde d'aujourd'hui.
 *
 * Le solde stocké (`accounts.balance`) est la SOURCE DE VÉRITÉ : il est recalculé côté base à partir
 * des faits (recompute_account_balance), régularisations comprises. On ne le recalcule donc PAS ici —
 * on le REMONTE dans le temps : le solde à une date passée vaut le solde d'aujourd'hui moins tout ce
 * qui est tombé entre cette date et aujourd'hui. C'est exactement le raisonnement que tient déjà
 * l'écran de régularisation (« solde calculé à cette date ») : une seule façon de remonter le temps.
 *
 * Ne comptent que les lignes qui sont RÉELLEMENT dans le solde : ni brouillon, ni modèle récurrent
 * (ses occurrences échues sont des lignes à part entière), ni transaction future.
 */

export interface BalanceHistoryTx {
  account_id: string;
  amount: number | string;
  date: string;
  is_draft?: boolean | null;
  is_recurring?: boolean | null;
}

export interface BalancePoint {
  /** Jour représenté (AAAA-MM-JJ) — fin du mois, ou aujourd'hui pour le dernier point. */
  date: string;
  /** Libellé court d'axe (« mars 26 »). */
  label: string;
  value: number;
}

/** Jour LOCAL au format AAAA-MM-JJ (jamais `toISOString()`, qui bascule en UTC). */
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** « mars 26 » — assez court pour tenir sous un axe, assez précis pour situer l'année. */
function monthLabel(d: Date): string {
  return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }).replace('.', '');
}

/** Nombre maximum de points tracés : au-delà, la courbe devient un peigne illisible. */
const MAX_POINTS = 36;

/**
 * Points de solde de fin de mois, du premier mouvement du compte jusqu'à AUJOURD'HUI (dernier point).
 *
 * `currentBalance` est le solde du jour. Renvoie une liste vide si le compte n'a aucun mouvement
 * échu : il n'y a alors pas d'histoire à raconter, et une courbe plate à un seul point n'en est pas une.
 */
export function buildBalanceHistory(
  accountId: string,
  currentBalance: number,
  transactions: BalanceHistoryTx[],
  todayStr: string,
  /** Date d'ouverture déclarée du compte (`init_date`) — début de la courbe si elle est antérieure. */
  initDate?: string | null,
): BalancePoint[] {
  const posted = transactions.filter(
    (t) => t.account_id === accountId && !t.is_draft && !t.is_recurring && t.date <= todayStr,
  );
  if (posted.length === 0) return [];

  const first = posted.reduce((min, t) => (t.date < min ? t.date : min), posted[0].date);
  const start = initDate && initDate < first ? initDate : first;

  // Bornes de mois à représenter : fin de chaque mois depuis `start`, puis aujourd'hui.
  const startD = new Date(start + 'T00:00:00');
  const todayD = new Date(todayStr + 'T00:00:00');
  const monthEnds: Date[] = [];
  const cursor = new Date(startD.getFullYear(), startD.getMonth() + 1, 0); // dernier jour du mois de `start`
  while (isoDay(cursor) < todayStr) {
    monthEnds.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 2, 0); // dernier jour du mois suivant
  }
  // Historique très long : on ne garde que les derniers mois (la courbe reste lisible et récente).
  const kept = monthEnds.slice(Math.max(0, monthEnds.length - (MAX_POINTS - 1)));

  // Remontée à rebours : chaque borne = solde d'aujourd'hui − ce qui est tombé après elle.
  // Un seul parcours par borne suffit (les volumes d'un compte tiennent largement en mémoire).
  const point = (d: Date): BalancePoint => {
    const iso = isoDay(d);
    const after = posted.reduce((s, t) => (t.date > iso ? s + Number(t.amount) : s), 0);
    return { date: iso, label: monthLabel(d), value: currentBalance - after };
  };

  const points = kept.map(point);
  points.push({ date: todayStr, label: monthLabel(todayD), value: currentBalance });

  // Deux points identiques en tête (compte ouvert ce mois-ci) ne racontent rien : on exige un écart
  // de date réel entre le premier et le dernier point.
  return points.length >= 2 ? points : [];
}
