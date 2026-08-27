import {
  computeConfidence, toRange, computeCalibration, median, makeSubRanges,
  resolveReliabilityConfig, RELIABILITY_DEFAULTS, type DriftCalibration,
} from '../lib/finance/confidenceEngine';

const cfg = RELIABILITY_DEFAULTS;
const TODAY = new Date('2026-07-15T00:00:00');

function iso(d: string) { return d; }

/** Clé de jour (locale) à n jours avant TODAY — même convention que le moteur. */
function daysAgo(n: number): string {
  const d = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** n jours consécutifs finissant aujourd'hui : suivi quotidien sans trou. */
function everyDay(n: number): string[] {
  return Array.from({ length: n }, (_, i) => daysAgo(i));
}
/** Même chose, avec un montant de dépenses variables par jour. */
function spentEveryDay(n: number, perDay: number): Record<string, number> {
  return Object.fromEntries(everyDay(n).map((k) => [k, perDay]));
}

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

/* ── B. L'AMORTISSEUR RÉCOMPENSE L'ASSIDUITÉ, PLUS LA RÉCENCE ──────────────────────────────────
   Il suffisait d'UNE saisie dans la journée pour obtenir le demi-doute d'un suivi quotidien — et six
   jours de silence derrière n'y changeaient rien. C'est ce qui faisait dire « je saisis et rien ne
   bouge » : l'app ne comptait pas ce qu'on saisit, seulement quand. */
describe('computeConfidence — amortisseur d’assiduité (couverture de saisie)', () => {
  // Dérive 20 €/j, vérif il y a 20 j → doute brut 400, ratio 0.20 → basse sans activité.
  const calib: DriftCalibration = { medianAbsGap: 400, medianDaysBetween: 20, sampleCount: 4 };
  const base = {
    today: TODAY, lastVerifiedAt: iso('2026-06-25'), calibration: calib,
    relyka: 2000, floorBase: 2000, config: cfg,
  };

  it('aucune saisie → doute intact', () => {
    const r = computeConfidence(base);
    expect(r.activityCoverage).toBe(0);
    expect(r.activityDamped).toBe(false);
    expect(r.uncertaintyEur).toBeCloseTo(400, 0);
    expect(r.level).toBe('low');
  });

  it('une saisie chaque jour de la fenêtre → amortissement PLEIN', () => {
    const r = computeConfidence({ ...base, activityDays: everyDay(7) });
    expect(r.activityCoverage).toBe(1);
    expect(r.uncertaintyEur).toBeCloseTo(400 * cfg.activityDampening, 0); // 200
    expect(r.level).toBe('medium'); // ratio 0.10, entre highMax et lowMin
  });

  it('couverture partielle → amortissement proportionnel', () => {
    // 3 jours sur 7 → damp = 1 − 0.5 × 3/7 ≈ 0.786
    const r = computeConfidence({ ...base, activityDays: [daysAgo(0), daysAgo(2), daysAgo(5)] });
    expect(r.activityCoverage).toBeCloseTo(3 / 7, 3);
    expect(r.uncertaintyEur).toBeCloseTo(400 * (1 - 0.5 * (3 / 7)), 0);
  });

  it('un tap isolé ne vaut PLUS le demi-doute d’un suivi quotidien', () => {
    const isole = computeConfidence({ ...base, activityDays: [daysAgo(0)] });
    const assidu = computeConfidence({ ...base, activityDays: everyDay(7) });
    expect(isole.uncertaintyEur).toBeCloseTo(400 * (1 - 0.5 / 7), 0); // ≈ 371, et non 200
    expect(isole.uncertaintyEur).toBeGreaterThan(assidu.uncertaintyEur);
  });

  it('saisies plus vieilles que la fenêtre → aucun effet', () => {
    const r = computeConfidence({ ...base, activityDays: [daysAgo(10), daysAgo(12)] });
    expect(r.activityCoverage).toBe(0);
    expect(r.uncertaintyEur).toBeCloseTo(400, 0);
    expect(r.level).toBe('low');
  });

  /* ── DATER LES SAISIES, PAS SEULEMENT LES VÉRIFICATIONS ─────────────────────────────────────
     Les messages parlaient tous d'un solde « non vérifié » — un geste qui se fait dans l'appli de sa
     banque. Or noter une dépense resserre déjà la fourchette : encore faut-il pouvoir dire depuis
     quand plus rien n'a été noté. Cette valeur ne sert QU'À ÇA (aucun calcul ne la lit). */
  it('date la dernière saisie, même hors fenêtre d’assiduité', () => {
    // 10 jours : bien au-delà des 7 jours de couverture, mais dans la fenêtre d'observation (30 j).
    const r = computeConfidence({ ...base, activityDays: [daysAgo(10), daysAgo(12)] });
    expect(r.daysSinceLastEntry).toBe(10);
    expect(r.activityCoverage).toBe(0);   // …sans rien changer à l'amortissement
  });

  it('saisie du jour → 0 ; aucune saisie connue → null', () => {
    expect(computeConfidence({ ...base, activityDays: [daysAgo(0)] }).daysSinceLastEntry).toBe(0);
    expect(computeConfidence(base).daysSinceLastEntry).toBeNull();
    expect(computeConfidence({ ...base, activityDays: [] }).daysSinceLastEntry).toBeNull();
  });

  it('au-delà de la fenêtre d’observation, on ne date plus rien', () => {
    const r = computeConfidence({ ...base, activityDays: [daysAgo(45)] });
    expect(r.daysSinceLastEntry).toBeNull();
  });

  it('assiduité insuffisante → toujours pas de confiance haute par simple amortissement', () => {
    // Doute brut juste au-dessus de highMax : 20 €/j × 6 j = 120, ratio 0.06 ; couverture 3/6 = 0.5
    // → amorti à 0.045 < highMax, mais sous le seuil d'assiduité → le verrou tient.
    const r = computeConfidence({
      ...base, lastVerifiedAt: iso('2026-07-09'),
      activityDays: [daysAgo(0), daysAgo(1), daysAgo(2)],
    });
    expect(r.doubtRatio).toBeLessThan(cfg.highMax);
    expect(r.activityCoverage).toBeCloseTo(0.5, 3);
    expect(r.level).toBe('medium');
  });

  it('assiduité RÉELLE → le verrou est levé (vérifier ne sert qu’à retrouver ce qui manque)', () => {
    const r = computeConfidence({
      ...base, lastVerifiedAt: iso('2026-07-09'), activityDays: everyDay(6),
    });
    expect(r.activityCoverage).toBe(1);
    expect(r.doubtRatio).toBeLessThan(cfg.highMax);
    expect(r.level).toBe('high');
  });

  it('mais jamais sans vérification passée : l’assiduité ne dit rien du point de départ', () => {
    // Dérive 6 €/j × 21 j (plafond) = 126 → ratio 0.063, AU-DESSUS de highMax ; amorti à 0.031, en
    // dessous. Avec une vérif passée, l'assiduité donnerait « À jour » — ici, non.
    const drift6: DriftCalibration = { medianAbsGap: 180, medianDaysBetween: 30, sampleCount: 3 };
    const args = { ...base, calibration: drift6, activityDays: everyDay(21) };
    const jamaisVerifie = computeConfidence({ ...args, lastVerifiedAt: null });
    const verifieUnJour = computeConfidence({ ...args, lastVerifiedAt: iso('2026-06-24') }); // 21 j

    expect(jamaisVerifie.neverVerified).toBe(true);
    expect(jamaisVerifie.doubtRatio).toBeLessThan(cfg.highMax);  // le doute amorti passe le seuil…
    expect(jamaisVerifie.level).toBe('medium');                  // …mais le verrou tient
    expect(verifieUnJour.level).toBe('high');                    // même doute, une vérif derrière
  });

  it('confiance haute LÉGITIME (doute brut déjà sous le seuil) : reste haute malgré l’activité', () => {
    const calmCalib: DriftCalibration = { medianAbsGap: 2, medianDaysBetween: 30, sampleCount: 6 };
    const r = computeConfidence({
      ...base, calibration: calmCalib, lastVerifiedAt: iso('2026-07-05'), activityDays: everyDay(7),
    });
    expect(r.level).toBe('high');
  });
});

/* ── A. L'ENVELOPPE HONORÉE EFFACE LE DOUTE ────────────────────────────────────────────────────
   Le doute ne dépendait que de l'horloge : le 28 du mois, quelqu'un ayant tout noté portait le même
   doute que le 8, pendant que l'écran lui promettait que saisir « actualiserait » ses montants.
   Ce qui tranche, c'est le RESTE d'enveloppe : il en reste → des dépenses attendues manquent
   peut-être à l'appel ; elle est consommée → tout ce qui était prévu est là. */
describe('computeConfidence — le doute suit le taux d’honoration de l’enveloppe', () => {
  const calib: DriftCalibration = { medianAbsGap: 400, medianDaysBetween: 20, sampleCount: 4 }; // 20 €/j
  const base = {
    today: TODAY, lastVerifiedAt: iso('2026-06-25'), calibration: calib, // 20 jours → doute brut 400
    relyka: 2000, floorBase: 2000, variableBase: 600, config: cfg,
  };
  const attendu20j = (600 / 30.44) * 20; // ~394 € attendus sur la période douteuse

  it('rien de saisi → strictement le calcul d’avant', () => {
    const r = computeConfidence({ ...base, variableSpentByDay: {} });
    expect(r.observedRelief).toBe(0);
    expect(r.uncertaintyEur).toBeCloseTo(400, 0);
    expect(r.level).toBe('low');
  });

  it('enveloppe honorée → le doute tombe, SANS vérifier son solde', () => {
    const r = computeConfidence({ ...base, variableSpentByDay: spentEveryDay(20, attendu20j / 20) });
    expect(r.observedRelief).toBeCloseTo(400, 0);
    expect(r.uncertaintyEur).toBeCloseTo(0, 0);
    expect(r.level).toBe('high');
  });

  it('la moitié de l’enveloppe honorée → la moitié du doute', () => {
    const r = computeConfidence({ ...base, variableSpentByDay: spentEveryDay(20, attendu20j / 40) });
    expect(r.observedRelief).toBeCloseTo(200, 0);
    expect(r.uncertaintyEur).toBeCloseTo(200, 0);
  });

  /* ⚠️ CE N'EST PAS UN PLAFOND EN EUROS — c'est ce qui bloquait le cas réel. Avec un budget déclaré
     à 600 € alors que le réel tourne à 2 400 €, un plafond proratisé ne pouvait jamais effacer plus
     de ~414 € : quelqu'un ayant saisi 2 048 € de dépenses restait en « estimation ». L'enveloppe est
     la RÉFÉRENCE du taux, jamais la limite de l'effacement. */
  it('un budget sous-déclaré ne bride PLUS l’effacement', () => {
    const gros: DriftCalibration = { medianAbsGap: 1000, medianDaysBetween: 20, sampleCount: 4 }; // 50 €/j
    const r = computeConfidence({
      ...base, calibration: gros, variableBase: 600,      // doute brut 1 000 €, enveloppe 600 €/mois
      variableSpentByDay: spentEveryDay(20, 100),          // 2 000 € saisis : enveloppe largement honorée
    });
    expect(r.observedRelief).toBeCloseTo(1000, 0); // et non ~394 € (l'ancien plafond)
    expect(r.uncertaintyEur).toBeCloseTo(0, 0);
    expect(r.level).toBe('high');
  });

  it('dépasser l’enveloppe ne fait pas plus que l’honorer (taux plafonné à 1)', () => {
    const juste = computeConfidence({ ...base, variableSpentByDay: spentEveryDay(20, attendu20j / 20) });
    const large = computeConfidence({ ...base, variableSpentByDay: spentEveryDay(20, 500) });
    expect(large.uncertaintyEur).toBeCloseTo(juste.uncertaintyEur, 5);
  });

  it('jamais vérifié → aucune remise (le point de départ reste inconnu)', () => {
    const r = computeConfidence({
      ...base, lastVerifiedAt: null, variableSpentByDay: spentEveryDay(20, 60),
    });
    expect(r.observedRelief).toBeNull();
    expect(r.level).not.toBe('high');
  });

  /* ── LE TAUX DOIT ÊTRE RÉPARTI, PAS CONCENTRÉ ────────────────────────────────────────────────
     Mesuré d'un bloc sur toute la période, il se laissait saturer par un seul jour : deux profils
     très différents ressortaient « à jour » à tort. C'est le découpage en tranches (on retient la
     plus faible) qui les sépare. */
  it('assidu puis SILENCE : le doute revient, même si le cumul honore l’enveloppe', () => {
    // Tout saisi il y a 15 à 20 jours (largement de quoi honorer l'enveloppe), plus rien depuis.
    const early = Object.fromEntries(
      everyDay(20).map((k, i) => [k, i >= 15 ? (600 / 30.44) * 4 : 0]),
    );
    const r = computeConfidence({
      ...base, variableSpentByDay: early, activityDays: everyDay(20).slice(15),
    });
    expect(r.observedRelief).toBe(0);        // la tranche récente est muette → taux 0
    expect(r.uncertaintyEur).toBeCloseTo(400, 0);
    expect(r.level).toBe('low');
  });

  it('UN achat exceptionnel saisi ne vaut pas trois semaines de suivi', () => {
    const r = computeConfidence({
      ...base, variableSpentByDay: { [daysAgo(0)]: 2000 }, activityDays: [daysAgo(0)],
    });
    // Les tranches plus anciennes n'ont ni montant ni activité → elles plafonnent le taux à 0.
    expect(r.observedRelief).toBe(0);
    // Le doute reste quasi entier : seul l'amortisseur d'assiduité joue, et pour un jour sur sept.
    expect(r.uncertaintyEur).toBeGreaterThan(350);
    expect(r.level).not.toBe('high');
  });

  /* L'assiduité COMPLÈTE les montants, elle ne les remplace pas : sans plafond, quelqu'un ayant
     honoré 60 % de son enveloppe voyait 100 % de son doute disparaître — la règle « il reste de
     l'enveloppe ≠ elle est consommée » n'aurait plus rien voulu dire. */
  it('saisir tous les jours ne suffit pas à effacer une enveloppe à moitié honorée', () => {
    const attendu = (600 / 30.44) * 20;
    const r = computeConfidence({
      ...base, variableSpentByDay: spentEveryDay(20, attendu / 40), activityDays: everyDay(20),
    });
    expect(r.observedRelief).toBeCloseTo(200, 0);   // 50 % du doute, pas 100 %
  });

  it('… mais une tranche sans AUCUNE dépense n’annule pas tout si le suivi est là', () => {
    // Semaine calme (rien dépensé) mais saisies quotidiennes : l'assiduité sauve la moitié.
    const calme = Object.fromEntries(everyDay(20).map((k, i) => [k, i < 7 ? 0 : (600 / 30.44) * 2]));
    const r = computeConfidence({ ...base, variableSpentByDay: calme, activityDays: everyDay(20) });
    expect(r.observedRelief).toBeCloseTo(200, 0);   // plafond d'assiduité : 50 %
  });

  it('sans enveloppe établie, rien à opposer au doute', () => {
    const r = computeConfidence({
      ...base, variableBase: 0, variableSpentByDay: spentEveryDay(20, 30),
    });
    expect(r.observedRelief).toBeNull();
    expect(r.uncertaintyEur).toBeCloseTo(400, 0);
  });

  /* LE CAS QUI A DÉCLENCHÉ TOUT ÇA : fin de mois, dépenses saisies au fil de l'eau, aucune envie
     d'ouvrir son appli bancaire avant la clôture. L'app cesse de réclamer une vérification. */
  it('fin de mois suivie au jour le jour : plus d’« estimation », plus de relance', () => {
    const r = computeConfidence({
      ...base, variableSpentByDay: spentEveryDay(20, 80), activityDays: everyDay(20),
    });
    expect(r.level).toBe('high');       // le message « solde non vérifié » ne s'affiche qu'en 'low'
    expect(toRange(1200, r, cfg).isRange).toBe(false); // un seul chiffre, pas de fourchette
  });
});

/* ── LE DOUTE A DEUX CAUSES, ET L'APP N'EN CONNAISSAIT QU'UNE ───────────────────────────────────
   « Mets ton solde à jour ou saisis tes dépenses » était servi à toute confiance basse — y compris à
   quelqu'un qui saisit chaque jour depuis trois semaines. On lui réclamait, en orange, le geste
   qu'il était en train de faire. `entriesKeptUp` sépare les deux causes : des saisies qui manquent,
   ou un point de départ jamais reconfirmé. Il ne change AUCUN montant — seulement ce qu'on dit. */
describe('entriesKeptUp — suit-il ses dépenses, ou pas ?', () => {
  const calib: DriftCalibration = { medianAbsGap: 900, medianDaysBetween: 20, sampleCount: 4 }; // 45 €/j
  const ctx = {
    today: TODAY, lastVerifiedAt: iso('2026-06-25'), calibration: calib, // 20 jours
    relyka: 1200, floorBase: 3000, variableBase: 600, config: cfg,
  };

  it('rien de saisi → l’app a raison de réclamer', () => {
    const r = computeConfidence({ ...ctx, variableSpentByDay: {}, activityDays: [] });
    expect(r.level).toBe('low');
    expect(r.entriesKeptUp).toBe(false);
  });

  it('saisies quotidiennes → le doute reste, la réclamation n’a plus lieu d’être', () => {
    const r = computeConfidence({ ...ctx, variableSpentByDay: {}, activityDays: everyDay(20) });
    expect(r.entriesKeptUp).toBe(true);
  });

  it('enveloppe honorée sans assiduité parfaite → suivi reconnu quand même', () => {
    const attendu = (600 / 30.44) * 20;
    const r = computeConfidence({
      ...ctx, variableSpentByDay: spentEveryDay(20, attendu / 20), activityDays: [],
    });
    expect(r.observedRate).toBeCloseTo(1, 2);
    expect(r.entriesKeptUp).toBe(true);
  });

  /* Sans point de départ constaté, aucune somme de saisies ne dit où l'on en est : la consigne
     reste la bonne, et c'est la même règle que le plafond d'observation. */
  it('jamais vérifié → jamais « à jour de ses saisies », quelle que soit l’assiduité', () => {
    const r = computeConfidence({
      ...ctx, lastVerifiedAt: null, variableSpentByDay: {}, activityDays: everyDay(30),
    });
    expect(r.neverVerified).toBe(true);
    expect(r.entriesKeptUp).toBe(false);
  });

  /* LE POINT ESSENTIEL : reconnaître le suivi ne revient pas à déclarer les chiffres exacts.
     Le doute demeure, la fourchette reste ouverte — c'est le TON qui change, pas le calcul. Si ce
     cas venait à tomber, ce serait le signe que le drapeau s'est mis à décider quelque chose. */
  it('le doute demeure : la fourchette reste ouverte malgré le suivi reconnu', () => {
    const r = computeConfidence({ ...ctx, variableSpentByDay: {}, activityDays: everyDay(20) });
    expect(r.entriesKeptUp).toBe(true);
    expect(r.uncertaintyEur).toBeGreaterThan(0);
    expect(r.doubtRatio).toBeGreaterThanOrEqual(cfg.highMax);
    expect(toRange(ctx.relyka, r, cfg).isRange).toBe(true);
  });
});

describe('toRange', () => {
  const highConf = { level: 'high' as const, doubtRatio: 0, uncertaintyEur: 0, daysSinceVerification: 1, rawDaysSinceVerification: 1, neverVerified: false, dailyDrift: 0, coldStart: false, activityDamped: false, activityCoverage: 0, daysSinceLastEntry: null, observedRelief: null, observedRate: null, entriesKeptUp: false };
  const medConf = { level: 'medium' as const, doubtRatio: 0.1, uncertaintyEur: 220, daysSinceVerification: 10, rawDaysSinceVerification: 10, neverVerified: false, dailyDrift: 22, coldStart: false, activityDamped: false, activityCoverage: 0, daysSinceLastEntry: null, observedRelief: null, observedRate: null, entriesKeptUp: false };

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
    const damped = { level: 'medium' as const, doubtRatio: 0.03, uncertaintyEur: 20, daysSinceVerification: 8, rawDaysSinceVerification: 8, neverVerified: false, dailyDrift: 2.5, coldStart: false, activityDamped: true, activityCoverage: 1, daysSinceLastEntry: null, observedRelief: null, observedRate: null, entriesKeptUp: false };
    expect(toRange(750, damped, cfg)).toEqual({ low: 750, high: 750, isRange: false });
  });

  it('borne basse jamais négative (doute plus large que le montant)', () => {
    const huge = { level: 'low' as const, doubtRatio: 0.9, uncertaintyEur: 1200, daysSinceVerification: 21, rawDaysSinceVerification: null, neverVerified: true, dailyDrift: 57, coldStart: true, activityDamped: false, activityCoverage: 0, daysSinceLastEntry: null, observedRelief: null, observedRate: null, entriesKeptUp: false };
    const r = toRange(154, huge, cfg);
    expect(r.isRange).toBe(true);
    expect(r.low).toBe(0);
    expect(r.high).toBe(154); // le plafond reste le Relyka
  });

  /* Le Relyka est planché à 0 : en dessous, sa vraie valeur est NÉGATIVE. Fourcher autour de ce 0
     fabriquait une borne haute à partir de rien — « minimum sûr 0 € · jusqu'à 100 € si tout est à
     jour » s'affichait sous un « 0 € » rouge accompagné d'un message de budget dépassé. */
  it('aucune fourchette à zéro : l’incertitude ne rend pas de l’argent qui n’existe pas', () => {
    const huge = { level: 'low' as const, doubtRatio: 0.9, uncertaintyEur: 1200, daysSinceVerification: 21, rawDaysSinceVerification: null, neverVerified: true, dailyDrift: 57, coldStart: true, activityDamped: false, activityCoverage: 0, daysSinceLastEntry: null, observedRelief: null, observedRate: null, entriesKeptUp: false };
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
    const smallEur = { level: 'medium' as const, doubtRatio: 0.06, uncertaintyEur: 10, daysSinceVerification: 6, rawDaysSinceVerification: 6, neverVerified: false, dailyDrift: 1.7, coldStart: false, activityDamped: false, activityCoverage: 0, daysSinceLastEntry: null, observedRelief: null, observedRate: null, entriesKeptUp: false };
    const r = toRange(720, smallEur, cfg); // roundStep 100 : 710→700 et 723→700
    expect(r.isRange).toBe(false);
    expect(r.low).toBe(720);
  });
});

describe('makeSubRanges — fourchettes des recos & montants proposés', () => {
  const conf = (uncertaintyEur: number) => ({
    level: 'medium' as const, doubtRatio: 0.2, uncertaintyEur,
    daysSinceVerification: 10, rawDaysSinceVerification: 10, neverVerified: false,
    dailyDrift: 1, coldStart: false, activityDamped: false, activityCoverage: 0, daysSinceLastEntry: null,
    observedRelief: null, observedRate: null, entriesKeptUp: false,
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
