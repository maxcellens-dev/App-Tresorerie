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
