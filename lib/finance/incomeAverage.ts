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
  id?: string | null;
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
  /** Id du MODÈLE dont cette ligne est une occurrence matérialisée (migration 030). */
  materialized_from?: string | null;
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

/** Médiane d'une liste NON VIDE (copie triée — l'appelant garde son ordre). */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Un mois est EXCEPTIONNEL au-delà de ce multiple de la médiane des AUTRES mois. Volontairement
 * haut : une augmentation de salaire, un 13ᵉ mois ou un second revenu qui arrive sur le compte
 * doivent passer (ce sont de vrais changements de revenu) ; seul un mois sans commune mesure avec
 * les autres — vente d'une voiture, héritage, remboursement d'assurance — est écarté.
 */
const EXCEPTIONAL_MONTH_FACTOR = 3;

/**
 * LES MOIS RETENUS POUR LA MOYENNE — sans les rentrées EXCEPTIONNELLES.
 *
 * Le revenu de référence répond à « combien gagne-t-il par mois, d'habitude ? ». Il sert de
 * DIVISEUR au matelas de sécurité (épargne ÷ revenu) et donc au profil financier. Une rentrée
 * ponctuelle très élevée le faisait bondir, et le matelas — donc le profil — CHUTAIT : encaisser
 * 20 000 € faisait passer de P5 à P3, et supprimer la ligne le remettait en P5. Recevoir de
 * l'argent doit améliorer la situation, jamais la dégrader.
 *
 * On écarte donc les mois qui n'ont aucune commune mesure avec les autres, en comparant chaque mois
 * à la MÉDIANE DES AUTRES (robuste : une seule valeur aberrante ne peut pas se protéger elle-même).
 * Garde-fous : il faut au moins deux mois pour pouvoir comparer, et on ne renvoie jamais une liste
 * vide (sinon un revenu réellement irrégulier finirait par n'avoir plus aucun mois).
 */
function withoutExceptionalMonths(sums: number[]): number[] {
  if (sums.length < 2) return sums;
  const kept = sums.filter((v, i) => {
    const others = median(sums.filter((_, j) => j !== i));
    return !(others > 0) || v <= others * EXCEPTIONAL_MONTH_FACTOR;
  });
  return kept.length > 0 ? kept : sums;
}

/**
 * Revenu mensuel « de référence » pour les mois de sécurité : moyenne des SOMMES de recettes par
 * mois sur les 6 derniers mois (toutes recettes confondues, hors virements/brouillons/régul), les
 * mois EXCEPTIONNELS écartés (cf. withoutExceptionalMonths).
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
  // Les mois SANS COMMUNE MESURE avec les autres (rentrée exceptionnelle) ne disent rien du revenu
  // habituel : les garder faisait chuter le matelas de sécurité — et le profil — au moment précis
  // où l'utilisateur venait d'encaisser de l'argent.
  const sums = withoutExceptionalMonths(months.map((mk) => byMonth[mk].sum));
  const total = sums.reduce((s, v) => s + v, 0);
  return total / sums.length;
}

/**
 * Ce qu'une récurrence rapporte PAR MOIS, quelle que soit sa périodicité.
 *
 * Un revenu trimestriel de 6 000 € n'est pas « 6 000 € un mois et rien les deux suivants » quand on
 * cherche à savoir combien quelqu'un gagne : c'est 2 000 €/mois. Idem pour l'annuel. Le matelas de
 * sécurité et le profil raisonnent en rythme mensuel — on ramène donc tout au mois, y compris
 * l'hebdomadaire (4,33 semaines par mois en moyenne).
 */
function monthlyEquivalent(rule: string | null | undefined, amount: number): number {
  switch (rule) {
    case 'weekly': return amount * (365 / 12 / 7); // ≈ 4,348 occurrences par mois
    case 'monthly': return amount;
    case 'quarterly': return amount / 3;
    case 'yearly': return amount / 12;
    default: return 0;
  }
}

/**
 * La récurrence tourne-t-elle pendant le mois `mk` ?
 *
 * ⚠️ On ne peut PAS répondre avec la seule date du modèle. La matérialisation avance cette date au
 * fur et à mesure : un salaire tombé le 5 de ce mois laisse un modèle daté du mois PROCHAIN. Le
 * lire naïvement ferait conclure « pas encore commencée » pour le mois en cours — et ce mois-là
 * perdrait le salaire, alors qu'il vient d'être versé.
 *
 * D'où `running` : l'ensemble des modèles qui ont DÉJÀ produit au moins une occurrence réelle. Ils
 * tournent, point. Un modèle absent de cet ensemble n'a jamais rien versé : sa date est alors bien
 * sa première échéance, et on peut la comparer au mois.
 */
function isActiveInMonth(t: IncomeTx, mk: string, running: Set<string>): boolean {
  const [y, m] = mk.split('-').map(Number);
  const monthEnd = isoDay(new Date(y, m, 0)); // jour 0 du mois suivant = dernier jour de `mk`
  if (t.recurrence_end_date && t.recurrence_end_date < `${mk}-01`) return false; // déjà terminée
  if (t.id && running.has(String(t.id))) return true;                            // déjà en cours
  return t.date <= monthEnd;                                                     // 1ʳᵉ échéance
}

/**
 * REVENU MENSUEL estimé à partir d'un mois de référence — « combien il gagne, en gros, par mois ».
 *
 * On additionne TOUT, sans privilégier une source sur une autre :
 *  • les rentrées PONCTUELLES datées dans le mois — déjà tombées OU encore à venir. Une paie du 5
 *    déjà reçue et une prime du 28 à venir font un mois à deux rentrées, pas une ;
 *  • chaque RÉCURRENCE active, ramenée au mois (cf. monthlyEquivalent).
 *
 * Aucun euro n'est compté deux fois : les occurrences déjà matérialisées portent `materialized_from`
 * (migration 030) et sont donc écartées du premier point — c'est leur récurrence, ramenée au mois,
 * qui les représente. Sans cette exclusion, un salaire déjà tombé aurait compté une fois comme ligne
 * réelle et une fois comme récurrence.
 */
export function computeMonthIncome(
  transactions: IncomeTx[],
  checkingIds: Set<string>,
  mk: string,
): number {
  // Modèles ayant déjà produit une occurrence réelle → ils tournent (cf. isActiveInMonth).
  const running = new Set<string>();
  for (const t of transactions) if (t.materialized_from) running.add(String(t.materialized_from));

  let total = 0;
  for (const t of transactions) {
    if (!isRealIncome(t, checkingIds)) continue;
    const amount = Number(t.amount);
    if (t.is_recurring && t.recurrence_rule) {
      if (isActiveInMonth(t, mk, running)) total += monthlyEquivalent(t.recurrence_rule, amount);
    } else if (!t.materialized_from && t.date.slice(0, 7) === mk) {
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
