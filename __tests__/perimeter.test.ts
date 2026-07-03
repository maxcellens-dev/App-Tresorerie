import {
  buildPerimeterCtx, fluxFactor, inPerimeter, transferLegFlux, effectiveSharedMode,
  transformFluxTransactions, splitPerimeterAccounts, SHARED_TRANSFER_EXPENSE_NOTE,
} from '../lib/perimeter';

const PERSO = 'perso';
const JOINT = 'joint';

function ctxWith(mode: 'contribution' | 'tracked' | null, factor: number) {
  return buildPerimeterCtx([
    { id: PERSO, isShared: false },
    { id: JOINT, isShared: true, shared_mode: mode, factor },
  ]);
}

describe('effectiveSharedMode', () => {
  it('NULL = tracked (comportement historique)', () => {
    expect(effectiveSharedMode(null)).toBe('tracked');
    expect(effectiveSharedMode(undefined)).toBe('tracked');
    expect(effectiveSharedMode('contribution')).toBe('contribution');
  });
});

describe('fluxFactor / inPerimeter', () => {
  it('perso = 1 et dans le périmètre', () => {
    const ctx = ctxWith('contribution', 0.5);
    expect(fluxFactor(ctx, PERSO)).toBe(1);
    expect(inPerimeter(ctx, PERSO)).toBe(true);
  });
  it('joint contribution = 0, hors périmètre', () => {
    const ctx = ctxWith('contribution', 0.5);
    expect(fluxFactor(ctx, JOINT)).toBe(0);
    expect(inPerimeter(ctx, JOINT)).toBe(false);
  });
  it('joint tracked = factor, dans le périmètre', () => {
    const ctx = ctxWith('tracked', 0.5);
    expect(fluxFactor(ctx, JOINT)).toBe(0.5);
    expect(inPerimeter(ctx, JOINT)).toBe(true);
  });
});

describe('transferLegFlux — virement trans-frontière (pas de double comptage)', () => {
  it('Contribution : perso→joint 500 = 100% dépense sur la jambe perso, jambe joint exclue', () => {
    const ctx = ctxWith('contribution', 0.5);
    const persoLeg = transferLegFlux(-500, PERSO, JOINT, ctx);
    const jointLeg = transferLegFlux(+500, JOINT, PERSO, ctx);
    expect(persoLeg).toEqual({ kind: 'expense', amount: 500 });
    expect(jointLeg).toEqual({ kind: 'excluded', amount: 0 });
    // Total compté une seule fois = 500 €.
    expect(persoLeg.amount + jointLeg.amount).toBe(500);
  });

  it('Tracked (suivi partagé) : perso→joint = NEUTRE (mouvement interne au périmètre)', () => {
    const ctx = ctxWith('tracked', 0.5);
    // Le joint « suivi » est DANS le périmètre → le virement ne compte PAS (ni dépense, ni prorata).
    // Ce sont les flux internes du joint qui comptent, à hauteur de la part.
    expect(transferLegFlux(-500, PERSO, JOINT, ctx).kind).toBe('neutral');
    expect(transferLegFlux(+500, JOINT, PERSO, ctx).kind).toBe('neutral');
  });

  it('Contribution : joint→perso 500 = 100% recette', () => {
    const ctx = ctxWith('contribution', 0.5);
    const persoLeg = transferLegFlux(+500, PERSO, JOINT, ctx);
    expect(persoLeg).toEqual({ kind: 'income', amount: 500 });
  });

  it('Tracked 100% (un seul participant) : aucun complément → neutre', () => {
    const ctx = ctxWith('tracked', 1);
    expect(transferLegFlux(-500, PERSO, JOINT, ctx).kind).toBe('neutral');
  });

  it('Virement interne perso→perso = neutre', () => {
    const ctx = buildPerimeterCtx([
      { id: 'a', isShared: false }, { id: 'b', isShared: false },
    ]);
    expect(transferLegFlux(-500, 'a', 'b', ctx).kind).toBe('neutral');
  });

  it('Patrimoine invariant : le mode ne change JAMAIS le facteur de part (0.5 dans les 2 modes)', () => {
    expect(ctxWith('contribution', 0.5).byId[JOINT].factor).toBe(0.5);
    expect(ctxWith('tracked', 0.5).byId[JOINT].factor).toBe(0.5);
  });

  it('Bascule de mode aller-retour : contribution→tracked→contribution redonne le même résultat', () => {
    const c1 = transferLegFlux(-500, PERSO, JOINT, ctxWith('contribution', 0.5));
    const t = transferLegFlux(-500, PERSO, JOINT, ctxWith('tracked', 0.5));
    const c2 = transferLegFlux(-500, PERSO, JOINT, ctxWith('contribution', 0.5));
    expect(c1).toEqual(c2);
    expect(c1.amount).toBe(500);
    expect(t.kind).toBe('neutral'); // tracked = neutre
  });
});

describe('transformFluxTransactions', () => {
  it('Contribution : interne du joint retirée, virement perso→joint = dépense (libellé D’ORIGINE conservé)', () => {
    const ctx = ctxWith('contribution', 0.5);
    const txs = [
      { id: 'a', account_id: PERSO, amount: -30, note: 'Courses' },                 // perso normale
      { id: 'b', account_id: JOINT, amount: -100, note: 'Crédit' },                 // interne joint → exclue
      { id: 'c', account_id: PERSO, linked_account_id: JOINT, amount: -500, note: 'Loyer commun' }, // frontière
      { id: 'd', account_id: JOINT, linked_account_id: PERSO, amount: 500, note: 'Virement' },  // jambe joint → exclue
    ];
    const out = transformFluxTransactions(txs, ctx);
    expect(out.map((t) => t.id)).toEqual(['a', 'c']);
    const shared = out.find((t) => t.id === 'c')!;
    expect(shared.amount).toBe(-500);
    expect(shared.linked_account_id).toBeNull();
    expect(shared.note).toBe('Loyer commun');                          // libellé d'origine conservé
    expect((shared as any)._perimeter_synthetic).toBe(true);           // marqueur mouvement partagé
  });

  it('Contribution : repli sur le libellé générique si le virement n’a pas de note', () => {
    const ctx = ctxWith('contribution', 0.5);
    const out = transformFluxTransactions([{ id: 'c', account_id: PERSO, linked_account_id: JOINT, amount: -500 } as any], ctx);
    expect((out.find((t) => t.id === 'c') as any).note).toBe(SHARED_TRANSFER_EXPENSE_NOTE);
  });

  it('Tracked (suivi partagé) : virement perso→joint reste NEUTRE (conservé tel quel), interne joint conservé', () => {
    const ctx = ctxWith('tracked', 0.5);
    const txs = [
      { id: 'b', account_id: JOINT, amount: -100, note: 'Crédit' },                 // interne joint → conservé (au %)
      { id: 'c', account_id: PERSO, linked_account_id: JOINT, amount: -500 },        // frontière → NEUTRE (inchangé)
    ];
    const out = transformFluxTransactions(txs, ctx);
    expect(out.find((t) => t.id === 'b')).toBeTruthy();
    const c = out.find((t) => t.id === 'c')!;
    expect(c.amount).toBe(-500);                 // montant inchangé
    expect(c.linked_account_id).toBe(JOINT);      // reste un virement interne neutre
  });

  it('splitPerimeterAccounts : le joint contribution sort du flux', () => {
    const ctx = ctxWith('contribution', 0.5);
    const { perimeter, outside } = splitPerimeterAccounts(
      [{ id: PERSO, balance: 1000 }, { id: JOINT, balance: 250 }], ctx,
    );
    expect(perimeter.map((a) => a.id)).toEqual([PERSO]);
    expect(outside.map((a) => a.id)).toEqual([JOINT]);
  });
});
