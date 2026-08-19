/**
 * LE SOLDE D'UN COMPTE À UNE DATE PASSÉE — une seule définition, celle du serveur.
 *
 * ── LE PROBLÈME QUE CE FICHIER RÈGLE ────────────────────────────────────────────────────────────
 * Le solde stocké (`accounts.balance`) est calculé par `recompute_account_balance` selon un modèle
 * d'ANCRE : on part de la dernière régularisation qui porte un solde cible (`regul_target`) et on
 * ajoute ce qui s'est passé APRÈS elle. Tout ce qui précède l'ancre est absorbé par elle — c'est
 * précisément ce qui rend une régularisation utile : elle dit « à cette date, le compte valait
 * exactement ça », et le passé cesse de compter.
 *
 * Le client, lui, remontait le temps par soustraction naïve :
 *        solde à D  =  solde d'aujourd'hui  −  somme des opérations postérieures à D
 * Cette formule est juste TANT QU'IL N'Y A AUCUNE ANCRE entre D et aujourd'hui. Dès qu'il y en a
 * une — et il y en a une à chaque « Mettre à jour mon solde », c'est le geste central de l'app — les
 * opérations situées AVANT l'ancre ne sont plus dans le solde, mais la soustraction les retire
 * quand même. Le solde reconstitué était alors faux du montant de ces opérations.
 *
 * Ce chiffre-là n'est pas décoratif : c'est lui qu'on oppose au solde saisi à la clôture pour en
 * déduire l'écart, puis la régularisation ÉCRITE EN BASE. Une erreur ici se solde par une
 * correction de solde fausse, chez tout le monde, silencieusement.
 *
 * ── LA RÈGLE, IDENTIQUE DES DEUX CÔTÉS DU RÉSEAU ────────────────────────────────────────────────
 *   1. il existe une ancre datée AU PLUS TARD à D   → cible + ce qui s'est passé entre elle et D ;
 *   2. sinon, il existe une ancre APRÈS D           → cible − ce qui s'est passé entre D et elle
 *      (on remonte le temps depuis le point de vérité le plus proche) ;
 *   3. sinon                                        → solde d'aujourd'hui − ce qui s'est passé
 *      depuis D (l'ancienne formule, qui est exacte en l'absence d'ancre).
 *
 * Les exclusions sont celles du serveur : jamais les brouillons, jamais les MODÈLES récurrents (ce
 * sont des occurrences projetées, pas de l'argent sorti), et à date d'ancre égale on respecte
 * `regul_covered` (l'opération que l'utilisateur a déclarée « déjà comprise dans ce solde »).
 */

export interface BalanceTx {
  account_id: string;
  date: string;
  amount: number | string;
  created_at?: string | null;
  is_draft?: boolean | null;
  is_recurring?: boolean | null;
  regul_covered?: boolean | null;
  regul_target?: number | null;
  note?: string | null;
  category_id?: string | null;
}

/** Une ancre : une régularisation qui porte un solde CIBLE. Les autres n'ancrent rien. */
interface Anchor { id?: string; date: string; created_at: string; target: number }

const day = (d: unknown): string => String(d ?? '').slice(0, 10);

/** Compte-t-elle dans un solde ? (mêmes exclusions que recompute_account_balance) */
function counts(t: BalanceTx): boolean {
  return !t.is_draft && !t.is_recurring;
}

/**
 * Ancres du compte, de la plus ancienne à la plus récente.
 * `regul_target` est le marqueur — le même qu'`isRegul` et que `is_regul_tx` côté SQL. Une
 * régularisation SANS cible (les écarts de clôture au prorata, par exemple) n'ancre rien : elle se
 * comporte comme une opération ordinaire, et c'est voulu.
 */
function anchorsOf(allTx: BalanceTx[], accountId: string): Anchor[] {
  return allTx
    .filter((t) => t.account_id === accountId && counts(t) && t.regul_target != null)
    .map((t) => ({
      id: (t as any).id as string | undefined,
      date: day(t.date),
      created_at: String(t.created_at ?? ''),
      target: Number(t.regul_target),
    }))
    .sort((a, b) => (a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date)));
}

/** Somme des opérations de `from` (exclu) à `to` (inclus), l'ancre elle-même exclue. */
function sumBetween(
  allTx: BalanceTx[],
  accountId: string,
  fromExclusive: string,
  toInclusive: string,
  anchor: Anchor | null,
): number {
  return allTx
    .filter((t) => {
      if (t.account_id !== accountId || !counts(t)) return false;
      const d = day(t.date);
      if (d <= fromExclusive || d > toInclusive) {
        /* Même JOUR que l'ancre : l'opération compte si elle a été saisie APRÈS elle et que
           l'utilisateur n'a pas répondu « elle y était déjà comprise » (cf. regul_covered). */
        if (anchor && d === anchor.date && d === fromExclusive) {
          if ((t as any).id && (t as any).id === anchor.id) return false;
          return String(t.created_at ?? '') > anchor.created_at && !t.regul_covered;
        }
        return false;
      }
      if (anchor && (t as any).id && (t as any).id === anchor.id) return false;
      return true;
    })
    .reduce((s, t) => s + Number(t.amount), 0);
}

/**
 * Solde du compte `accountId` à la date `date` (incluse).
 *
 * `currentBalance` n'est utilisé qu'en dernier recours (aucune ancre connue) : partout ailleurs le
 * résultat se déduit des seuls faits, donc il est REPRODUCTIBLE — clôturer deux fois le même mois
 * propose deux fois le même chiffre, même si de nouvelles opérations ont été saisies entre-temps.
 * C'est ce que l'ancienne formule ne garantissait pas.
 */
export function balanceAtDate(
  allTx: BalanceTx[],
  accountId: string,
  currentBalance: number,
  date: string,
  now: Date = new Date(),
): number {
  const d = day(date);
  if (!d) return currentBalance;
  const anchors = anchorsOf(allTx, accountId);

  // 1. Dernière ancre datée au plus tard à D : le point de vérité le plus proche EN AMONT.
  const before = [...anchors].reverse().find((a) => a.date <= d);
  if (before) return before.target + sumBetween(allTx, accountId, before.date, d, before);

  // 2. Sinon la première ancre APRÈS D : on remonte le temps depuis elle.
  const after = anchors.find((a) => a.date > d);
  if (after) return after.target - sumBetween(allTx, accountId, d, after.date, after);

  // 3. Aucune ancre : la formule d'origine, exacte dans ce cas précis.
  const t0 = day(now.toISOString());
  const since = allTx
    .filter((t) => t.account_id === accountId && counts(t) && day(t.date) > d && day(t.date) <= t0)
    .reduce((s, t) => s + Number(t.amount), 0);
  return currentBalance - since;
}

/**
 * Existe-t-il une VÉRIFICATION plus récente que `date` sur ce compte ?
 *
 * Décisif pour ne pas mentir à la clôture : si l'utilisateur a déjà confirmé son solde le 5 août,
 * corriger le 31 juillet ne peut PAS déplacer son solde d'aujourd'hui — l'écart est déjà compris
 * dans la vérification du 5. Le calcul était juste ; ce qui manquait, c'est de le dire, au lieu de
 * laisser croire à un enregistrement sans effet.
 */
export function laterVerification(
  allTx: BalanceTx[],
  accountId: string,
  date: string,
): { date: string } | null {
  const d = day(date);
  const after = anchorsOf(allTx, accountId).filter((a) => a.date > d);
  return after.length ? { date: after[after.length - 1].date } : null;
}
