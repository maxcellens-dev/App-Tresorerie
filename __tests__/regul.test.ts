import { isRegul, isInitialBalanceAnchor, findRegulCategoryId, INITIAL_BALANCE_NOTE } from '../lib/regul';

describe('isRegul — identification unifiée', () => {
  it('reconnaît une régul par regul_target', () => {
    expect(isRegul({ regul_target: 1200 })).toBe(true);
    expect(isRegul({ regul_target: 0 })).toBe(true); // écart 0 = régul valide
  });

  it('reconnaît une régul par note (repli historique)', () => {
    expect(isRegul({ note: 'Régularisation solde' })).toBe(true);
    expect(isRegul({ note: 'Ajustement de solde' })).toBe(true);
    expect(isRegul({ note: 'regul' })).toBe(true);
  });

  it('reconnaît une régul par nom de catégorie', () => {
    expect(isRegul({ category: { name: 'Régularisation' } })).toBe(true);
  });

  it('ne confond pas une dépense normale', () => {
    expect(isRegul({ note: 'Courses', category: { name: 'Alimentation' } })).toBe(false);
    expect(isRegul(null)).toBe(false);
    expect(isRegul({})).toBe(false);
  });
});

// ── Ancre de solde initial ≠ écart constaté ───────────────────────────────────────────────────
// C'est cette distinction qui empêche la calibration de fiabilité (lib/reliabilityCalib) de
// prendre le solde de départ d'un compte pour de l'argent « perdu de vue ».
describe('isInitialBalanceAnchor', () => {
  it('reconnaît l’ancre posée à la création d’un compte', () => {
    expect(isInitialBalanceAnchor({ note: INITIAL_BALANCE_NOTE, regul_target: 21000 })).toBe(true);
  });

  it('ne confond pas une vraie régularisation de solde avec une ancre', () => {
    expect(isInitialBalanceAnchor({ note: 'Régularisation solde', regul_target: 1512 })).toBe(false);
    expect(isInitialBalanceAnchor({ note: 'Ajustement de solde', regul_target: 1512 })).toBe(false);
    expect(isInitialBalanceAnchor(null)).toBe(false);
  });

  it('une ancre reste bien une régularisation pour le moteur de solde', () => {
    // Elle doit continuer d'ancrer le solde et de compter comme « vérification n° 0 » :
    // seule la CALIBRATION de la dérive l'écarte.
    expect(isRegul({ note: INITIAL_BALANCE_NOTE, regul_target: 21000 })).toBe(true);
  });
});

/**
 * LA CATÉGORIE D'UNE RÉGULARISATION (migration 175).
 *
 * Elle était sans catégorie — parce que le moteur de solde SQL la reconnaissait précisément à ça.
 * Depuis que le marqueur est `regul_target`, elle peut être rangée : côté DÉPENSE quand le solde
 * baisse (« Frais variables › Régularisation Solde »), côté RECETTE quand il monte
 * (« Autres recettes › Régularisation Solde »).
 */
describe('findRegulCategoryId', () => {
  const cats = [
    { id: 'dep', name: 'Régularisation Solde', type: 'expense' },
    { id: 'rec', name: 'Régularisation Solde', type: 'income' },
    { id: 'x', name: 'Courses', type: 'expense' },
  ];

  it('range selon le SENS de la correction', () => {
    expect(findRegulCategoryId(cats, -80)).toBe('dep');   // il manquait 80 € → dépense
    expect(findRegulCategoryId(cats, 120)).toBe('rec');   // il y avait 120 € de plus → recette
  });

  it('un écart NUL (simple confirmation du solde) se range en recette, jamais en dépense', () => {
    expect(findRegulCategoryId(cats, 0)).toBe('rec');
  });

  it('tolère la casse et les espaces du référentiel', () => {
    expect(findRegulCategoryId([{ id: 'd', name: '  régularisation solde ', type: 'expense' }], -10)).toBe('d');
  });

  it('référentiel sans la catégorie → null : on écrit la régul sans catégorie, jamais d’échec', () => {
    expect(findRegulCategoryId([{ id: 'x', name: 'Courses', type: 'expense' }], -10)).toBeNull();
    expect(findRegulCategoryId(undefined, -10)).toBeNull();
  });
});
