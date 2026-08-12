import { computeEndOfMonthDelta, computeOpFeedback, consumesVariableEnvelope, touchesEndOfMonth } from '../lib/pulse/pulseDelta';
const today = new Date(2026, 6, 15); // 15 juillet 2026
const inMonth = '2026-07-20', nextMonth = '2026-08-03';
const past = '2026-07-15'; // aujourd'hui (opération échue)

describe('computeEndOfMonthDelta', () => {
  it('dépense sur compte courant du mois → −montant', () => {
    expect(computeEndOfMonthDelta({ kind: 'expense', amount: 100, accountType: 'checking', date: inMonth }, today)).toBe(-100);
  });
  it('recette sur compte courant du mois → +montant', () => {
    expect(computeEndOfMonthDelta({ kind: 'income', amount: 250, accountType: 'checking', date: inMonth }, today)).toBe(250);
  });
  it('dépense sur épargne → 0 (hors solde courant)', () => {
    expect(computeEndOfMonthDelta({ kind: 'expense', amount: 100, accountType: 'savings', date: inMonth }, today)).toBe(0);
  });
  it('virement courant → épargne → −montant', () => {
    expect(computeEndOfMonthDelta({ kind: 'transfer', amount: 400, fromType: 'checking', toType: 'savings', date: inMonth }, today)).toBe(-400);
  });
  it('virement épargne → courant → +montant', () => {
    expect(computeEndOfMonthDelta({ kind: 'transfer', amount: 400, fromType: 'savings', toType: 'checking', date: inMonth }, today)).toBe(400);
  });
  it('virement courant → courant → 0', () => {
    expect(computeEndOfMonthDelta({ kind: 'transfer', amount: 400, fromType: 'checking', toType: 'checking', date: inMonth }, today)).toBe(0);
  });
  it('opération datée du mois PROCHAIN → 0', () => {
    expect(computeEndOfMonthDelta({ kind: 'expense', amount: 100, accountType: 'checking', date: nextMonth }, today)).toBe(0);
  });
  it('sans date → 0 (on ne présume pas)', () => {
    expect(computeEndOfMonthDelta({ kind: 'expense', amount: 100, accountType: 'checking' }, today)).toBe(0);
  });

  // ── Enveloppe variable : la dépense du quotidien était DÉJÀ provisionnée dans le solde projeté ──
  it('dépense variable échue, enveloppe suffisante → 0 (absorbée, le solde projeté ne bouge pas)', () => {
    const op = { kind: 'expense' as const, amount: 100, accountType: 'checking', date: past, hitsVariableEnvelope: true };
    expect(computeEndOfMonthDelta(op, today, 300)).toBe(0);
  });
  it('dépense variable échue, enveloppe partielle → seul le dépassement creuse la fin de mois', () => {
    const op = { kind: 'expense' as const, amount: 100, accountType: 'checking', date: past, hitsVariableEnvelope: true };
    expect(computeEndOfMonthDelta(op, today, 40)).toBe(-60);
  });
  it('dépense variable échue, enveloppe épuisée → −montant', () => {
    const op = { kind: 'expense' as const, amount: 100, accountType: 'checking', date: past, hitsVariableEnvelope: true };
    expect(computeEndOfMonthDelta(op, today, 0)).toBe(-100);
  });
  it('dépense variable à VENIR → −montant (pas encore consommée sur l\'enveloppe)', () => {
    const op = { kind: 'expense' as const, amount: 100, accountType: 'checking', date: inMonth, isFuture: true, hitsVariableEnvelope: true };
    expect(computeEndOfMonthDelta(op, today, 300)).toBe(-100);
  });
  it('dépense NON variable (récurrente / hors budget) échue → −montant', () => {
    const op = { kind: 'expense' as const, amount: 100, accountType: 'checking', date: past };
    expect(computeEndOfMonthDelta(op, today, 300)).toBe(-100);
  });

  // ── Régularisation du même jour : « déjà incluse » = aucun solde ne bouge ──
  it('opération déjà comprise dans la régul du jour → aucun effet sur le solde', () => {
    const op = { kind: 'expense' as const, amount: 750, accountType: 'checking', date: past, regulCovered: true };
    expect(computeEndOfMonthDelta(op, today, 300)).toBe(0);
  });
  it('régul-couverte ET variable → l\'enveloppe se consomme, le solde projeté remonte d\'autant', () => {
    const op = { kind: 'expense' as const, amount: 100, accountType: 'checking', date: past, regulCovered: true, hitsVariableEnvelope: true };
    expect(computeEndOfMonthDelta(op, today, 300)).toBe(100);
  });
  it('recette déjà comprise dans la régul du jour → 0', () => {
    const op = { kind: 'income' as const, amount: 900, accountType: 'checking', date: past, regulCovered: true };
    expect(computeEndOfMonthDelta(op, today, 0)).toBe(0);
  });
});

describe('touchesEndOfMonth', () => {
  it('dépense du mois sur compte courant → concernée', () => {
    expect(touchesEndOfMonth({ kind: 'expense', amount: 10, accountType: 'checking', date: past }, today)).toBe(true);
  });
  it('dépense sur épargne → non concernée', () => {
    expect(touchesEndOfMonth({ kind: 'expense', amount: 10, accountType: 'savings', date: past }, today)).toBe(false);
  });
  it('mois prochain → non concernée', () => {
    expect(touchesEndOfMonth({ kind: 'expense', amount: 10, accountType: 'checking', date: nextMonth }, today)).toBe(false);
  });
  it('virement avec une jambe sur le courant → concernée', () => {
    expect(touchesEndOfMonth({ kind: 'transfer', amount: 10, fromType: 'checking', toType: 'savings', date: past }, today)).toBe(true);
  });
});

describe('computeOpFeedback — fin de mois', () => {
  const op = { kind: 'expense' as const, amount: 100, accountType: 'checking', date: past, hitsVariableEnvelope: true };

  it('sans données fraîches : estimation arithmétique, marquée non exacte', () => {
    const f = computeOpFeedback(op, null, null, {
      before: 1000, margin: 0, variableEnvelopeRemaining: 0, today,
    });
    expect(f.endOfMonth).toMatchObject({ amount: 900, delta: -100, exact: false, concerns: true });
  });

  it('avec le solde RECALCULÉ : c\'est lui qui fait foi, l\'écart s\'en déduit', () => {
    // L'estimation dirait 1000 (dépense absorbée) ; le recalcul dit 940 → on affiche 940 et −60.
    const f = computeOpFeedback(op, null, null, {
      before: 1000, after: 940, margin: 0, variableEnvelopeRemaining: 300, today,
    });
    expect(f.endOfMonth).toMatchObject({ amount: 940, delta: -60, exact: true });
  });

  it('marge de sécurité et découvert restent jugés sur le chiffre retenu', () => {
    const f = computeOpFeedback(op, null, null, { before: 1000, after: -20, margin: 300, today });
    expect(f.endOfMonth).toMatchObject({ negative: true, belowMargin: true });
  });

  it('solde projeté d\'avant inconnu → pas de ligne (plutôt qu\'un tiret)', () => {
    const f = computeOpFeedback(op, null, null, { before: null, margin: 0, today });
    expect(f.endOfMonth).toBeNull();
  });
});

/**
 * LE CHIFFRE QUI BOUGE VRAIMENT. Une dépense du quotidien ne déplace ni le Relyka ni la fin de mois
 * (elle était déjà provisionnée) : la carte de confirmation semblait alors ne rien enregistrer.
 * L'enveloppe variable, elle, a bougé — c'est elle qu'on montre.
 */
describe('computeOpFeedback — budget du quotidien', () => {
  const courses = { kind: 'expense' as const, amount: 100, accountType: 'checking', date: past, hitsVariableEnvelope: true };
  const eom = { before: 1000, margin: 0, variableEnvelopeInitial: 600, today };

  it('dépense absorbée : ce qui reste, sur combien, et pourquoi le Relyka ne bouge pas', () => {
    const f = computeOpFeedback(courses, 800, 800, { ...eom, variableEnvelopeRemaining: 300 });
    expect(f.envelope).toEqual({ initial: 600, remaining: 200, used: 100, absorbed: true, overflow: 0 });
  });

  it('dépassement : la part hors enveloppe est isolée (c’est elle qui creuse la fin de mois)', () => {
    const f = computeOpFeedback(courses, 800, 800, { ...eom, variableEnvelopeRemaining: 40 });
    expect(f.envelope).toMatchObject({ remaining: 0, used: 100, absorbed: false, overflow: 60 });
  });

  it('rien à montrer sans enveloppe estimée, ni pour une dépense à venir, ni hors quotidien', () => {
    expect(computeOpFeedback(courses, 800, 800, { before: 1000, margin: 0, today }).envelope).toBeNull();
    expect(computeOpFeedback({ ...courses, isFuture: true }, 800, 800, { ...eom, variableEnvelopeRemaining: 300 }).envelope).toBeNull();
    expect(computeOpFeedback({ ...courses, hitsVariableEnvelope: false }, 800, 800, { ...eom, variableEnvelopeRemaining: 300 }).envelope).toBeNull();
    expect(computeOpFeedback({ kind: 'income', amount: 100, accountType: 'checking', date: past }, 800, 800, { ...eom, variableEnvelopeRemaining: 300 }).envelope).toBeNull();
  });
});

/**
 * LA RÈGLE PARTAGÉE « cette dépense entame-t-elle le budget du quotidien ? ».
 *
 * Elle est lue par la carte de confirmation ET par le patch optimiste du tableau de bord : les deux
 * doivent répondre pareil, sans quoi la carte contredit l'écran derrière elle. Le piège est qu'une
 * jambe de virement n'a PAS de catégorie — exactement comme une dépense sans catégorie — et passait
 * donc pour une dépense du quotidien : virer 500 € vers l'épargne amputait l'enveloppe variable
 * d'autant. Même exclusion que `isBudgetExpense` (usePilotageData) : sur `linked_account_id`.
 */
describe('consumesVariableEnvelope', () => {
  const courses = { kind: 'expense' as const, accountType: 'checking' };

  it('une dépense du quotidien sans catégorie compte', () => {
    expect(consumesVariableEnvelope(courses)).toBe(true);
  });

  it('une JAMBE DE VIREMENT ne compte pas, même vue comme une sortie sans catégorie', () => {
    expect(consumesVariableEnvelope({ ...courses, linkedAccountId: 'compte-epargne' })).toBe(false);
    expect(consumesVariableEnvelope({ ...courses, kind: 'transfer' })).toBe(false);
  });

  it('ni une récurrente, ni une dépense de projet, ni un autre type de compte', () => {
    expect(consumesVariableEnvelope({ ...courses, isRecurring: true })).toBe(false);
    expect(consumesVariableEnvelope({ ...courses, projectId: 'p1' })).toBe(false);
    expect(consumesVariableEnvelope({ ...courses, accountType: 'savings' })).toBe(false);
  });

  it('une catégorie de RECETTE (remboursement) ne compte pas ; une catégorie de dépense oui', () => {
    expect(consumesVariableEnvelope({ ...courses, categoryId: 'c1', categoryType: 'income' })).toBe(false);
    expect(consumesVariableEnvelope({ ...courses, categoryId: 'c1', categoryType: 'expense' })).toBe(true);
  });
});
