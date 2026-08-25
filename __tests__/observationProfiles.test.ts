import { buildObservationSignals, OBSERVATION_PRESETS } from '../lib/finance/observationProfiles';
import { computeConfidence, RELIABILITY_DEFAULTS, type DriftCalibration } from '../lib/finance/confidenceEngine';

const cfg = RELIABILITY_DEFAULTS;
const TODAY = new Date(2026, 7, 25, 12, 0, 0);
const ENVELOPE = 600;

describe('buildObservationSignals', () => {
  it('honorer 100 % de l’enveloppe produit exactement l’attendu de la période', () => {
    const { variableSpentByDay } = buildObservationSignals(TODAY, 21, ENVELOPE, {
      honoredPct: 100, pattern: 'even', entryDaysPct: 0,
    });
    const total = Object.values(variableSpentByDay).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo((ENVELOPE / 30.44) * 21, 2);
  });

  it('la répartition décide OÙ se trouve le silence', () => {
    const recent = buildObservationSignals(TODAY, 21, ENVELOPE, {
      honoredPct: 100, pattern: 'recent_only', entryDaysPct: 0,
    });
    const early = buildObservationSignals(TODAY, 21, ENVELOPE, {
      honoredPct: 100, pattern: 'early_then_silence', entryDaysPct: 0,
    });
    const today = '2026-08-25';
    expect(recent.variableSpentByDay[today]).toBeGreaterThan(0);
    expect(early.variableSpentByDay[today]).toBeUndefined();
  });

  it('l’assiduité peut dépasser les jours porteurs (saisie par lots mais ouverture quotidienne)', () => {
    const { activityDays } = buildObservationSignals(TODAY, 21, ENVELOPE, {
      honoredPct: 100, pattern: 'batched', entryDaysPct: 100,
    });
    expect(activityDays.length).toBe(21);
    expect(new Set(activityDays).size).toBe(21); // aucun doublon
  });

  it('sans enveloppe, aucune dépense n’est fabriquée', () => {
    const { variableSpentByDay } = buildObservationSignals(TODAY, 21, 0, {
      honoredPct: 200, pattern: 'even', entryDaysPct: 100,
    });
    expect(Object.keys(variableSpentByDay)).toHaveLength(0);
  });
});

/* Les préréglages sont le catalogue de cas de l'écran d'administration : s'ils cessaient de produire
   ce que leur intitulé annonce, l'aperçu mentirait — exactement ce qu'on cherche à éviter en
   branchant ces écrans sur les vrais moteurs. */
describe('OBSERVATION_PRESETS — chaque cas produit bien ce qu’il annonce', () => {
  const calibration: DriftCalibration = { medianAbsGap: 400, medianDaysBetween: 20, sampleCount: 4 };
  const run = (key: string) => {
    const preset = OBSERVATION_PRESETS.find((p) => p.key === key);
    if (!preset) throw new Error(`préréglage inconnu : ${key}`);
    const signals = buildObservationSignals(TODAY, 30, ENVELOPE, preset.profile);
    return computeConfidence({
      today: TODAY, lastVerifiedAt: '2026-08-04', calibration,
      relyka: 1012, floorBase: 3000, variableBase: ENVELOPE, config: cfg, ...signals,
    });
  };

  it('« ne saisit rien » laisse le doute entier', () => {
    const r = run('none');
    expect(r.observedRelief).toBe(0);
    expect(r.level).not.toBe('high');
  });

  it('« suit tout » (quotidien ou par lots) rend les chiffres nets', () => {
    expect(run('daily').level).toBe('high');
    expect(run('batched').level).toBe('high');
  });

  it('« assidu puis oubli » et « un seul gros achat » NE passent pas en confiance haute', () => {
    expect(run('forgot').level).not.toBe('high');
    expect(run('big').level).not.toBe('high');
  });

  it('« moitié de l’enveloppe » efface une partie du doute, sans plus', () => {
    const r = run('half');
    expect(r.observedRelief).toBeGreaterThan(0);
    expect(r.observedRelief).toBeLessThan(r.dailyDrift * r.daysSinceVerification);
  });
});
