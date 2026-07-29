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
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

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
  const qualifies = (t: any) =>
    checkingIds.has(t.account_id) && !t.is_draft && !t.is_reserved && !t.linked_account_id
    && Number(t.amount) > 0 && t.date <= todayStr && !/r[ée]gul/i.test(t.note ?? '')
    // Un montant positif sur une catégorie de DÉPENSE = remboursement, pas un revenu.
    && (t as any).category?.type !== 'expense';

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

/** Équivalent MENSUEL d'une récurrence, quelle que soit sa périodicité. */
function monthlyEquivalent(rule: string | null | undefined, amount: number): number {
  switch (rule) {
    case 'weekly': return amount * 4.33;
    case 'monthly': return amount;
    case 'quarterly': return amount / 3;
    case 'yearly': return amount / 12;
    default: return 0;
  }
}

/**
 * Revenu mensuel DÉCLARÉ : somme des recettes récurrentes entrantes sur les comptes courants,
 * ramenées au mois. Contrairement au revenu constaté, la DATE n'entre pas en jeu — une récurrence
 * décrit un rythme, pas un événement passé.
 */
export function computeDeclaredMonthlyIncome(transactions: IncomeTx[], checkingIds: Set<string>): number {
  return transactions.reduce((sum, t: any) => {
    if (!checkingIds.has(t.account_id)) return sum;
    if (!t.is_recurring || !t.recurrence_rule) return sum;
    if (t.is_draft || t.linked_account_id) return sum;          // virement interne : pas un revenu
    if (Number(t.amount) <= 0) return sum;                      // dépense
    if (t.category?.type === 'expense') return sum;             // remboursement
    return sum + monthlyEquivalent(t.recurrence_rule, Number(t.amount));
  }, 0);
}

/**
 * LE revenu de référence de l'app — constaté si possible, DÉCLARÉ sinon.
 *
 * Pourquoi ce repli : le revenu constaté ne compte que les recettes DÉJÀ TOMBÉES (`date <= today`).
 * C'est juste pour un compte installé, mais faux au démarrage — et de la pire façon. Quelqu'un qui
 * crée son compte le 20 et saisit son salaire du 30 (ou du mois suivant, ce qui est parfaitement
 * légitime) n'avait AUCUN revenu constaté : le matelas de sécurité restait vide, le revenu de
 * référence affichait « — », et le profil financier restait bloqué sur P1 parce qu'il conclut
 * « aucun revenu » avant même de regarder l'épargne. Il fallait, par hasard, ressaisir une recette
 * antérieure au jour même pour que tout se débloque d'un coup.
 *
 * Or l'utilisateur A renseigné son revenu : il l'a déclaré en récurrente, ce que le parcours de
 * démarrage lui demande explicitement. Une récurrence mensuelle de 2 000 € DIT que le revenu
 * mensuel est de 2 000 €, que sa première occurrence soit demain ou le mois prochain. On s'en sert
 * donc tant qu'aucune recette n'est encore tombée, et le constaté reprend la main dès la première.
 */
export function computeReferenceMonthlyIncome(
  transactions: IncomeTx[],
  checkingIds: Set<string>,
  todayStr: string,
  profileCreatedAt?: string | null,
): number {
  const observed = computeAvgMonthlyIncome(transactions, checkingIds, todayStr, profileCreatedAt);
  if (observed > 0) return observed;
  return computeDeclaredMonthlyIncome(transactions, checkingIds);
}
