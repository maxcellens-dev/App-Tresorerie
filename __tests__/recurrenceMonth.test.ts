import { buildMaterializedIndex, recurrenceForMonth, recurrenceOccurrencesInMonth, recurringAmountForMonth, type RecurrenceTemplate } from '../lib/finance/recurrenceMonth';

// On se place le 15 juillet 2026 : une échéance au 5 est passée, une au 28 est à venir.
const NOW = new Date(2026, 6, 15);
const MONTH = '2026-07';

const tpl = (o: Partial<RecurrenceTemplate> = {}): RecurrenceTemplate => ({
  id: 'loyer', date: '2026-07-05', amount: -800, recurrence_rule: 'monthly', ...o,
});
const mat = (o: any = {}) => ({ materialized_from: 'loyer', date: '2026-07-05', amount: -800, ...o });
const idx = (txs: any[]) => buildMaterializedIndex(txs, MONTH);

describe('recurrenceForMonth — le Suivi du mois doit montrer le RÉEL', () => {
  it('modèle encore ancré sur le mois, jour échu → projeté et compté comme passé', () => {
    expect(recurrenceForMonth(tpl(), idx([]), NOW)).toEqual({ total: 800, passed: 800 });
  });

  it('modèle ancré sur le mois, jour PAS encore échu → attendu mais pas passé', () => {
    expect(recurrenceForMonth(tpl({ date: '2026-07-28' }), idx([]), NOW)).toEqual({ total: 800, passed: 0 });
  });

  it('occurrence matérialisée (modèle avancé au mois suivant) → comptée une seule fois', () => {
    const r = recurrenceForMonth(tpl({ date: '2026-08-05' }), idx([mat()]), NOW);
    expect(r).toEqual({ total: 800, passed: 800 });
  });

  // RÉGRESSION — le bug signalé : l'occurrence du 5 juillet est supprimée, le modèle reste ancré
  // en août. L'ancienne règle « modèle avancé ⇒ échéance passée » la comptait encore.
  it('occurrence matérialisée puis SUPPRIMÉE → ne compte plus du tout ce mois', () => {
    const r = recurrenceForMonth(tpl({ date: '2026-08-05' }), idx([]), NOW);
    expect(r).toEqual({ total: 0, passed: 0 });
  });

  it('échéance modifiée : c’est le montant RÉEL de la ligne qui compte, pas celui du modèle', () => {
    const r = recurrenceForMonth(tpl({ date: '2026-08-05' }), idx([mat({ amount: -950 })]), NOW);
    expect(r).toEqual({ total: 950, passed: 950 });
  });

  it('récurrente qui DÉMARRE le mois prochain → rien ce mois (aucune ligne réelle)', () => {
    expect(recurrenceForMonth(tpl({ date: '2026-08-20' }), idx([]), NOW)).toEqual({ total: 0, passed: 0 });
  });

  it('récurrence terminée avant le mois → rien', () => {
    const r = recurrenceForMonth(tpl({ date: '2026-07-05', recurrence_end_date: '2026-05-05' }), idx([]), NOW);
    expect(r).toEqual({ total: 0, passed: 0 });
  });

  describe('annuelle', () => {
    it('ancrée sur un autre mois → rien', () => {
      const t = tpl({ date: '2026-03-10', recurrence_rule: 'yearly' });
      expect(recurrenceForMonth(t, idx([]), NOW)).toEqual({ total: 0, passed: 0 });
    });
    it('ancrée ce mois-ci → projetée', () => {
      const t = tpl({ date: '2026-07-10', recurrence_rule: 'yearly' });
      expect(recurrenceForMonth(t, idx([]), NOW)).toEqual({ total: 800, passed: 800 });
    });
    it('matérialisée puis supprimée (modèle avancé d’un an) → rien', () => {
      const t = tpl({ date: '2027-07-10', recurrence_rule: 'yearly' });
      expect(recurrenceForMonth(t, idx([]), NOW)).toEqual({ total: 0, passed: 0 });
    });
  });

  describe('trimestrielle', () => {
    it('mois hors cycle → rien', () => {
      const t = tpl({ date: '2026-06-05', recurrence_rule: 'quarterly' });
      expect(recurrenceForMonth(t, idx([]), NOW)).toEqual({ total: 0, passed: 0 });
    });
    it('mois du cycle → projetée', () => {
      const t = tpl({ date: '2026-04-05', recurrence_rule: 'quarterly' });
      expect(recurrenceForMonth(t, idx([]), NOW)).toEqual({ total: 800, passed: 800 });
    });
    it('matérialisée puis supprimée (modèle avancé de 3 mois) → rien', () => {
      const t = tpl({ date: '2026-10-05', recurrence_rule: 'quarterly' });
      expect(recurrenceForMonth(t, idx([]), NOW)).toEqual({ total: 0, passed: 0 });
    });
  });

  describe('hebdomadaire', () => {
    const w = (date: string) => tpl({ id: 'courses', date, amount: -50, recurrence_rule: 'weekly' });
    const matW = (date: string) => ({ materialized_from: 'courses', date, amount: -50 });

    it('passé matérialisé + futur projeté, sans double comptage', () => {
      // Les 3, 10 juillet matérialisés ; l’ancre est au 17 → 17, 24, 31 à venir.
      const r = recurrenceForMonth(w('2026-07-17'), idx([matW('2026-07-03'), matW('2026-07-10')]), NOW);
      expect(r.total).toBe(250);  // 2 passées + 3 à venir
      expect(r.passed).toBe(100); // seulement les 2 réellement matérialisées
    });

    it('une occurrence supprimée disparaît du passé', () => {
      const r = recurrenceForMonth(w('2026-07-17'), idx([matW('2026-07-03')]), NOW);
      expect(r.passed).toBe(50);
      expect(r.total).toBe(200);
    });

    it('matérialisation pas encore passée (hors ligne) : la projection prend le relais', () => {
      const r = recurrenceForMonth(w('2026-07-03'), idx([]), NOW);
      expect(r.total).toBe(250);  // 3, 10, 17, 24, 31
      expect(r.passed).toBe(100); // 3 et 10 sont échues au 15
    });
  });
});

describe('buildMaterializedIndex', () => {
  it('ignore les brouillons et les autres mois, cumule le reste', () => {
    const i = idx([
      mat({ date: '2026-07-05', amount: -800 }),
      mat({ date: '2026-07-20', amount: -100 }),
      mat({ date: '2026-06-05', amount: -800 }),   // autre mois
      mat({ date: '2026-07-25', amount: -50, is_draft: true }), // brouillon
      { date: '2026-07-08', amount: -30 },          // pas une occurrence matérialisée
    ]);
    expect(i.get('loyer')).toEqual({ total: 900, count: 2, lastDate: '2026-07-20' });
    expect(i.size).toBe(1);
  });
});

describe('recurrenceOccurrencesInMonth — projection pure (fiche de compte, « à venir »)', () => {
  it('mensuelle en retard de matérialisation → occurrence du mois projetée', () => {
    // Cas du COMPTE JOINT : le modèle d'un co-titulaire n'est avancé que quand LUI ouvre l'app.
    expect(recurrenceOccurrencesInMonth(tpl({ date: '2026-04-28' }), 2026, 7)).toEqual(['2026-07-28']);
  });

  it('jour borné à la longueur du mois (le 31 → 28 en février)', () => {
    expect(recurrenceOccurrencesInMonth(tpl({ date: '2026-01-31' }), 2026, 2)).toEqual(['2026-02-28']);
  });

  it('modèle qui démarre plus tard → rien ce mois', () => {
    expect(recurrenceOccurrencesInMonth(tpl({ date: '2026-08-05' }), 2026, 7)).toEqual([]);
  });

  it('série terminée avant le mois (ou en cours de mois) → rien après la fin', () => {
    expect(recurrenceOccurrencesInMonth(tpl({ date: '2026-01-05', recurrence_end_date: '2026-06-30' }), 2026, 7)).toEqual([]);
    expect(recurrenceOccurrencesInMonth(tpl({ date: '2026-01-28', recurrence_end_date: '2026-07-10' }), 2026, 7)).toEqual([]);
  });

  it('trimestrielle : seulement les mois du cycle', () => {
    const q = tpl({ date: '2026-01-15', recurrence_rule: 'quarterly' });
    expect(recurrenceOccurrencesInMonth(q, 2026, 7)).toEqual(['2026-07-15']);
    expect(recurrenceOccurrencesInMonth(q, 2026, 8)).toEqual([]);
  });

  it('annuelle : seulement le mois d’anniversaire', () => {
    const y = tpl({ date: '2024-07-09', recurrence_rule: 'yearly' });
    expect(recurrenceOccurrencesInMonth(y, 2026, 7)).toEqual(['2026-07-09']);
    expect(recurrenceOccurrencesInMonth(y, 2026, 8)).toEqual([]);
  });

  it('hebdomadaire : toutes les occurrences du mois', () => {
    const w = tpl({ date: '2026-07-03', recurrence_rule: 'weekly' });
    expect(recurrenceOccurrencesInMonth(w, 2026, 7)).toEqual(['2026-07-03', '2026-07-10', '2026-07-17', '2026-07-24', '2026-07-31']);
  });

  // RÉGRESSION — la boucle s'arrêtait au bout de 400 semaines (~7,6 ans) : une hebdomadaire ancrée
  // avant ça ne produisait plus AUCUNE occurrence et disparaissait du mois projeté.
  it('hebdomadaire ancrée il y a plus de 8 ans → toujours projetée', () => {
    const w = tpl({ date: '2015-01-02', recurrence_rule: 'weekly' }); // un vendredi
    const out = recurrenceOccurrencesInMonth(w, 2026, 7);
    expect(out).toEqual(['2026-07-03', '2026-07-10', '2026-07-17', '2026-07-24', '2026-07-31']);
  });

  it('hebdomadaire : rien avant son ancre', () => {
    const w = tpl({ date: '2026-07-17', recurrence_rule: 'weekly' });
    expect(recurrenceOccurrencesInMonth(w, 2026, 7)).toEqual(['2026-07-17', '2026-07-24', '2026-07-31']);
  });
});

describe('recurringAmountForMonth — montant signé projeté sur un mois', () => {
  /* RÉGRESSION CENTRALE : la fonction comparait `new Date('2026-08-31')` (minuit UTC) à
     `new Date(2026, 8, 0)` (minuit LOCAL). En France, le premier tombe APRÈS le second → toute
     récurrente ancrée le DERNIER jour de son mois rendait 0 pour ce mois-là. Un salaire du 31
     manquait donc à la courbe de la Projection, aux soldes 12 mois du Pilotage et au Reporting. */
  it('ancrée le DERNIER jour du mois → comptée sur ce mois (pas 0)', () => {
    const salaire = tpl({ id: 'sal', date: '2026-08-31', amount: 2500, recurrence_rule: 'monthly' });
    expect(recurringAmountForMonth(salaire, 2026, 8)).toBe(2500);
    expect(recurringAmountForMonth(salaire, 2026, 9)).toBe(2500);
  });

  it('le 30 d’un mois de 30 jours, le 28 de février : même règle', () => {
    expect(recurringAmountForMonth(tpl({ date: '2026-09-30', amount: -800 }), 2026, 9)).toBe(-800);
    expect(recurringAmountForMonth(tpl({ date: '2026-02-28', amount: -800 }), 2026, 2)).toBe(-800);
  });

  it('mensuelle ordinaire : comptée tous les mois à partir de son ancre', () => {
    const loyer = tpl({ date: '2026-07-05', amount: -800 });
    expect(recurringAmountForMonth(loyer, 2026, 6)).toBe(0);   // avant l'ancre
    expect(recurringAmountForMonth(loyer, 2026, 7)).toBe(-800);
    expect(recurringAmountForMonth(loyer, 2026, 12)).toBe(-800);
  });

  it('série terminée EN COURS de mois : l’occurrence postérieure à la fin ne compte plus', () => {
    // Loyer du 28, série arrêtée le 10 juillet → l'échéance du 28 juillet n'existe pas.
    const t = tpl({ date: '2026-01-28', amount: -800, recurrence_end_date: '2026-07-10' });
    expect(recurringAmountForMonth(t, 2026, 7)).toBe(0);
    expect(recurringAmountForMonth(t, 2026, 6)).toBe(-800);
  });

  it('trimestrielle et annuelle : ancre du 1er du mois (repère UTC/local)', () => {
    const q = tpl({ date: '2026-01-01', amount: -300, recurrence_rule: 'quarterly' });
    expect(recurringAmountForMonth(q, 2026, 1)).toBe(-300);
    expect(recurringAmountForMonth(q, 2026, 4)).toBe(-300);
    expect(recurringAmountForMonth(q, 2026, 5)).toBe(0);
    const y = tpl({ date: '2025-03-01', amount: -120, recurrence_rule: 'yearly' });
    expect(recurringAmountForMonth(y, 2026, 3)).toBe(-120);
    expect(recurringAmountForMonth(y, 2026, 4)).toBe(0);
  });

  it('hebdomadaire : autant de fois que d’occurrences dans le mois', () => {
    const w = tpl({ date: '2026-07-03', amount: -50, recurrence_rule: 'weekly' });
    expect(recurringAmountForMonth(w, 2026, 7)).toBe(-250); // 5 vendredis
    expect(recurringAmountForMonth(w, 2026, 8)).toBe(-200); // 4 vendredis
  });

  it('échéance modifiée : l’override remplace tout le calcul', () => {
    const loyer = tpl({ date: '2026-07-05', amount: -800 });
    expect(recurringAmountForMonth(loyer, 2026, 9, { 'loyer:2026:9': -950 })).toBe(-950);
    // Un override à 0 (échéance annulée pour ce mois) doit être respecté, pas ignoré.
    expect(recurringAmountForMonth(loyer, 2026, 9, { 'loyer:2026:9': 0 })).toBe(0);
  });

  it('modèle sans règle ou à date illisible → 0, jamais NaN', () => {
    expect(recurringAmountForMonth(tpl({ recurrence_rule: null }), 2026, 7)).toBe(0);
    expect(recurringAmountForMonth(tpl({ date: '' }), 2026, 7)).toBe(0);
  });
});
