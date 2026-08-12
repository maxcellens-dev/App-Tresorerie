import { computeDueCreditOccurrences, computeCreditSchedule, creditScheduleHash } from '../lib/finance/creditMaterialization';
import type { Credit } from '../types/database';

/** Crédit simple et prévisible : 1200 € sur 12 mois à 0 % → 100 €/mois, assurance 10 €/mois. */
function credit(over: Partial<Credit> = {}): Credit {
  return {
    id: 'c1',
    profile_id: 'u1',
    type: 'consommation',
    label: 'Prêt test',
    account_id: 'a1',
    category_id: 'cat-credit',
    category: { id: 'cat-credit', name: 'Crédits' },
    insurance_category_id: 'cat-assu',
    insurance_category: { id: 'cat-assu', name: 'Assurance Crédit' },
    principal: 1200,
    start_date: '2026-01-01',
    first_payment_date: '2026-01-11',
    duration_months: 12,
    rate_annual: 0,
    rate_type: 'fixe',
    insurance_monthly: 10,
    is_simulation: false,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as Credit;
}

describe('computeDueCreditOccurrences', () => {
  it('matérialise remboursement + assurance de la fenêtre (bornes from exclusive / to inclusive)', () => {
    // Fenêtre = mois de juillet jusqu'au 16 → seule l'échéance n° 7 (11 juillet) est échue.
    const occ = computeDueCreditOccurrences(credit(), null, '2026-06-30', '2026-07-16');
    expect(occ).toHaveLength(2);
    const pay = occ.find((o) => o.credit_kind === 'pay')!;
    const ins = occ.find((o) => o.credit_kind === 'ins')!;
    expect(pay).toMatchObject({
      credit_id: 'c1', credit_period: 7, account_id: 'a1', category_id: 'cat-credit',
      date: '2026-07-11', note: 'Crédits — Prêt test',
    });
    expect(pay.amount).toBeCloseTo(-100, 2);
    expect(ins).toMatchObject({ credit_period: 7, category_id: 'cat-assu', date: '2026-07-11' });
    expect(ins.amount).toBeCloseTo(-10, 2);
  });

  it('inclut la borne « to » (échéance du jour même) et exclut la borne « from »', () => {
    const atFrom = computeDueCreditOccurrences(credit(), null, '2026-07-11', '2026-07-16');
    expect(atFrom).toHaveLength(0); // le 11 = borne from (déjà traité) → exclu
    const atTo = computeDueCreditOccurrences(credit(), null, '2026-06-30', '2026-07-11');
    expect(atTo.map((o) => o.date)).toEqual(['2026-07-11', '2026-07-11']); // le jour même compte
  });

  it('couvre plusieurs échéances si la fenêtre est plus large', () => {
    const occ = computeDueCreditOccurrences(credit(), null, '2026-04-30', '2026-07-16');
    // Échéances 5, 6, 7 (11 mai, 11 juin, 11 juillet) × (pay + ins).
    expect(occ.filter((o) => o.credit_kind === 'pay').map((o) => o.credit_period)).toEqual([5, 6, 7]);
    expect(occ).toHaveLength(6);
  });

  it('assurance à une date propre (first_insurance_date) : chaque jambe suit sa date', () => {
    const occ = computeDueCreditOccurrences(
      credit({ first_insurance_date: '2026-01-20' }), null, '2026-06-30', '2026-07-15',
    );
    // Au 15 juillet : remboursement du 11 échu, assurance du 20 pas encore.
    expect(occ.map((o) => o.credit_kind)).toEqual(['pay']);
  });

  it('ne matérialise rien pour une simulation, un crédit inactif ou sans compte', () => {
    expect(computeDueCreditOccurrences(credit({ is_simulation: true }), null, '2026-06-30', '2026-07-16')).toHaveLength(0);
    expect(computeDueCreditOccurrences(credit({ is_active: false }), null, '2026-06-30', '2026-07-16')).toHaveLength(0);
    expect(computeDueCreditOccurrences(credit({ account_id: null }), null, '2026-06-30', '2026-07-16')).toHaveLength(0);
  });

  it('fenêtre vide ou inversée → rien', () => {
    expect(computeDueCreditOccurrences(credit(), null, '2026-07-16', '2026-07-16')).toHaveLength(0);
    expect(computeDueCreditOccurrences(credit(), null, '2026-08-01', '2026-07-16')).toHaveLength(0);
  });

  it('computeCreditSchedule publie le tableau COMPLET (12 remboursements + 12 assurances)', () => {
    const occ = computeCreditSchedule(credit(), null);
    expect(occ.filter((o) => o.credit_kind === 'pay')).toHaveLength(12);
    expect(occ.filter((o) => o.credit_kind === 'ins')).toHaveLength(12);
    expect(occ[0]).toMatchObject({ credit_period: 1, date: '2026-01-11' });
    expect(occ[occ.length - 1].date).toBe('2026-12-11');
  });

  it('creditScheduleHash : stable pour un même tableau, change si le tableau change', () => {
    const h1 = creditScheduleHash(computeCreditSchedule(credit(), null));
    const h2 = creditScheduleHash(computeCreditSchedule(credit(), null));
    const h3 = creditScheduleHash(computeCreditSchedule(credit({ insurance_monthly: 12 }), null));
    const h4 = creditScheduleHash(computeCreditSchedule(credit(), [
      { id: 'e1', credit_id: 'c1', date: '2026-05-01', kind: 'early_repayment', amount: 300 } as any,
    ]));
    expect(h1).toBe(h2);
    expect(h3).not.toBe(h1);
    expect(h4).not.toBe(h1);
  });

  it('catégories absentes → category_id null et libellés par défaut', () => {
    const occ = computeDueCreditOccurrences(
      credit({ category_id: null, category: null, insurance_category_id: null, insurance_category: null }),
      null, '2026-06-30', '2026-07-16',
    );
    const pay = occ.find((o) => o.credit_kind === 'pay')!;
    expect(pay.category_id).toBeNull();
    expect(pay.note).toBe('Crédits — Prêt test');
  });
});
