import {
  buildPerimeterCtx, fluxFactor, inPerimeter, transferLegFlux, effectiveSharedMode,
  transformFluxTransactions, splitPerimeterAccounts, FOYER_EXPENSE_NOTE,
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

  it('Tracked 50% : perso→joint 500 = complément 250 en dépense, jambe joint neutre (compté 1×)', () => {
    const ctx = ctxWith('tracked', 0.5);
    const persoLeg = transferLegFlux(-500, PERSO, JOINT, ctx);
    const jointLeg = transferLegFlux(+500, JOINT, PERSO, ctx);
    // La part du user (250) reste neutre ; seul le complément (250) est compté comme dépense.
    // La jambe côté joint (compte DANS le périmètre en mode tracked) est neutre → effet flux nul.
    expect(persoLeg).toEqual({ kind: 'expense', amount: 250 });
    expect(jointLeg.amount).toBe(0);
    expect(persoLeg.amount + jointLeg.amount).toBe(250); // compté une seule fois
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
    expect(t.amount).toBe(250);
  });
});

describe('transformFluxTransactions', () => {
  it('Contribution : dépense interne du joint retirée, virement perso→joint = dépense foyer', () => {
    const ctx = ctxWith('contribution', 0.5);
    const txs = [
      { id: 'a', account_id: PERSO, amount: -30, note: 'Courses' },                 // perso normale
      { id: 'b', account_id: JOINT, amount: -100, note: 'Crédit' },                 // interne joint → exclue
      { id: 'c', account_id: PERSO, linked_account_id: JOINT, amount: -500, note: 'Virement' }, // frontière
      { id: 'd', account_id: JOINT, linked_account_id: PERSO, amount: 500, note: 'Virement' },  // jambe joint → exclue
    ];
    const out = transformFluxTransactions(txs, ctx);
    expect(out.map((t) => t.id)).toEqual(['a', 'c']);
    const foyer = out.find((t) => t.id === 'c')!;
    expect(foyer.amount).toBe(-500);
    expect(foyer.linked_account_id).toBeNull();
    expect(foyer.note).toBe(FOYER_EXPENSE_NOTE);
  });

  it('Tracked 50% : virement perso→joint = dépense foyer du complément (250), interne joint conservé', () => {
    const ctx = ctxWith('tracked', 0.5);
    const txs = [
      { id: 'b', account_id: JOINT, amount: -100, note: 'Crédit' },                 // interne joint → conservé (au %)
      { id: 'c', account_id: PERSO, linked_account_id: JOINT, amount: -500 },        // frontière → 250
    ];
    const out = transformFluxTransactions(txs, ctx);
    expect(out.find((t) => t.id === 'b')).toBeTruthy();
    expect(out.find((t) => t.id === 'c')!.amount).toBe(-250);
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
