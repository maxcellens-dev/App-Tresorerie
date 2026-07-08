import { computeHealthScore, deriveEngaged, type ScoreInput } from '../lib/aiScore';

const base: ScoreInput = {
  income: 2333, realIncome: 4000, savings: 23000, invested: 95132,
  engagedMonthly: 2270, setAsideMonthly: 0, projectionMin: 800, margin: 2000,
  avgNet: null, reliableMonths: 1,
};

describe('deriveEngaged — pas de double-compte', () => {
  it('total = fixes + crédits perso + contribution (crédits joints exclus)', () => {
    const e = deriveEngaged(
      [{ impactPct: 50, monthly: 609 }, { impactPct: 100, monthly: 120 }],
      1315, 955,
    );
    expect(e.ownCredits).toBe(120);   // seul le crédit à 100 %
    expect(e.jointCredits).toBe(609); // info, PAS dans le total
    expect(e.total).toBe(1315 + 120 + 955);
  });
});

describe('computeHealthScore', () => {
  it('cas patrimoine solide / trésorerie en creux → score correct, pas sévère', () => {
    const r = computeHealthScore(base);
    // Sécurité 100 (9.9 mois), endettement bon (2270/4000=57%), invest élevé, projection basse.
    const sec = r.parts.find((p) => p.label === 'Sécurité')!;
    expect(sec.score).toBe(100);
    // Cash-flow exclu (1 seul mois fiable).
    expect(r.parts.find((p) => p.label === 'Cash-flow')!.score).toBeNull();
    // Global tiré vers le haut par patrimoine/sécurité malgré la projection basse.
    expect(r.global).toBeGreaterThanOrEqual(70);
    expect(r.global).toBeLessThanOrEqual(90);
  });

  it('endettement jugé sur les revenus RÉELS, pas la référence sous-estimée', () => {
    const low = computeHealthScore({ ...base, realIncome: 2333 }); // pas de revenu réel > référence
    const high = computeHealthScore(base); // realIncome 4000
    const endLow = low.parts.find((p) => p.label === 'Endettement')!.score!;
    const endHigh = high.parts.find((p) => p.label === 'Endettement')!.score!;
    expect(endHigh).toBeGreaterThan(endLow); // même engagement, meilleure capacité → meilleur score
  });

  it('cash-flow compté dès 2 mois fiables', () => {
    const r = computeHealthScore({ ...base, avgNet: 350, reliableMonths: 2 });
    expect(r.parts.find((p) => p.label === 'Cash-flow')!.score).not.toBeNull();
  });

  it('aucun revenu connu → sous-scores dépendant du revenu absents', () => {
    const r = computeHealthScore({ ...base, income: 0, realIncome: 0 });
    const labels = r.parts.map((p) => p.label);
    expect(labels).not.toContain('Sécurité');
    expect(labels).not.toContain('Investissement');
    expect(labels).not.toContain('Endettement');
  });
});
