import { buildMaterializedIndex, recurrenceForMonth, recurrenceOccurrencesInMonth, type RecurrenceTemplate } from '../lib/finance/recurrenceMonth';

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
});
