// Périmètre quotidien — définit quels comptes entrent dans le budget FLUX du user
// (Suivi du mois, Relyka, recommandations, projection) et comment interpréter les virements.
//
// Règle unique :
//   • argent qui bouge À L'INTÉRIEUR du périmètre = virement neutre ;
//   • argent qui SORT du périmètre = dépense ; argent qui ENTRE = recette ;
//   • ce qui se passe entièrement HORS périmètre = invisible pour le budget.
//
// Deux vues distinctes :
//   • Patrimoine (écran Comptes) : la part du user dans un joint compte TOUJOURS (au %).
//   • Flux (budget) : s'arrête à la frontière du périmètre — c'est CE module.
//
// L'historique n'est JAMAIS réécrit : le mode est une règle d'INTERPRÉTATION appliquée au calcul
// des agrégats. Un changement de mode est donc réversible et sans perte.

export type SharedMode = 'contribution' | 'tracked';

/**
 * Mode effectif d'un compte partagé.
 * NULL en base = non répondu → 'tracked' (comportement historique conservé, décision produit).
 */
export function effectiveSharedMode(mode: string | null | undefined): SharedMode {
  return mode === 'contribution' ? 'contribution' : 'tracked';
}

export interface PerimeterAccountMeta {
  /** Compte partagé/joint (au moins un autre participant) vs compte perso. */
  isShared: boolean;
  /** Mode effectif (n'a de sens que si isShared). */
  mode: SharedMode;
  /** Facteur d'impact 0..1 (% de part du user). 1 pour un compte perso. */
  factor: number;
  /** Type du compte (checking/savings/investment/other) — pour router les mouvements. */
  type?: string;
}

export interface PerimeterCtx {
  byId: Record<string, PerimeterAccountMeta>;
}

/** Construit le contexte depuis une liste de comptes annotés (perso + partagés). */
export function buildPerimeterCtx(
  accounts: Array<{ id: string; isShared: boolean; shared_mode?: string | null; factor?: number; type?: string }>,
): PerimeterCtx {
  const byId: Record<string, PerimeterAccountMeta> = {};
  for (const a of accounts) {
    byId[a.id] = {
      isShared: a.isShared,
      mode: effectiveSharedMode(a.shared_mode),
      factor: a.isShared ? (a.factor ?? 1) : 1,
      type: a.type,
    };
  }
  return { byId };
}

/**
 * Fraction de l'activité d'un compte qui compte dans le budget FLUX du user :
 *   • perso           → 1
 *   • joint « tracked »→ factor (%)
 *   • joint « contribution » → 0 (hors périmètre pour le flux)
 * Compte inconnu → 1 (prudence : ne rien masquer par erreur).
 */
export function fluxFactor(ctx: PerimeterCtx, accountId: string | null | undefined): number {
  if (!accountId) return 1;
  const m = ctx.byId[accountId];
  if (!m) return 1;
  if (!m.isShared) return 1;
  return m.mode === 'contribution' ? 0 : m.factor;
}

/** true si le compte fait partie du périmètre quotidien (perso, ou joint suivi). */
export function inPerimeter(ctx: PerimeterCtx, accountId: string | null | undefined): boolean {
  if (!accountId) return true;
  const m = ctx.byId[accountId];
  if (!m) return true;
  return !m.isShared || m.mode === 'tracked';
}

export type LegFluxKind = 'neutral' | 'expense' | 'income' | 'excluded';

export interface LegFlux {
  kind: LegFluxKind;
  /** Montant POSITIF de l'effet (dépense/recette). 0 pour neutral/excluded. */
  amount: number;
}

/**
 * Effet d'une JAMBE de virement sur le budget flux du user.
 * `legAmount` = montant SIGNÉ de la jambe (négatif = sortie du compte `ownId`).
 * `ownId` = compte de la jambe ; `otherId` = compte de l'autre jambe.
 *
 * - Jambe sur un compte HORS périmètre (ex. côté joint d'un virement, ou joint « contribution »)
 *   → 'excluded' (l'autre jambe porte déjà l'effet ; évite tout double comptage).
 * - Virement entre deux comptes DU périmètre → 'neutral' (mouvement interne ; l'épargne/invest est
 *   gérée par la logique dédiée de l'appelant, pas ici).
 * - Frontière (compte du périmètre ↔ joint) : la part complémentaire `(1 − fluxFactor(joint))`
 *   du montant devient dépense (sortie) ou recette (entrée). La part du user reste neutre.
 *     • joint « contribution » : complément = 1 → 100 % dépense/recette.
 *     • joint « tracked » à X % : complément = 1 − X → « part versée/reçue du foyer ».
 */
export function transferLegFlux(
  legAmount: number,
  ownId: string,
  otherId: string,
  ctx: PerimeterCtx,
): LegFlux {
  // Jambe sur un compte HORS périmètre (joint « contribution ») → l'autre jambe porte l'effet.
  if (fluxFactor(ctx, ownId) === 0) return { kind: 'excluded', amount: 0 };
  // L'autre compte est DANS le périmètre (perso OU joint « suivi partagé ») → mouvement interne NEUTRE.
  // En « suivi partagé » le joint fait partie du périmètre : le virement ne compte pas (ce sont les
  // flux internes du joint qui comptent, à hauteur de la part) → surtout PAS de dépense au prorata.
  if (inPerimeter(ctx, otherId)) return { kind: 'neutral', amount: 0 };
  // L'autre compte est HORS périmètre (joint « contribution ») → TOUT le montant franchit la frontière.
  const amount = Math.abs(legAmount);
  // legAmount < 0 : l'argent SORT vers le compte partagé → dépense. > 0 : ENTRE → recette.
  return { kind: legAmount < 0 ? 'expense' : 'income', amount };
}

/** Libellés des mouvements vers/depuis un compte partagé hors périmètre (mode Contribution). */
export const SHARED_TRANSFER_EXPENSE_NOTE = 'Versé au compte partagé';
export const SHARED_TRANSFER_INCOME_NOTE = 'Reçu du compte partagé';

/** Transaction minimale manipulée par la transformation de flux (les autres champs sont préservés). */
export interface FluxTxLike {
  id?: string;
  account_id: string;
  linked_account_id?: string | null;
  amount: number;
  note?: string | null;
  category_id?: string | null;
  category?: any;
}

/**
 * Réécrit la liste de transactions pour la VUE FLUX (budget), selon le périmètre.
 * L'historique en base n'est PAS touché : c'est une réinterprétation en mémoire.
 *
 *   • tx d'un compte HORS périmètre (joint « contribution » interne, ou jambe côté joint d'un
 *     virement) → retirée du flux ;
 *   • jambe de virement trans-frontière côté périmètre → remplacée par une dépense/recette
 *     synthétique du complément « Versé/Reçu du foyer » (part du user = neutre, non comptée) ;
 *   • tout le reste → conservé tel quel.
 */
export function transformFluxTransactions<T extends FluxTxLike>(txs: T[], ctx: PerimeterCtx): T[] {
  const out: T[] = [];
  for (const t of txs) {
    const ownFlux = fluxFactor(ctx, t.account_id);
    if (ownFlux === 0) continue; // hors périmètre → invisible pour le budget

    const other = t.linked_account_id;
    if (other && ctx.byId[other]?.isShared) {
      const leg = transferLegFlux(t.amount, t.account_id, other, ctx);
      if (leg.kind === 'expense' || leg.kind === 'income') {
        const signed = leg.kind === 'expense' ? -leg.amount : leg.amount;
        out.push({
          ...t,
          amount: signed,
          linked_account_id: null,
          category_id: null,
          category: null,
          // On GARDE le libellé d'origine du virement (comme toute transaction) ; repli générique
          // seulement si la transaction n'avait aucun libellé.
          note: t.note ?? (leg.kind === 'expense' ? SHARED_TRANSFER_EXPENSE_NOTE : SHARED_TRANSFER_INCOME_NOTE),
          _perimeter_synthetic: true,
          // Type du compte partagé cible (checking/savings/investment) → permet aux écrans de router
          // ce mouvement (dépense « Comptes partagés » vs « Autre (épargne/invest) »).
          _shared_target_type: ctx.byId[other]?.type ?? 'checking',
        } as unknown as T);
        continue;
      }
      // kind 'neutral' → joint « suivi partagé » (dans le périmètre) : on GARDE la jambe telle quelle
      // (virement interne neutre, exactement comme le comportement historique).
      out.push(t);
      continue;
    }
    out.push(t);
  }
  return out;
}

/** Sépare les comptes en « dans le périmètre » (flux) et « hors périmètre » (part patrimoniale du joint). */
export function splitPerimeterAccounts<T extends { id: string }>(
  accounts: T[],
  ctx: PerimeterCtx,
): { perimeter: T[]; outside: T[] } {
  const perimeter: T[] = [];
  const outside: T[] = [];
  for (const a of accounts) {
    if (fluxFactor(ctx, a.id) === 0) outside.push(a);
    else perimeter.push(a);
  }
  return { perimeter, outside };
}
