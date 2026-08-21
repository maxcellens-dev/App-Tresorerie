/**
 * Les deux chiffres que la fiche d'un crédit met en avant : sa MENSUALITÉ et son TAUX.
 *
 * Tous deux divergeaient de ce que l'app raconte par ailleurs :
 *   • la liste des crédits affiche la prochaine échéance RÉELLE, la fiche affichait la mensualité
 *     NOMINALE — deux montants différents pour la même ligne dès qu'il y a un différé ou des
 *     paliers, et c'est justement l'écart entre les deux qui fait douter des totaux ;
 *   • la fiche affichait le taux d'ORIGINE, en contradiction avec son propre échéancier juste en
 *     dessous dès qu'une renégociation (`rate_change`) avait été enregistrée.
 */
import { computeAmortization, nextPaymentAtDate, rateAtDate } from '../lib/finance/amortization';

const base = {
  principal: 120000,
  duration_months: 120,
  rate_annual: 3,
  insurance_monthly: 20,
  start_date: '2026-01-01',
  first_payment_date: '2026-01-01',
};

describe('nextPaymentAtDate — la mensualité annoncée', () => {
  it('sans différé, colle à la mensualité nominale', () => {
    const a = computeAmortization(base as any);
    expect(nextPaymentAtDate(a, '2026-03-15')).toBeCloseTo(a.monthlyWithInsurance, 2);
  });

  /* Avec un différé, les premières échéances ne remboursent pas de capital : leur montant n'a rien
     à voir avec la mensualité nominale. C'est le cœur de la divergence corrigée. */
  it('pendant un différé, rend l\'échéance RÉELLE — pas la nominale', () => {
    const a = computeAmortization({ ...base, deferral_months: 12, deferral_type: 'partial' } as any);
    const during = nextPaymentAtDate(a, '2026-03-15');
    expect(during).toBeGreaterThan(0);
    expect(during).not.toBeCloseTo(a.monthlyWithInsurance, 2);
    // Et c'est bien le montant de la prochaine ligne de l'échéancier.
    const next = a.schedule.find((r) => r.date > '2026-03-15')!;
    expect(during).toBeCloseTo(next.payment + next.insurance, 2);
  });

  it('après la dernière échéance, retombe sur la nominale plutôt que sur zéro', () => {
    const a = computeAmortization(base as any);
    expect(nextPaymentAtDate(a, '2099-01-01')).toBeCloseTo(a.monthlyWithInsurance, 2);
  });
});

describe('rateAtDate — le taux en vigueur', () => {
  const events = [
    { date: '2027-06-01', kind: 'rate_change' as const, new_rate: 2.1 },
    { date: '2029-01-01', kind: 'rate_change' as const, new_rate: 1.5 },
  ];

  it('sans événement, c\'est le taux d\'origine', () => {
    expect(rateAtDate({ rate_annual: 3 }, '2026-05-01')).toBe(3);
  });

  it('avant la renégociation, le taux d\'origine tient encore', () => {
    expect(rateAtDate({ rate_annual: 3, events }, '2027-05-31')).toBe(3);
  });

  it('le jour même de la renégociation, le nouveau taux s\'applique', () => {
    // Même règle de bord que le moteur : l'événement vaut dès que sa date est atteinte.
    expect(rateAtDate({ rate_annual: 3, events }, '2027-06-01')).toBe(2.1);
  });

  it('retient la DERNIÈRE renégociation échue, pas la première', () => {
    expect(rateAtDate({ rate_annual: 3, events }, '2030-01-01')).toBe(1.5);
  });

  it('ignore une renégociation encore à venir', () => {
    expect(rateAtDate({ rate_annual: 3, events }, '2028-01-01')).toBe(2.1);
  });

  it('ignore les événements d\'un autre genre', () => {
    const mixed = [{ date: '2026-02-01', kind: 'early_repayment' as const, amount: 5000 }];
    expect(rateAtDate({ rate_annual: 3, events: mixed }, '2027-01-01')).toBe(3);
  });
});
