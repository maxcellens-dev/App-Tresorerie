import { isRegul } from '../lib/regul';

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
