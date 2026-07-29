/**
 * LE REVENU MENSUEL DE RÉFÉRENCE — une seule mesure, pour toute l'app.
 *
 * Ce chiffre décide de beaucoup : les mois de sécurité affichés, le doute du moteur, et le PROFIL
 * financier. Il existait pourtant en deux versions qui ne disaient pas la même chose :
 *  • celle-ci (Pilotage) : moyenne des mois QUI ONT une recette, mois courant COMPRIS ;
 *  • une autre, dans le moteur de profils : total des 6 derniers mois RÉVOLUS ÷ 6.
 * Pour un compte neuf, la seconde renvoyait 0 — le seul mois avec un salaire étant le mois courant,
 * qu'elle excluait. Le profil se croyait donc « sans revenu constaté » et restait bloqué sur P1,
 * pendant que la même page affichait « revenu de référence 2 000 € » et « 7,5 mois de sécurité ».
 * Deux écritures du même calcul, deux réponses, un utilisateur qui ne comprend pas.
 *
 * Elle vit donc ici, seule, et les deux mécanismes l'appellent.
 */

/** Transaction, vue minimale suffisante pour reconnaître une recette. */
export interface IncomeTx {
  account_id: string;
  amount: number | string;
  date: string;
  is_draft?: boolean | null;
  is_reserved?: boolean | null;
  linked_account_id?: string | null;
  note?: string | null;
  category?: { type?: string | null } | null;
  is_recurring?: boolean | null;
  recurrence_rule?: string | null;
  recurrence_end_date?: string | null;
}

/* Date LOCALE au format AAAA-MM-JJ. ⚠️ Surtout pas `toISOString()` : il convertit en UTC, et un
   `new Date(2026, 7, 1)` construit à minuit local dans un fuseau à l'est de Greenwich en ressort
   daté du 31 juillet. Toutes les dates de l'app sont des jours locaux — on compare du local. */
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Cette ligne est-elle une VRAIE rentrée d'argent ? (indépendamment de sa date)
 * Exclut les virements internes, les brouillons, les réservations, les régularisations de solde et
 * les remboursements (montant positif posé sur une catégorie de dépense).
 */
function isRealIncome(t: IncomeTx, checkingIds: Set<string>): boolean {
  return checkingIds.has(t.account_id)
    && !t.is_draft && !t.is_reserved && !t.linked_account_id
    && Number(t.amount) > 0
    && !/r[ée]gul/i.test(t.note ?? '')
    && t.category?.type !== 'expense';
}

/** Clé « AAAA-MM » du mois de `todayStr`, décalée de `offset` mois. */
function monthKey(todayStr: string, offset = 0): string {
  const d = new Date(todayStr + 'T00:00:00');
  const m = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Un mois calendaire COMPLET s'est-il écoulé depuis la création du compte ?
 *
 * Le premier mois d'un utilisateur est presque toujours partiel (il arrive le 12, le 26…) : il ne
 * dit rien de son revenu. Le premier mois entièrement vécu dans l'app est donc le SUIVANT, et on ne
 * le considère acquis qu'une fois terminé. Date de création inconnue → on répond « non », ce qui
 * laisse simplement le repli disponible (il ne sert de toute façon que si rien n'a été constaté).
 */
function hasFullMonthOfHistory(profileCreatedAt: string | null | undefined, todayStr: string): boolean {
  if (!profileCreatedAt) return false;
  const c = new Date(String(profileCreatedAt).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(c.getTime())) return false;
  const firstSettledDay = isoDay(new Date(c.getFullYear(), c.getMonth() + 2, 1));
  return todayStr >= firstSettledDay;
}

/**
 * Revenu mensuel « de référence » pour les mois de sécurité : moyenne des SOMMES de recettes par
 * mois sur les 6 derniers mois (toutes recettes confondues, hors virements/brouillons/régul).
 * On EXCLUT le tout 1ᵉʳ mois de l'utilisateur (arrivée sur l'app → données souvent incomplètes,
 * salaire pas forcément saisi) SAUF s'il contient déjà une vraie recette (> 1000 €, pas un simple
 * remboursement). Renvoie 0 si rien d'exploitable (mention « mois de sécurité » alors masquée).
 */
export function computeAvgMonthlyIncome(
  transactions: IncomeTx[],
  checkingIds: Set<string>,
  todayStr: string,
  /** Date de création du profil : compte créé AVANT la fenêtre = utilisateur établi (le fetch est
   *  désormais FENÊTRÉ → on ne peut plus compter sur la présence de recettes très anciennes). */
  profileCreatedAt?: string | null,
): number {
  const REAL_INCOME_MIN = 1000; // seuil « vraie recette » (vs remboursement) pour valider le 1ᵉʳ mois
  const now = new Date(todayStr + 'T00:00:00');
  const windowStart = isoDay(new Date(now.getFullYear(), now.getMonth() - 5, 1)); // 6 mois (courant inclus)
  const establishedByAge = !!profileCreatedAt && String(profileCreatedAt).slice(0, 10) < windowStart;
  // Constaté = ce qui est DÉJÀ tombé : on ajoute la condition de date au filtre commun.
  const qualifies = (t: IncomeTx) => isRealIncome(t, checkingIds) && t.date <= todayStr;

  const byMonth: Record<string, { sum: number; maxOne: number }> = {};
  let hasOlderIncome = false; // une recette antérieure à la fenêtre → utilisateur établi (pas un 1ᵉʳ mois)
  for (const t of transactions) {
    if (!qualifies(t)) continue;
    if (t.date < windowStart) { hasOlderIncome = true; continue; }
    const amt = Number(t.amount);
    const mk = t.date.slice(0, 7);
    const e = (byMonth[mk] ??= { sum: 0, maxOne: 0 });
    e.sum += amt;
    e.maxOne = Math.max(e.maxOne, amt);
  }

  let months = Object.keys(byMonth).sort(); // chronologique
  if (months.length === 0) return 0;
  // Si la fenêtre atteint le 1ᵉʳ mois de l'utilisateur, on ne le retient que s'il a une vraie recette.
  if (!hasOlderIncome && !establishedByAge && byMonth[months[0]].maxOne <= REAL_INCOME_MIN) {
    months = months.slice(1);
  }
  if (months.length === 0) return 0;
  const total = months.reduce((s, mk) => s + byMonth[mk].sum, 0);
  return total / months.length;
}

/**
 * Combien d'occurrences d'une récurrence tombent dans le mois `mk` (« AAAA-MM ») ?
 *
 * ⚠️ `startDate` est la date du MODÈLE, et le modèle porte toujours la PROCHAINE occurrence : la
 * matérialisation (materialize_due_recurring) transforme chaque échéance passée en vraie ligne puis
 * avance la date du modèle. Compter les occurrences à partir de cette date ne peut donc jamais
 * doubler ce qui a déjà été matérialisé — c'est ce qui rend l'addition ci-dessous sûre.
 */
function occurrencesInMonth(
  startDate: string,
  rule: string | null | undefined,
  endDate: string | null | undefined,
  mk: string,
): number {
  const monthStart = `${mk}-01`;
  const [y, m] = mk.split('-').map(Number);
  const monthEnd = isoDay(new Date(y, m, 0)); // jour 0 du mois suivant = dernier jour de `mk`
  if (startDate > monthEnd) return 0;
  if (endDate && endDate < monthStart) return 0;

  if (rule === 'weekly') {
    // Seule périodicité qui peut tomber PLUSIEURS fois dans le même mois.
    let count = 0;
    const d = new Date(startDate + 'T00:00:00');
    for (let guard = 0; guard < 60; guard++) {
      const day = isoDay(d);
      if (day > monthEnd) break;
      if (day >= monthStart && (!endDate || day <= endDate)) count++;
      d.setDate(d.getDate() + 7);
    }
    return count;
  }
  // Mensuel / trimestriel / annuel : au plus une occurrence par mois — celle du modèle.
  if (rule !== 'monthly' && rule !== 'quarterly' && rule !== 'yearly') return 0;
  const inMonth = startDate.slice(0, 7) === mk;
  return inMonth && (!endDate || startDate <= endDate) ? 1 : 0;
}

/**
 * TOTAL des rentrées d'argent d'un mois donné — « combien il gagne, en gros, sur ce mois ».
 *
 * On additionne TOUT ce qui tombe dans le mois, sans privilégier une source sur une autre :
 *  • les lignes réelles datées dans le mois — déjà tombées OU encore à venir. Une paie du 5 déjà
 *    reçue et une prime du 28 encore à venir font un mois à deux rentrées, pas une ;
 *  • les occurrences des récurrentes qui tombent dans ce mois et ne sont pas encore matérialisées.
 *
 * Chaque euro est compté une fois et une seule : une échéance passée est une ligne réelle (premier
 * point) et n'est plus portée par le modèle, dont la date a été avancée (cf. occurrencesInMonth).
 */
export function computeMonthIncome(
  transactions: IncomeTx[],
  checkingIds: Set<string>,
  mk: string,
): number {
  let total = 0;
  for (const t of transactions) {
    if (!isRealIncome(t, checkingIds)) continue;
    const amount = Number(t.amount);
    if (t.is_recurring && t.recurrence_rule) {
      total += amount * occurrencesInMonth(t.date, t.recurrence_rule, t.recurrence_end_date ?? null, mk);
    } else if (t.date.slice(0, 7) === mk) {
      total += amount;
    }
  }
  return total;
}

/**
 * LE revenu de référence de l'app — le PASSÉ dès qu'il existe, le DÉCLARÉ le temps du démarrage.
 *
 * Pourquoi un repli : le revenu constaté ne compte que les recettes DÉJÀ TOMBÉES (`date <= today`).
 * C'est juste pour un compte installé, mais faux au démarrage — et de la pire façon. Quelqu'un qui
 * crée son compte le 20 et saisit son salaire du 30 (ou du mois suivant, ce qui est parfaitement
 * légitime) n'avait AUCUN revenu constaté : le matelas de sécurité restait vide, le revenu de
 * référence affichait « — », et le profil financier restait bloqué sur P1 parce qu'il conclut
 * « aucun revenu » avant même de regarder l'épargne. Il fallait, par hasard, ressaisir une recette
 * antérieure au jour même pour que tout se débloque d'un coup.
 *
 * L'arbitrage, dans l'ordre :
 *  1. un mois calendaire COMPLET s'est écoulé → le passé fait foi, seul et sans discussion. Les
 *     saisies à venir ne comptent plus : à ce stade l'app a vu vivre un vrai mois, elle n'a plus
 *     besoin qu'on lui décrive le revenu, elle le mesure. Et plus les mois passent, plus cette
 *     moyenne se stabilise ;
 *  2. sinon (démarrage) → le TOTAL du mois courant : tout ce qui rentre ce mois-ci, déjà tombé ou
 *     encore à venir. C'est la seule façon d'estimer juste dès le premier jour — ne compter que le
 *     déjà-tombé sous-estime celui qui a saisi trois rentrées dont deux à venir ;
 *  3. si le mois courant ne porte rien → le total du MOIS SUIVANT. Selon le jour où l'on s'inscrit,
 *     la première paie saisie tombe naturellement sur le mois d'après ; ce n'est pas une raison
 *     pour conclure « aucun revenu ». Uniquement dans ce cas : dès que le mois courant porte
 *     quelque chose, c'est lui qui compte.
 */
export function computeReferenceMonthlyIncome(
  transactions: IncomeTx[],
  checkingIds: Set<string>,
  todayStr: string,
  profileCreatedAt?: string | null,
): number {
  const observed = computeAvgMonthlyIncome(transactions, checkingIds, todayStr, profileCreatedAt);
  if (hasFullMonthOfHistory(profileCreatedAt, todayStr)) return observed;

  const thisMonth = computeMonthIncome(transactions, checkingIds, monthKey(todayStr));
  if (thisMonth > 0) return thisMonth;

  const nextMonth = computeMonthIncome(transactions, checkingIds, monthKey(todayStr, 1));
  if (nextMonth > 0) return nextMonth;

  return observed; // filet : en pratique 0 ici, mais on ne perd jamais une mesure existante
}
