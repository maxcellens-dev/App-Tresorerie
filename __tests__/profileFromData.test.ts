import { computeProfileFromData } from '../lib/financialProfileEngine';

/**
 * Le profil P1–P5 ne dépend plus d'AUCUNE réponse déclarée : il se déduit du revenu constaté, de
 * l'épargne, de ce qui est mis de côté chaque mois et de ce qui est réellement placé.
 */
const base = { availableSavings: 0, avgMonthlyIncome: 2000, monthlySetAside: 0, totalInvested: 0 };

describe('computeProfileFromData — le profil se déduit des données réelles', () => {
  it('sans revenu constaté → P1 (on ne devine pas)', () => {
    expect(computeProfileFromData({ ...base, avgMonthlyIncome: 0, availableSavings: 50000 })).toBe('P1');
  });

  it('compte neuf, rien de renseigné → P1', () => {
    expect(computeProfileFromData(base)).toBe('P1');
  });

  it('moins d’un mois de sécurité et rien mis de côté → P1', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 1000 })).toBe('P1');
  });

  it('moins d’un mois mais ≥ 10 % mis de côté → P2', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 1000, monthlySetAside: 250 })).toBe('P2');
  });

  it('1 à 3 mois de sécurité → P2', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 4000 })).toBe('P2');
  });

  it('1 à 3 mois avec un fort taux d’épargne (≥ 20 %) → P3', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 4000, monthlySetAside: 450 })).toBe('P3');
  });

  it('3 à 6 mois et il met de côté → P3', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 8000, monthlySetAside: 100 })).toBe('P3');
  });

  it('3 à 6 mois avec un fort taux d’épargne → P4', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 8000, monthlySetAside: 450 })).toBe('P4');
  });

  it('plus de 6 mois, sans placement → P4', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 20000 })).toBe('P4');
  });

  it('plus de 6 mois ET il investit réellement → P5', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 20000, totalInvested: 5000 })).toBe('P5');
  });

  it('plus de 6 mois ET un fort taux d’épargne → P5 (même sans placement)', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 20000, monthlySetAside: 500 })).toBe('P5');
  });

  it('le profil monte dès que la donnée manquante arrive (revenu renseigné)', () => {
    const sansRevenu = { availableSavings: 8000, avgMonthlyIncome: 0, monthlySetAside: 300, totalInvested: 0 };
    expect(computeProfileFromData(sansRevenu)).toBe('P1');
    // Même compte, une fois le revenu constaté : le profil apparaît immédiatement.
    // 8 000 € ÷ 2 000 € = 4 mois de sécurité, 300 €/mois mis de côté (15 %) → P3.
    expect(computeProfileFromData({ ...sansRevenu, avgMonthlyIncome: 2000 })).toBe('P3');
  });
});
