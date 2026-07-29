import { computeAvgMonthlyIncome } from '../lib/incomeAverage';
import { computeProfileFromData } from '../lib/financialProfileEngine';

/**
 * Le revenu de référence décidait du PROFIL, et il en existait deux mesures divergentes : celle du
 * Pilotage (mois courant compris) et celle du moteur de profils (6 mois révolus ÷ 6). Pour un
 * compte neuf, la seconde renvoyait 0 → « aucun revenu constaté » → P1 définitif, pendant que la
 * page affichait « 2 000 € » et « 7,5 mois de sécurité ». Ces tests verrouillent la mesure unique.
 */
const CHECKING = new Set(['c1']);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayOfThisMonth = (day: number) => {
  const n = new Date();
  return iso(new Date(n.getFullYear(), n.getMonth(), day));
};
const dayOfMonthsAgo = (n: number, day: number) => {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth() - n, day));
};

const salary = (date: string, amount = 2000) => ({
  account_id: 'c1', amount, date, is_draft: false, is_reserved: false,
  linked_account_id: null, note: null, category: { type: 'income' },
});

describe('computeAvgMonthlyIncome — la seule mesure du revenu de référence', () => {
  const today = iso(new Date());

  it('compte la paie du MOIS COURANT (le cas du compte tout neuf)', () => {
    expect(computeAvgMonthlyIncome([salary(dayOfThisMonth(1))], CHECKING, today)).toBe(2000);
  });

  it('moyenne les mois qui ont une recette, sans diviser par 6', () => {
    const txs = [salary(dayOfThisMonth(1)), salary(dayOfMonthsAgo(1, 1), 3000)];
    expect(computeAvgMonthlyIncome(txs, CHECKING, today)).toBe(2500);
  });

  it('ignore virements, brouillons, réservations et régularisations', () => {
    const txs = [
      salary(dayOfThisMonth(1)),
      { ...salary(dayOfThisMonth(2), 5000), linked_account_id: 'c2' },
      { ...salary(dayOfThisMonth(3), 5000), is_draft: true },
      { ...salary(dayOfThisMonth(4), 5000), is_reserved: true },
      { ...salary(dayOfThisMonth(5), 5000), note: 'Régul de solde' },
      // Montant positif sur une catégorie de dépense = remboursement, pas un revenu.
      { ...salary(dayOfThisMonth(6), 5000), category: { type: 'expense' } },
    ];
    expect(computeAvgMonthlyIncome(txs, CHECKING, today)).toBe(2000);
  });

  it('ignore une recette future (elle n’est pas encore constatée)', () => {
    const inTwoDays = iso(new Date(Date.now() + 2 * 86400000));
    expect(computeAvgMonthlyIncome([salary(inTwoDays)], CHECKING, today)).toBe(0);
  });

  it('ne compte pas les comptes qui ne sont pas des comptes courants', () => {
    expect(computeAvgMonthlyIncome([salary(dayOfThisMonth(1))], new Set(['autre']), today)).toBe(0);
  });
});

describe('le profil suit enfin les données du compte neuf', () => {
  it('7,5 mois de sécurité ne peut plus donner P1', () => {
    const income = computeAvgMonthlyIncome([salary(dayOfThisMonth(1))], CHECKING, iso(new Date()));
    const profile = computeProfileFromData({
      availableSavings: 15000,
      avgMonthlyIncome: income,
      monthlySetAside: 0,
      totalInvested: 0,
    });
    expect(income).toBe(2000);
    expect(profile).toBe('P4');
  });

  it('sans la mesure partagée, le même utilisateur retombait sur P1', () => {
    // Reproduction de l'ancien calcul : un seul mois de recette, divisé par 6 mois révolus → 0.
    const ancien = 0;
    expect(computeProfileFromData({
      availableSavings: 15000, avgMonthlyIncome: ancien, monthlySetAside: 0, totalInvested: 0,
    })).toBe('P1');
  });
});
