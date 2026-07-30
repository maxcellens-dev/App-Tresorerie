import { buildOverrideMap, applyMonthOverride, applyMonthOverrides } from '../lib/txOverrides';
import type { TransactionMonthOverride } from '../types/database';

const ovr = (o: Partial<TransactionMonthOverride>): TransactionMonthOverride => ({
  id: 'o', profile_id: 'p', transaction_id: 't1', year: 2026, month: 7,
  override_amount: null, override_date: null, created_at: '', updated_at: '', ...o,
});

const tx = (over: Partial<any> = {}) => ({
  id: 't1', date: '2026-07-28', amount: -900, is_recurring: true, ...over,
});

describe('applyMonthOverride', () => {
  it('applique le montant de l’échéance du mois d’ancrage', () => {
    const map = buildOverrideMap([ovr({ override_amount: -950 })]);
    expect(applyMonthOverride(tx(), map).amount).toBe(-950);
  });

  it('applique la date déplacée de cette échéance', () => {
    const map = buildOverrideMap([ovr({ override_date: '2026-07-15' })]);
    expect(applyMonthOverride(tx(), map).date).toBe('2026-07-15');
  });

  it('ne touche pas une ligne ponctuelle (pas d’occurrence, donc pas d’override)', () => {
    const map = buildOverrideMap([ovr({ override_amount: -950 })]);
    const t = applyMonthOverride(tx({ is_recurring: false }), map);
    expect(t.amount).toBe(-900);
    expect((t as any).instance_month).toBeUndefined();
  });

  it('n’applique pas l’override d’un AUTRE mois', () => {
    const map = buildOverrideMap([ovr({ month: 8, override_amount: -950 })]);
    expect(applyMonthOverride(tx(), map).amount).toBe(-900);
  });

  it('expose le mois d’ancrage même sans override (paramètre instanceDate de l’éditeur)', () => {
    expect(applyMonthOverride(tx(), {}).instance_month).toBe('2026-07');
  });

  it('garde le mois d’ANCRAGE quand la date est déplacée dans un autre mois', () => {
    const map = buildOverrideMap([ovr({ override_date: '2026-08-02' })]);
    const t = applyMonthOverride(tx(), map);
    expect(t.date).toBe('2026-08-02');
    expect(t.instance_month).toBe('2026-07');
  });

  it('ne mute pas la liste d’origine', () => {
    const src = [tx()];
    applyMonthOverrides(src, buildOverrideMap([ovr({ override_amount: -950 })]));
    expect(src[0].amount).toBe(-900);
  });
});
