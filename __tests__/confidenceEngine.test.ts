import {
  computeConfidence, toRange, computeCalibration, median,
  resolveReliabilityConfig, RELIABILITY_DEFAULTS, type DriftCalibration,
} from '../lib/confidenceEngine';

const cfg = RELIABILITY_DEFAULTS;
const TODAY = new Date('2026-07-15T00:00:00');

function iso(d: string) { return d; }

describe('median / computeCalibration', () => {
  it('médiane simple', () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([1, 3])).toBe(2);
    expect(median([3, 1, 2])).toBe(2);
  });
  it('calibration ignore les intervalles de 0 jour', () => {
    const c = computeCalibration([
      { absGap: 100, daysBetween: 10 },
      { absGap: 50, daysBetween: 0 },
      { absGap: 200, daysBetween: 20 },
    ]);
    expect(c.sampleCount).toBe(2);
    expect(c.medianAbsGap).toBe(150);
    expect(c.medianDaysBetween).toBe(15);
  });
});

describe('computeConfidence — niveaux', () => {
  const calibLow: DriftCalibration = { medianAbsGap: 10, medianDaysBetween: 30, sampleCount: 5 }; // dérive ~0.33/j

  it('user assidu (écarts ~0) reste en confiance haute longtemps', () => {
    const calib: DriftCalibration = { medianAbsGap: 2, medianDaysBetween: 30, sampleCount: 6 };
    const r = computeConfidence({
      today: TODAY, lastVerifiedAt: iso('2026-07-05'), calibration: calib,
      relyka: 2000, floorBase: 2000, config: cfg,
    });
    expect(r.level).toBe('high');
  });

  it('user qui dérive fort passe en confiance basse', () => {
    const calib: DriftCalibration = { medianAbsGap: 400, medianDaysBetween: 20, sampleCount: 4 }; // 20/j
    const r = computeConfidence({
      today: TODAY, lastVerifiedAt: iso('2026-06-25'), calibration: calib, // 20 jours
      relyka: 2000, floorBase: 2000, config: cfg,
    });
    // doute ≈ 20 × 20 = 400 ; ratio = 400/2000 = 0.20 → basse (>= lowMin)
    expect(r.level).toBe('low');
    expect(r.uncertaintyEur).toBeCloseTo(400, 0);
  });

  it('plancher : Relyka ≈ 0 n’explose pas le ratio (base = floorBase)', () => {
    const r = computeConfidence({
      today: TODAY, lastVerifiedAt: iso('2026-07-14'), calibration: calibLow,
      relyka: 0, floorBase: 2000, config: cfg,
    });
    // base = max(0, 2000, 100) = 2000, pas 0 → ratio fini et petit (1 jour de dérive)
    expect(Number.isFinite(r.doubtRatio)).toBe(true);
    expect(r.level).toBe('high');
  });

  it('vérif très ancienne : les jours comptés saturent au plafond coldStartDays', () => {
    const calib: DriftCalibration = { medianAbsGap: 90, medianDaysBetween: 30, sampleCount: 3 }; // 3/j
    const r = computeConfidence({
      today: TODAY, lastVerifiedAt: iso('2025-07-15'), calibration: calib, // 365 jours
      relyka: 2000, floorBase: 2000, config: cfg,
    });
    expect(r.daysSinceVerification).toBe(cfg.coldStartDays);
    expect(r.uncertaintyEur).toBeCloseTo(3 * cfg.coldStartDays, 0);
  });

  it('cold start (aucune vérif) : dérive prudente, marqué coldStart', () => {
    const r = computeConfidence({
      today: TODAY, lastVerifiedAt: null, calibration: null,
      relyka: 2000, floorBase: 2000, config: cfg,
    });
    expect(r.coldStart).toBe(true);
    expect(r.daysSinceVerification).toBe(cfg.coldStartDays);
    expect(r.uncertaintyEur).toBeGreaterThan(0);
  });
});

describe('computeConfidence — amortisseur d’activité (saisies du mois courant)', () => {
  // Dérive 20 €/j, vérif il y a 20 j → doute brut 400, ratio 0.20 → basse sans activité.
  const calib: DriftCalibration = { medianAbsGap: 400, medianDaysBetween: 20, sampleCount: 4 };
  const base = {
    today: TODAY, lastVerifiedAt: iso('2026-06-25'), calibration: calib,
    relyka: 2000, floorBase: 2000, config: cfg,
  };

  it('saisie du jour → doute réduit (× activityDampening) et niveau remonté bas → moyen', () => {
    const r = computeConfidence({ ...base, lastActivityAt: iso('2026-07-15') });
    expect(r.activityDamped).toBe(true);
    expect(r.uncertaintyEur).toBeCloseTo(400 * cfg.activityDampening, 0); // 200
    expect(r.level).toBe('medium'); // ratio 0.10, entre highMax et lowMin
  });

  it('amortissement dégressif : saisie en milieu de fenêtre → facteur intermédiaire', () => {
    // Saisie il y a 3 j sur une fenêtre de 7 → damp = 0.5 + 0.5 × 3/7 ≈ 0.714
    const r = computeConfidence({ ...base, lastActivityAt: iso('2026-07-12') });
    expect(r.activityDamped).toBe(true);
    expect(r.uncertaintyEur).toBeCloseTo(400 * (0.5 + 0.5 * (3 / 7)), 0);
  });

  it('saisie plus vieille que la fenêtre → aucun effet', () => {
    const r = computeConfidence({ ...base, lastActivityAt: iso('2026-07-01') }); // 14 j > 7
    expect(r.activityDamped).toBe(false);
    expect(r.uncertaintyEur).toBeCloseTo(400, 0);
    expect(r.level).toBe('low');
  });

  it('ne fait JAMAIS passer en confiance haute (« À jour » = vraie vérif uniquement)', () => {
    // Doute brut juste au-dessus de highMax : 20 €/j × 6 j = 120, ratio 0.06 ; amorti → 0.03 < highMax
    const r = computeConfidence({
      ...base, lastVerifiedAt: iso('2026-07-09'), lastActivityAt: iso('2026-07-15'),
    });
    expect(r.doubtRatio).toBeLessThan(cfg.highMax);
    expect(r.level).toBe('medium'); // plafonné : pas de « haute » par simple activité
  });

  it('confiance haute LÉGITIME (doute brut déjà sous le seuil) : reste haute malgré l’activité', () => {
    const calmCalib: DriftCalibration = { medianAbsGap: 2, medianDaysBetween: 30, sampleCount: 6 };
    const r = computeConfidence({
      ...base, calibration: calmCalib, lastVerifiedAt: iso('2026-07-05'), lastActivityAt: iso('2026-07-15'),
    });
    expect(r.level).toBe('high');
  });
});

describe('toRange', () => {
  const highConf = { level: 'high' as const, doubtRatio: 0, uncertaintyEur: 0, daysSinceVerification: 1, dailyDrift: 0, coldStart: false, activityDamped: false };
  const medConf = { level: 'medium' as const, doubtRatio: 0.1, uncertaintyEur: 220, daysSinceVerification: 10, dailyDrift: 22, coldStart: false, activityDamped: false };

  it('confiance haute = pas de fourchette', () => {
    expect(toRange(2000, highConf, cfg)).toEqual({ low: 2000, high: 2000, isRange: false });
  });

  it('confiance moyenne = fourchette arrondie à la centaine, biais bas', () => {
    const r = toRange(2200, medConf, cfg);
    expect(r.isRange).toBe(true);
    expect(r.low).toBe(2000); // 2200 - 220 = 1980 → 2000
    expect(r.high).toBe(2300); // 2200 + 220*0.3 = 2266 → 2300
    expect(r.low).toBeLessThan(r.high);
  });

  it('niveau « moyen » mais doute sous highMax (saisie récente) = PAS de fourchette (évite « 750–750 »)', () => {
    // Doute fortement réduit par l'amortisseur d'activité : ratio < highMax → un seul chiffre,
    // même si le niveau reste « medium » (« À jour » réservé à une vraie vérif).
    const damped = { level: 'medium' as const, doubtRatio: 0.03, uncertaintyEur: 20, daysSinceVerification: 8, dailyDrift: 2.5, coldStart: false, activityDamped: true };
    expect(toRange(750, damped, cfg)).toEqual({ low: 750, high: 750, isRange: false });
  });

  it('garde-fou d’arrondi : bornes égales après arrondi → un seul chiffre (quel que soit le pas)', () => {
    // Doute au-dessus de highMax mais faible en €, gros pas d'arrondi → les bornes se rejoignent.
    const smallEur = { level: 'medium' as const, doubtRatio: 0.06, uncertaintyEur: 10, daysSinceVerification: 6, dailyDrift: 1.7, coldStart: false, activityDamped: false };
    const r = toRange(720, smallEur, cfg); // roundStep 100 : 710→700 et 723→700
    expect(r.isRange).toBe(false);
    expect(r.low).toBe(720);
  });
});

describe('resolveReliabilityConfig', () => {
  it('fusionne les réglages admin', () => {
    expect(resolveReliabilityConfig({ lowMin: 0.3 }).lowMin).toBe(0.3);
    expect(resolveReliabilityConfig(null).lowMin).toBe(RELIABILITY_DEFAULTS.lowMin);
  });
});
