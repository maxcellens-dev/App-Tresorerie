/**
 * closureForm — le CALCUL du formulaire de clôture mensuelle, sans React.
 *
 * `components/MonthlyClosure` porte trois responsabilités (bannière, formulaire, bilan) et près de
 * 800 lignes. Ces fonctions-ci en sont la partie qui compte : elles décident de MONTANTS — un solde
 * de fin de mois reconstitué, un écart constaté, sa répartition entre deux mois. Une erreur y est
 * invisible à la relecture et se solde par une régularisation fausse écrite en base.
 *
 * L'horloge est injectable : « ce qui s'est passé depuis » est la moitié de ces calculs, et n'était
 * jusqu'ici vérifiable qu'en changeant la date de la machine.
 *
 * Cf. docs/PLAN_REFACTOR_TESTS.md, phase D.
 */
import { lastDayOfMonthKey } from './monthKeys';
import { isRegul, prorateClosureGap } from './regul';
import { balanceAtDate } from './balanceAt';
import { isoDay } from '../dateUtils';

/** Ligne de transaction, réduite à ce dont ces calculs ont besoin. */
export interface ClosureTx {
  account_id: string;
  date: string;
  amount: number | string;
  /** Instant de saisie : départage deux écritures du même jour face à une ancre (cf. balanceAt). */
  created_at?: string | null;
  is_draft?: boolean | null;
  is_recurring?: boolean | null;
  regul_target?: number | null;
  regul_covered?: boolean | null;
  note?: string | null;
  category?: { name?: string | null } | null;
}

/** `currency` : devise NATIVE du compte — l'écart calculé pour ce compte est libellé dedans. */
export interface ClosureAccount { id: string; balance: number; currency?: string | null }

/**
 * Solde d'un compte à la FIN du mois qu'on clôture = solde actuel − tout ce qui est arrivé après.
 *
 * Même logique que le « solde à date » du détail de compte : on exclut les brouillons et les lignes
 * récurrentes (qui sont des occurrences PROJETÉES, pas de l'argent réellement sorti).
 *
 * ⚠️ LA BORNE HAUTE EST « AUJOURD'HUI », ET C'EST ESSENTIEL.
 * `accounts.balance` est le solde À DATE : la fonction SQL qui le calcule ne somme que les
 * transactions `date <= aujourd'hui` (cf. recompute_account_balance). Retrancher « tout ce qui est
 * daté après la fin du mois » y incluait donc les opérations PLANIFIÉES — un loyer saisi pour le
 * mois prochain, une échéance à venir — qui ne sont pas dans le solde qu'on décompte. Deux
 * conséquences, toutes deux constatées :
 *   • le solde de fin de mois proposé était trop bas du montant du futur saisi, donc l'écart et la
 *     régularisation écrits en base étaient faux d'autant ;
 *   • ce montant BOUGE avec le temps (le futur devient du passé, on saisit de nouvelles échéances) :
 *     rouvrir un mois puis le reclôturer proposait un chiffre différent de celui de la première
 *     fois, sans qu'aucune transaction du mois clos n'ait changé.
 * Avec la borne, le résultat ne dépend plus que des faits antérieurs : il est reproductible.
 */
export function balanceAtEnd(
  allTx: ClosureTx[],
  accountId: string,
  accountBalance: number,
  targetKey: string | null | undefined,
  now: Date = new Date(),
): number {
  if (!targetKey) return accountBalance;
  /* Le calcul vit dans lib/balanceAt : il reproduit EXACTEMENT le modèle d'ancre du serveur.
     La soustraction naïve qui se trouvait ici (« solde d'aujourd'hui moins ce qui est arrivé
     depuis ») retirait aussi les opérations situées avant une régularisation — or celles-là ne sont
     déjà plus dans le solde, l'ancre les a absorbées. Chaque « Mettre à jour mon solde » faussait
     donc le solde de fin de mois proposé, et avec lui l'écart et la régularisation écrite en base. */
  return balanceAtDate(allTx as any[], accountId, accountBalance, lastDayOfMonthKey(targetKey), now);
}

/**
 * Dernière « vérification » (régularisation) datée d'aujourd'hui ou avant, pour un compte.
 * À défaut, le 1er jour du mois clôturé : sans point de départ, le prorata n'a pas de segment.
 */
export function lastVerifiedDate(
  allTx: ClosureTx[],
  accountId: string,
  closeKey: string,
  now: Date = new Date(),
): string {
  const t0 = isoDay(now);
  let best: string | null = null;
  for (const t of allTx) {
    if (t.account_id !== accountId || !isRegul(t)) continue;
    const d = String(t.date ?? '').slice(0, 10);
    if (d && d <= t0 && (!best || d > best)) best = d;
  }
  return best ?? `${closeKey}-01`;
}

/** Lit un montant saisi au clavier (virgule décimale acceptée). `null` si le champ ne dit rien. */
export function parseTypedAmount(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = parseFloat(raw.replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

/**
 * Écart constaté en mode « je ne sais pas », pour un compte.
 *
 * Le solde annoncé vaut à `unknownDate` : on le compare donc au solde CONNU à cette date-là (solde
 * actuel moins ce qui s'est passé depuis), et surtout pas au solde de fin de mois.
 *
 * ⚠️ SEULE définition de l'écart. Elle était auparavant recopiée dans le curseur de répartition,
 * tandis que l'aperçu « Si tu valides » calculait, lui, un écart contre le solde de FIN DE MOIS :
 * les deux blocs de la même modale annonçaient des montants différents, parfois de signes opposés.
 */
export function unknownGap(
  allTx: ClosureTx[],
  account: ClosureAccount,
  typedBalance: string | null | undefined,
  unknownDate: string,
  now: Date = new Date(),
): number {
  const stated = parseTypedAmount(typedBalance);
  if (stated == null) return 0;
  // Même reconstruction que partout ailleurs (modèle d'ancre du serveur) — cf. balanceAtEnd.
  return stated - balanceAtDate(allTx as any[], account.id, account.balance, unknownDate, now);
}

/**
 * Somme des écarts « je ne sais pas », tous comptes renseignés confondus.
 *
 * ⚠️ Chaque écart est libellé dans la devise de SON compte. Additionner un écart en CHF avec un
 * écart en € donne un nombre qui ne veut rien dire — c'est pourquoi l'appelant peut fournir un
 * convertisseur vers sa devise d'affichage. Par défaut (un seul compte, ou tous dans la même
 * devise), c'est l'identité : le comportement mono-devise est inchangé.
 */
export function unknownTotalGap(
  allTx: ClosureTx[],
  accounts: ClosureAccount[],
  balances: Record<string, string>,
  unknownDate: string,
  now: Date = new Date(),
  toDisplay: (gap: number, account: ClosureAccount) => number = (gap) => gap,
): number {
  return accounts.reduce(
    (s, a) => s + toDisplay(unknownGap(allTx, a, balances[a.id], unknownDate, now), a),
    0,
  );
}

/** Au moins un solde a-t-il été saisi ? Les modes qui en réclament un ne valent rien sans. */
export function hasAnyTypedBalance(accounts: ClosureAccount[], balances: Record<string, string>): boolean {
  return accounts.some((a) => parseTypedAmount(balances[a.id]) != null);
}

/**
 * Part (%) de l'écart attribuée au mois CLÔTURÉ : celle du curseur si l'utilisateur l'a bougé,
 * sinon le prorata par jours suggéré — borné à [0, 100].
 */
export function closingSharePct(
  allTx: ClosureTx[],
  accountId: string,
  targetKey: string | null | undefined,
  unknownDate: string,
  manualShare: number | null,
  now: Date = new Date(),
): number {
  if (manualShare != null) return manualShare;
  if (!targetKey) return 50;
  const pr = prorateClosureGap(100, lastVerifiedDate(allTx, accountId, targetKey, now), unknownDate, targetKey);
  return Math.round(Math.max(0, Math.min(100, pr.closingShare)));
}
