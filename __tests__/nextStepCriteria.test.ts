import { nextStepCriteria } from '../lib/finance/nextStepCriteria';
import { DEFAULT_PROFILE_THRESHOLDS as T } from '../lib/finance/financialProfileEngine';

describe('prochain palier : les critères du classement, avec où tu en es', () => {
  it('P3 → P4 : seulement des mois d’épargne', () => {
    const n = nextStepCriteria('P3', T, { months: 2, savings: 4000, invested: 0 })!;
    expect(n.next).toBe('P4');
    expect(n.criteria).toHaveLength(1);
    expect(n.criteria[0]).toMatchObject({ key: 'months', current: 2, target: T.monthsUp.P4, met: false });
  });
  it('P5 → P6 : la réserve ET un montant placé qui compte', () => {
    const n = nextStepCriteria('P5', T, { months: T.monthsUp.P6 + 1, savings: 20000, invested: 100 })!;
    expect(n.criteria.map((c) => [c.key, c.met])).toEqual([['months', true], ['invested', false]]);
  });
  it('P6 → P7 : patrimoine, réserve, placement et part placée', () => {
    const n = nextStepCriteria('P6', T, { months: 20, savings: 20000, invested: 5000 })!;
    expect(n.next).toBe('P7');
    expect(n.criteria.map((c) => c.key)).toEqual(['wealth', 'months', 'invested', 'share']);
    expect(n.criteria.find((c) => c.key === 'wealth')).toMatchObject({ current: 25000, target: T.wealthUp.P7 });
    expect(n.criteria.find((c) => c.key === 'share')).toMatchObject({ current: 20, met: true });
  });
  it('P1 → P2 est qualitatif ; P9 et étape inconnue : pas de palier', () => {
    expect(nextStepCriteria('P1', T, { months: 0, savings: 0, invested: 0 })!.criteria[0].target).toBeNull();
    expect(nextStepCriteria('P9', T, { months: 30, savings: 1e6, invested: 1e6 })).toBeNull();
    expect(nextStepCriteria('P0', T, { months: null, savings: 0, invested: 0 })).toBeNull();
  });
});
