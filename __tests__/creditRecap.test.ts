/**
 * Le bandeau de totaux de l'onglet « Crédits » — quatre ou cinq chiffres qui doivent tomber juste
 * sous les yeux du lecteur, sinon c'est tout le module qui perd sa crédibilité.
 *
 * L'invariant tenu par `recapAtDate` :
 *
 *     reste à payer = capital restant + intérêts restants + assurance restante
 *
 * Il était faux à l'affichage (l'assurance n'apparaissait nulle part) et faux au calcul dans trois
 * cas : assurance à date décalée, remboursement anticipé planifié, remboursement anticipé passé.
 */
import { computeAmortization, recapAtDate, type CreditParams } from '../lib/finance/amortization';

const today = '2028-06-15';

const base = {
  principal: 200000, duration_months: 240, rate_annual: 3.2, insurance_monthly: 30,
  start_date: '2026-01-05', first_payment_date: '2026-01-05',
};

const recap = (p: any, isoDate = today) => recapAtDate(computeAmortization(p as CreditParams), isoDate, p);

describe('recapAtDate — l\'invariant du bandeau', () => {
  /* Le cœur du sujet : trois cellules affichées doivent s'additionner pour donner la quatrième.
     On le vérifie sur toute la variété de crédits que le moteur sait produire. */
  const cases: [string, any][] = [
    ['simple', base],
    ['sans assurance', { ...base, insurance_monthly: 0 }],
    ['assurance par année', { ...base, insurance_yearly: [30, 30, 25, 25, 20] }],
    ['différé partiel', { ...base, deferral_months: 12, deferral_type: 'partial' }],
    ['différé total capitalisé', { ...base, deferral_months: 12, deferral_type: 'total', deferral_interest_mode: 'capitalized' }],
    ['différé total, intérêts remboursés en premier', { ...base, deferral_months: 12, deferral_type: 'total', deferral_interest_mode: 'deferred' }],
    ['paliers', { ...base, payment_yearly: [900, 900, 900, 1400, 1400, null] }],
    ['assurance décalée', { ...base, first_insurance_date: '2026-07-05' }],
    ['remboursement anticipé passé', { ...base, events: [{ date: '2027-03-05', kind: 'early_repayment', amount: 30000 }] }],
    ['remboursement anticipé planifié', { ...base, events: [{ date: '2030-03-05', kind: 'early_repayment', amount: 30000 }] }],
    ['renégociation de taux', { ...base, events: [{ date: '2027-06-05', kind: 'rate_change', new_rate: 2.1 }] }],
    ['crédit pas encore démarré', { ...base, start_date: '2030-01-05', first_payment_date: '2030-01-05' }],
  ];

  it.each(cases)('%s : reste à payer = capital + intérêts + assurance', (_name, p) => {
    const r = recap(p);
    expect(r.leftToPay).toBeCloseTo(r.crd + r.interestLeft + r.insuranceLeft, 2);
    expect(r.leftToPay).toBeGreaterThan(0);
  });

  it('un crédit soldé ne laisse plus rien à payer', () => {
    const r = recap(base, '2099-01-01');
    expect(r.crd).toBeCloseTo(0, 2);
    expect(r.leftToPay).toBeCloseTo(0, 2);
  });
});

/* L'assurance peut partir à sa propre date. `schedule` la pose aux dates de REMBOURSEMENT : le
   partage passé/futur se trompait alors d'autant de mois d'assurance que le décalage — ici 12 mois
   à 30 €, soit 360 € manquants au « reste à payer » et 360 € de trop dans le « déjà payé ». */
describe('assurance à date décalée', () => {
  const shifted = { ...base, first_insurance_date: '2027-01-05' };

  it('compte l\'assurance à SA date, pas à celle du remboursement', () => {
    const aligned = recap(base);
    const r = recap(shifted);
    expect(r.insuranceLeft - aligned.insuranceLeft).toBeCloseTo(12 * 30, 2);
    expect(r.leftToPay - aligned.leftToPay).toBeCloseTo(12 * 30, 2);
    expect(r.paid - aligned.paid).toBeCloseTo(-12 * 30, 2);
  });

  it('sans décalage, rien ne bouge', () => {
    expect(recap({ ...base, first_insurance_date: base.first_payment_date }).leftToPay)
      .toBeCloseTo(recap(base).leftToPay, 2);
  });
});

describe('remboursements anticipés', () => {
  const amount = 30000;
  const planned = { ...base, events: [{ date: '2030-03-05', kind: 'early_repayment', amount }] };
  const done = { ...base, events: [{ date: '2027-03-05', kind: 'early_repayment', amount }] };

  /* Un remboursement PLANIFIÉ fait chuter le capital sans être une échéance : « reste à payer »
     perdait purement et simplement son montant, et l'addition affichée ne tombait plus. */
  it('un remboursement planifié reste dû', () => {
    const r = recap(planned);
    expect(r.leftToPay - r.scheduleLeft).toBeCloseTo(amount, 2);
    expect(r.leftToPay).toBeCloseTo(r.crd + r.interestLeft + r.insuranceLeft, 2);
  });

  // Une fois passé, c'est de l'argent sorti du compte : il appartient au « déjà payé ».
  it('un remboursement déjà effectué compte dans le déjà payé', () => {
    const r = recap(done);
    const sansEvent = recap(base);
    expect(r.paid).toBeGreaterThan(sansEvent.paid);
    expect(r.crd).toBeLessThan(sansEvent.crd - amount * 0.9); // capital réellement amputé
  });

  // La contrepartie : le total (payé + restant) ne doit pas gonfler d'un remboursement fantôme.
  it('le remboursement n\'est compté qu\'une fois', () => {
    const sansEvent = recap(base);
    const r = recap(done);
    expect(r.paid + r.leftToPay).toBeLessThan(sansEvent.paid + sansEvent.leftToPay);
  });
});
