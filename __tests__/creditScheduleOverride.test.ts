import { computeCreditSchedule, creditScheduleHash } from '../lib/finance/creditMaterialization';

/**
 * Corriger UNE échéance dans le tableau d'amortissement doit se propager jusqu'aux transactions
 * déjà écrites. La chaîne est :
 *
 *   modal « éditer la ligne » → credits.schedule_overrides
 *     → computeCreditSchedule() (le tableau qui fait foi)
 *       → creditScheduleHash() différent
 *         → republication du cache `credit_schedule`
 *           → RPC resync_credit_materialized (migration 180) qui réaligne les vraies transactions
 *
 * Le maillon vérifié ici est le PIVOT : si l'override ne changeait pas le tableau publié, l'empreinte
 * resterait identique, le client sauterait la republication (`if (c.schedule_hash === hash) continue`)
 * et le réalignement ne serait JAMAIS déclenché — les échéances passées garderaient leur montant.
 */

const credit: any = {
  id: 'c1', label: 'Prêt auto', account_id: 'acc1', category_id: 'cat-credit',
  insurance_category_id: 'cat-assur', is_active: true, is_simulation: false,
  principal: 12000, duration_months: 12, rate_annual: 3, insurance_monthly: 0,
  start_date: '2026-01-05', first_payment_date: '2026-01-05',
  deferral_months: 0, deferral_type: 'none',
  schedule_overrides: null,
};

const payFor = (occ: any[], period: number) => occ.find((o) => o.credit_kind === 'pay' && o.credit_period === period);

describe('échéance corrigée à la main → tableau publié', () => {
  const base = computeCreditSchedule(credit, null);

  it('le tableau de référence contient une ligne par échéance', () => {
    expect(base.filter((o) => o.credit_kind === 'pay')).toHaveLength(12);
    expect(payFor(base, 3)!.amount).toBeLessThan(0); // sortie
  });

  it('corriger le MONTANT d’une échéance change le tableau publié', () => {
    const edited = computeCreditSchedule({ ...credit, schedule_overrides: { '3': { p: 950 } } }, null);
    expect(payFor(edited, 3)!.amount).toBe(-950);
    // Les autres échéances ne bougent pas.
    expect(payFor(edited, 4)!.amount).toBe(payFor(base, 4)!.amount);
  });

  it('corriger la DATE d’une échéance change le tableau publié', () => {
    const edited = computeCreditSchedule({ ...credit, schedule_overrides: { '3': { d: '2026-03-20' } } }, null);
    expect(payFor(edited, 3)!.date).toBe('2026-03-20');
  });

  it('l’empreinte CHANGE — sans quoi la republication et le réalignement seraient sautés', () => {
    const h0 = creditScheduleHash(base);
    const hMontant = creditScheduleHash(computeCreditSchedule({ ...credit, schedule_overrides: { '3': { p: 950 } } }, null));
    const hDate = creditScheduleHash(computeCreditSchedule({ ...credit, schedule_overrides: { '3': { d: '2026-03-20' } } }, null));
    expect(hMontant).not.toBe(h0);
    expect(hDate).not.toBe(h0);
  });

  it('retirer l’override rend EXACTEMENT le tableau d’origine (l’édition est réversible)', () => {
    const h0 = creditScheduleHash(base);
    const revenu = creditScheduleHash(computeCreditSchedule({ ...credit, schedule_overrides: null }, null));
    expect(revenu).toBe(h0);
  });

  it('un remboursement anticipé raccourcit le tableau (les échéances disparues seront supprimées)', () => {
    const events = [{ id: 'e1', credit_id: 'c1', date: '2026-04-10', kind: 'early_repayment', amount: 8000 } as any];
    const withEvent = computeCreditSchedule(credit, events);
    expect(withEvent.filter((o) => o.credit_kind === 'pay').length).toBeLessThan(12);
    expect(creditScheduleHash(withEvent)).not.toBe(creditScheduleHash(base));
  });
});
