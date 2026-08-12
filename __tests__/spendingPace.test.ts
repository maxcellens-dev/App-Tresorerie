import { variablePacePercentage } from '../lib/finance/spendingPace';

/**
 * Le défaut corrigé : l'app comparait le CUMUL du mois à l'enveloppe ENTIÈRE. Le 3 du mois ce
 * rapport vaut mécaniquement ~5 % — l'app en concluait « dépenses en baisse » et gonflait
 * « Confort », puis le laissait fondre jour après jour sans qu'aucune dépense ne l'explique.
 */
describe('variablePacePercentage — rythme, pas remplissage', () => {
  it('pile le rythme habituel = 100 %, quel que soit le jour', () => {
    // 1/4 du mois écoulé, 1/4 de l'enveloppe dépensée.
    expect(variablePacePercentage({ spent: 100, envelope: 400, dayOfMonth: 8, daysInMonth: 32 })).toBeCloseTo(100, 5);
    // Moitié du mois, moitié de l'enveloppe.
    expect(variablePacePercentage({ spent: 200, envelope: 400, dayOfMonth: 16, daysInMonth: 32 })).toBeCloseTo(100, 5);
    // Fin du mois, enveloppe consommée.
    expect(variablePacePercentage({ spent: 400, envelope: 400, dayOfMonth: 32, daysInMonth: 32 })).toBeCloseTo(100, 5);
  });

  it('le simple avancement du mois ne crée plus de « baisse » ni de « hausse »', () => {
    const jours = [8, 12, 16, 20, 24, 30];
    // Même comportement (rythme régulier) → même verdict tout le mois.
    const verdicts = jours.map((d) =>
      variablePacePercentage({ spent: (400 * d) / 30, envelope: 400, dayOfMonth: d, daysInMonth: 30 }),
    );
    for (const v of verdicts) expect(v).toBeCloseTo(100, 5);
  });

  it('dépenser plus vite que d’habitude ressort en > 100 %', () => {
    // Moitié du mois, 75 % de l'enveloppe déjà partie.
    expect(variablePacePercentage({ spent: 300, envelope: 400, dayOfMonth: 15, daysInMonth: 30 })).toBeCloseTo(150, 5);
  });

  it('dépenser moins vite ressort en < 100 %', () => {
    expect(variablePacePercentage({ spent: 100, envelope: 400, dayOfMonth: 15, daysInMonth: 30 })).toBeCloseTo(50, 5);
  });

  it('trop tôt dans le mois → null (on ne conclut RIEN sur 2 jours)', () => {
    expect(variablePacePercentage({ spent: 0, envelope: 400, dayOfMonth: 1, daysInMonth: 30 })).toBeNull();
    expect(variablePacePercentage({ spent: 60, envelope: 400, dayOfMonth: 5, daysInMonth: 30 })).toBeNull();
    // Au quart du mois, on commence à conclure.
    expect(variablePacePercentage({ spent: 100, envelope: 400, dayOfMonth: 8, daysInMonth: 30 })).not.toBeNull();
  });

  it('pas d’enveloppe de référence → null', () => {
    expect(variablePacePercentage({ spent: 200, envelope: 0, dayOfMonth: 15, daysInMonth: 30 })).toBeNull();
  });
});
