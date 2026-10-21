/**
 * Le Relyka à 0 dans le Jardin : une phrase dans le langage de l'arrosoir, selon le même ton que le
 * moteur (vide / versé / à sec) — et la date de la prochaine rentrée quand on la connaît.
 */
import { gardenRelykaZero } from '../lib/garden/relykaWords';

describe('gardenRelykaZero', () => {
  it("rien quand il reste de l'eau", () => {
    expect(gardenRelykaZero({ resteDisponibleBrut: 120 })).toBeNull();
  });

  it('arrosoir vide : tout est promis aux dépenses prévues (la réserve seule reste)', () => {
    const z = gardenRelykaZero({ resteDisponibleBrut: -50, safetyMarginDisplay: 200, nextIncomeDate: '2026-11-01' })!;
    expect(z.word).toBe('Ton arrosoir est vide ce mois-ci');
    expect(z.sub).toContain('1 novembre');
  });

  it('toute l’eau est versée : ce qui est mis de côté', () => {
    const z = gardenRelykaZero({ resteDisponibleBrut: -500, safetyMarginDisplay: 200, conservedTotal: 710 })!;
    expect(z.word).toBe('Toute ton eau est déjà versée');
    expect(z.sub.replace(/\s/g, ' ')).toContain('710 €');
  });

  it('à sec : toutes les réserves utilisées, et ce qui dépasse', () => {
    const z = gardenRelykaZero({ resteDisponibleBrut: -320, safetyMarginDisplay: 200, conservedTotal: 0 })!;
    expect(z.word).toBe('Ton arrosoir est à sec');
    expect(z.sub).toContain('Tu as utilisé toutes tes réserves ce mois-ci');
    expect(z.sub).toContain('prochaine rentrée');
  });
});
