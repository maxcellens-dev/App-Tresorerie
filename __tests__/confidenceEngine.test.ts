import {
  computeConfidence, toRange, computeCalibration, median, makeSubRanges,
  resolveReliabilityConfig, RELIABILITY_DEFAULTS, type DriftCalibration,
} from '../lib/finance/confidenceEngine';

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

  it('cold start : la méfiance porte sur l’enveloppe VARIABLE, pas sur le revenu entier', () => {
    const args = { today: TODAY, lastVerifiedAt: null, calibration: null, relyka: 500, floorBase: 3000, config: cfg };
    const sansEnveloppe = computeConfidence(args);
    const avecEnveloppe = computeConfidence({ ...args, variableBase: 1200 });
    // 1 200 × 0,10 ÷ 7 × 21 = 360 € au lieu de 3 000 × 0,10 ÷ 7 × 21 = 900 €.
    expect(sansEnveloppe.uncertaintyEur).toBeCloseTo(900, 0);
    expect(avecEnveloppe.uncertaintyEur).toBeCloseTo(360, 0);
    // Le RATIO reste jugé sur la base globale (stabilité des seuils).
    expect(avecEnveloppe.doubtRatio).toBeCloseTo(360 / 3000, 3);
  });

  it('cold start : enveloppe absurde (> base) ou nulle → repli sur la base', () => {
    const args = { today: TODAY, lastVerifiedAt: null, calibration: null, relyka: 500, floorBase: 3000, config: cfg };
    expect(computeConfidence({ ...args, variableBase: 0 }).uncertaintyEur).toBeCloseTo(900, 0);
    expect(computeConfidence({ ...args, variableBase: 99999 }).uncertaintyEur).toBeCloseTo(900, 0);
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
  const highConf = { level: 'high' as const, doubtRatio: 0, uncertaintyEur: 0, daysSinceVerification: 1, rawDaysSinceVerification: 1, neverVerified: false, dailyDrift: 0, coldStart: false, activityDamped: false };
  const medConf = { level: 'medium' as const, doubtRatio: 0.1, uncertaintyEur: 220, daysSinceVerification: 10, rawDaysSinceVerification: 10, neverVerified: false, dailyDrift: 22, coldStart: false, activityDamped: false };

  it('confiance haute = pas de fourchette', () => {
    expect(toRange(2000, highConf, cfg)).toEqual({ low: 2000, high: 2000, isRange: false });
  });

  it('confiance moyenne = fourchette descendante, borne basse arrondie à la centaine', () => {
    const r = toRange(2200, medConf, cfg);
    expect(r.isRange).toBe(true);
    expect(r.low).toBe(1900);  // 2 200 − 220 = 1 980 → 1 900 (arrondi vers le bas)
    expect(r.high).toBe(2200); // le haut, c'est le Relyka
    expect(r.low).toBeLessThan(r.high);
  });

  it('niveau « moyen » mais doute sous highMax (saisie récente) = PAS de fourchette (évite « 750–750 »)', () => {
    // Doute fortement réduit par l'amortisseur d'activité : ratio < highMax → un seul chiffre,
    // même si le niveau reste « medium » (« À jour » réservé à une vraie vérif).
    const damped = { level: 'medium' as const, doubtRatio: 0.03, uncertaintyEur: 20, daysSinceVerification: 8, rawDaysSinceVerification: 8, neverVerified: false, dailyDrift: 2.5, coldStart: false, activityDamped: true };
    expect(toRange(750, damped, cfg)).toEqual({ low: 750, high: 750, isRange: false });
  });

  it('borne basse jamais négative (doute plus large que le montant)', () => {
    const huge = { level: 'low' as const, doubtRatio: 0.9, uncertaintyEur: 1200, daysSinceVerification: 21, rawDaysSinceVerification: null, neverVerified: true, dailyDrift: 57, coldStart: true, activityDamped: false };
    const r = toRange(154, huge, cfg);
    expect(r.isRange).toBe(true);
    expect(r.low).toBe(0);
    expect(r.high).toBe(154); // le plafond reste le Relyka
  });

  /* Le Relyka est planché à 0 : en dessous, sa vraie valeur est NÉGATIVE. Fourcher autour de ce 0
     fabriquait une borne haute à partir de rien — « minimum sûr 0 € · jusqu'à 100 € si tout est à
     jour » s'affichait sous un « 0 € » rouge accompagné d'un message de budget dépassé. */
  it('aucune fourchette à zéro : l’incertitude ne rend pas de l’argent qui n’existe pas', () => {
    const huge = { level: 'low' as const, doubtRatio: 0.9, uncertaintyEur: 1200, daysSinceVerification: 21, rawDaysSinceVerification: null, neverVerified: true, dailyDrift: 57, coldStart: true, activityDamped: false };
    expect(toRange(0, huge, cfg)).toEqual({ low: 0, high: 0, isRange: false });
  });

  /* ── LA FOURCHETTE PROTÈGE, ELLE NE FAIT PAS ESPÉRER ───────────────────────────────────────────
     Elle valait auparavant [montant − doute ; montant + doute × ouverture] : la carte annonçait
     « 1 020 € » en grand et, juste dessous, « jusqu'à 1 200 € si tout est à jour » — un plafond
     SUPÉRIEUR au chiffre affiché, alors que le doute vient de ce qui n'est PAS saisi, c'est-à-dire
     de ce qui fait baisser le solde. Le haut de la fourchette est désormais le Relyka lui-même. */
  /* Une fourchette PROTÈGE, elle ne fait pas espérer : son plafond est le Relyka lui-même. Elle
     annonçait auparavant `net + doute × upBias` — donc plus que le chiffre affiché, et jusqu'à
     plusieurs fois sa valeur quand le doute est mesuré sur un revenu bien plus gros. */
  it('la borne haute EST le montant affiché — jamais au-dessus', () => {
    const r = toRange(1020, { ...medConf, doubtRatio: 0.2, uncertaintyEur: 620 }, cfg);
    expect(r.isRange).toBe(true);
    expect(r.high).toBe(1020);
    expect(r.low).toBe(400);
  });

  it('même avec un doute énorme, la fourchette ne promet rien de plus', () => {
    const r = toRange(150, { ...medConf, doubtRatio: 0.9, uncertaintyEur: 2000 }, cfg);
    expect(r.high).toBe(150);
    expect(r.low).toBe(0);
  });

  /* Balayage : l'invariant « bas ≤ montant = haut » doit tenir pour TOUS les montants, pas
     seulement celui qui a révélé le défaut. Sans le balayage, un changement d'arrondi (réglable en
     administration) pourrait le recasser sur une autre plage sans qu'aucun test ne bronche. */
  it('invariant : bas < montant = haut, sur toute la plage et quel que soit le pas', () => {
    for (const step of [10, 50, 100, 200, 500]) {
      for (let net = 20; net <= 5000; net += 10) {
        const uncertaintyEur = Math.max(10, net * 0.12);
        const c = { ...medConf, doubtRatio: 0.12, uncertaintyEur };
        const r = toRange(net, c, { ...cfg, roundStep: step });
        if (!r.isRange) continue;
        expect(r.high).toBe(net);
        expect(r.low).toBeLessThan(net);
        expect(r.low).toBeGreaterThanOrEqual(0);
      }
    }
  });

  /* La borne basse s'arrondit vers le BAS : la remonter reviendrait à annoncer un « minimum sûr »
     supérieur au minimum réellement calculé — le seul sens dans lequel il ne faut pas se tromper. */
  it('la borne basse est arrondie vers le bas, jamais vers le haut', () => {
    // 1 000 − 120 = 880 → 800 (et non 900, comme le ferait un arrondi au plus proche).
    expect(toRange(1000, { ...medConf, doubtRatio: 0.12, uncertaintyEur: 120 }, cfg).low).toBe(800);
  });

  it('garde-fou d’arrondi : bornes égales après arrondi → un seul chiffre (quel que soit le pas)', () => {
    // Doute au-dessus de highMax mais faible en €, gros pas d'arrondi → les bornes se rejoignent.
    const smallEur = { level: 'medium' as const, doubtRatio: 0.06, uncertaintyEur: 10, daysSinceVerification: 6, rawDaysSinceVerification: 6, neverVerified: false, dailyDrift: 1.7, coldStart: false, activityDamped: false };
    const r = toRange(720, smallEur, cfg); // roundStep 100 : 710→700 et 723→700
    expect(r.isRange).toBe(false);
    expect(r.low).toBe(720);
  });
});

describe('makeSubRanges — fourchettes des recos & montants proposés', () => {
  const conf = (uncertaintyEur: number) => ({
    level: 'medium' as const, doubtRatio: 0.2, uncertaintyEur,
    daysSinceVerification: 10, rawDaysSinceVerification: 10, neverVerified: false,
    dailyDrift: 1, coldStart: false, activityDamped: false,
  });

  it('confiance haute (pas de fourchette du Relyka) → sous-montants nets', () => {
    const { proportional, actionable } = makeSubRanges(
      1000, { low: 1000, high: 1000, isRange: false }, conf(0), cfg,
    );
    expect(proportional(400)).toEqual({ low: 400, high: 400, isRange: false });
    expect(actionable(400)).toEqual({ low: 400, high: 400, isRange: false });
  });

  it('fourchette : borne basse proportionnelle, plafond = le montant recommandé', () => {
    // Doute 200 sur un Relyka de 1 000 → borne basse à 80 % du montant, plafond = le montant.
    const { proportional } = makeSubRanges(1000, { low: 800, high: 1000, isRange: true }, conf(200), cfg);
    expect(proportional(400)).toEqual({ low: 320, high: 400, isRange: true });
  });

  it('LE CAS DU BUG : doute plus large que le Relyka → borne basse à 0 en affichage…', () => {
    // Relyka 154 €, doute 400 € (mesuré sur le revenu) : la borne basse proportionnelle vaut 0.
    const { proportional } = makeSubRanges(154, { low: 0, high: 300, isRange: true }, conf(400), cfg);
    expect(proportional(150).low).toBe(0);
  });

  it('… mais le montant PROPOSÉ ne descend jamais sous le plancher (plus de « Réserver 0 € »)', () => {
    const { actionable } = makeSubRanges(154, { low: 0, high: 300, isRange: true }, conf(400), cfg);
    const a = actionable(150);
    expect(a.low).toBe(Math.round(150 * cfg.minActionRatio)); // 60 €
    expect(a.isRange).toBe(true);
  });

  it('le plancher ne REMONTE jamais une borne basse déjà correcte', () => {
    const { actionable } = makeSubRanges(1000, { low: 800, high: 1100, isRange: true }, conf(200), cfg);
    expect(actionable(400).low).toBe(320); // 320 > 40 % × 400
  });

  it('plancher désactivé (1) → borne basse brute', () => {
    const { actionable } = makeSubRanges(
      154, { low: 0, high: 300, isRange: true }, conf(400), { ...cfg, minActionRatio: 1 },
    );
    expect(actionable(150).low).toBe(150);
  });
});

describe('resolveReliabilityConfig', () => {
  it('fusionne les réglages admin', () => {
    expect(resolveReliabilityConfig({ lowMin: 0.3 }).lowMin).toBe(0.3);
    expect(resolveReliabilityConfig(null).lowMin).toBe(RELIABILITY_DEFAULTS.lowMin);
  });

  /* La colonne est un JSON libre : une clé à `null` ou une chaîne restée telle quelle écrasait le
     défaut, et le « NaN » se propageait jusqu'au chiffre affiché (« NaN € »). */
  it('ignore tout ce qui n’est pas un nombre fini (null, texte, NaN)', () => {
    const c = resolveReliabilityConfig({
      lowMin: null, minActionRatio: '0,3', roundStep: NaN, highMax: 0.08,
    } as any);
    expect(c.lowMin).toBe(RELIABILITY_DEFAULTS.lowMin);
    expect(c.minActionRatio).toBe(RELIABILITY_DEFAULTS.minActionRatio);
    expect(c.roundStep).toBe(RELIABILITY_DEFAULTS.roundStep);
    expect(c.highMax).toBe(0.08); // le réglage valable, lui, passe
  });

  it('une clé inconnue n’entre pas dans la config', () => {
    expect((resolveReliabilityConfig({ nimporteQuoi: 42 } as any) as any).nimporteQuoi).toBeUndefined();
  });
});

describe('ancienneté de vérification — chiffre du calcul ≠ chiffre de la phrase', () => {
  const calib: DriftCalibration = { medianAbsGap: 60, medianDaysBetween: 30, sampleCount: 3 };

  it('le calcul plafonne, l’affichage dit la vérité', () => {
    const r = computeConfidence({
      today: TODAY, lastVerifiedAt: iso('2025-11-15'), calibration: calib, // ~242 jours
      relyka: 2000, floorBase: 2000, config: cfg,
    });
    expect(r.daysSinceVerification).toBe(cfg.coldStartDays); // le doute sature
    expect(r.rawDaysSinceVerification).toBeGreaterThan(200); // la phrase, elle, sait
    expect(r.neverVerified).toBe(false);
  });

  it('jamais vérifié → on ne prétend pas l’inverse', () => {
    const r = computeConfidence({
      today: TODAY, lastVerifiedAt: null, calibration: calib,
      relyka: 2000, floorBase: 2000, config: cfg,
    });
    expect(r.neverVerified).toBe(true);
    expect(r.rawDaysSinceVerification).toBeNull();
  });

  it('date illisible → traitée comme une absence de vérification', () => {
    const r = computeConfidence({
      today: TODAY, lastVerifiedAt: 'pas-une-date', calibration: calib,
      relyka: 2000, floorBase: 2000, config: cfg,
    });
    expect(r.neverVerified).toBe(true);
    expect(r.daysSinceVerification).toBe(cfg.coldStartDays);
  });
});

// ── Garde-fou : le doute ne peut pas dépasser la base de référence ────────────────────────────
// Régression observée en production : une calibration polluée par les ancres de solde initial
// (création de plusieurs comptes soldés d'un coup) donnait une dérive de plusieurs milliers
// d'euros par jour. Le tableau de bord annonçait « jusqu'à 10 300 € » pour un Relyka de 1 266 €,
// que son propre détail chiffrait correctement — deux montants contradictoires à l'écran.
describe('confidenceEngine — le doute est plafonné à la base', () => {
  const cfg = RELIABILITY_DEFAULTS;

  it('ne laisse pas une dérive aberrante dépasser la base de référence', () => {
    const res = computeConfidence({
      today: new Date('2026-07-28T00:00:00'),
      lastVerifiedAt: '2026-07-20',
      lastActivityAt: null,
      // 3 576 €/jour : ordre de grandeur réellement produit par la calibration polluée.
      calibration: { medianAbsGap: 75_100, medianDaysBetween: 21, sampleCount: 1 },
      relyka: 1266,
      floorBase: 2100,
      variableBase: 650,
      config: cfg,
    });
    // base = max(relyka, floorBase, plancher) = 2 100 → le doute ne peut pas la dépasser.
    expect(res.uncertaintyEur).toBeLessThanOrEqual(2100);
  });

  it('la borne haute reste du même ordre de grandeur que le montant affiché', () => {
    const res = computeConfidence({
      today: new Date('2026-07-28T00:00:00'),
      lastVerifiedAt: '2026-07-20',
      lastActivityAt: null,
      calibration: { medianAbsGap: 75_100, medianDaysBetween: 21, sampleCount: 1 },
      relyka: 1266,
      floorBase: 2100,
      variableBase: 650,
      config: cfg,
    });
    const range = toRange(1266, res, cfg);
    // Avant le plafond : high ≈ 10 300 €. Le chiffre principal contredisait son propre détail.
    expect(range.high).toBeLessThan(1266 * 3);
  });

  it('n’altère pas un doute normal (calibration saine)', () => {
    const res = computeConfidence({
      today: new Date('2026-07-28T00:00:00'),
      lastVerifiedAt: '2026-07-21',
      lastActivityAt: null,
      calibration: { medianAbsGap: 120, medianDaysBetween: 7, sampleCount: 3 },
      relyka: 1266,
      floorBase: 2100,
      variableBase: 650,
      config: cfg,
    });
    // 120/7 × 7 jours ≈ 120 € : très en dessous de la base, donc inchangé par le plafond.
    expect(Math.round(res.uncertaintyEur)).toBe(120);
  });
});
