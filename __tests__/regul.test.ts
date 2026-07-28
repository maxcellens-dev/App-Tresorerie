import { isRegul, isInitialBalanceAnchor, INITIAL_BALANCE_NOTE } from '../lib/regul';

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
