import {
  computeAvgMonthlyIncome, computeMonthIncome, computeReferenceMonthlyIncome,
} from '../lib/incomeAverage';
import { computeProfileFromData } from '../lib/financialProfileEngine';
import { computeSecurityCushion } from '../lib/securityCushion';

/**
 * Le revenu de référence décidait du PROFIL, et il en existait deux mesures divergentes : celle du
 * Pilotage (mois courant compris) et celle du moteur de profils (6 mois révolus ÷ 6). Pour un
 * compte neuf, la seconde renvoyait 0 → « aucun revenu constaté » → P1 définitif, pendant que la
 * page affichait « 2 000 € » et « 7,5 mois de sécurité ». Ces tests verrouillent la mesure unique.
 */
const CHECKING = new Set(['c1']);
// Jour LOCAL : `toISOString()` bascule en UTC et décale d'un jour à l'est de Greenwich.
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthOf = (offset: number) => {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
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

/**
 * Le revenu constaté ignore volontairement le futur. Au DÉMARRAGE c'est un piège : saisir son
 * salaire à une date encore à venir (le 30 quand on est le 20, ou le mois suivant) est parfaitement
 * légitime, et laissait pourtant l'app sans aucun revenu — matelas vide, profil bloqué sur P1.
 *
 * Au démarrage on ne cherche donc pas « la » recette, mais le TOTAL du mois : combien cette
 * personne gagne, en gros, sur un mois — tout ce qui rentre, déjà tombé ou encore à venir.
 */
describe('démarrage — le TOTAL du mois, pas seulement ce qui est déjà tombé', () => {
  const today = iso(new Date());
  const recurring = (date: string, amount = 2000, rule = 'monthly') => ({
    ...salary(date, amount), is_recurring: true, recurrence_rule: rule,
  });
  /** Jour du mois SUIVANT (le cas « je m'inscris le 28, ma prochaine paie est en septembre »). */
  const dayOfNextMonth = (day: number) => {
    const n = new Date();
    return iso(new Date(n.getFullYear(), n.getMonth() + 1, day));
  };
  const THIS = monthOf(0);
  const NEXT = monthOf(1);

  // ── Ce que le mois totalise ───────────────────────────────────────────────────────────────
  it('ADDITIONNE toutes les rentrées du mois — jamais une seule', () => {
    const txs = [salary(dayOfThisMonth(3), 1500), salary(dayOfThisMonth(20), 600), salary(dayOfThisMonth(27), 300)];
    expect(computeMonthIncome(txs, CHECKING, THIS)).toBe(2400);
  });

  it('mélange déjà tombé et encore à venir dans le même mois', () => {
    // C'était LE trou : seul le passé comptait, donc une seule des deux paies.
    const txs = [salary(dayOfThisMonth(1), 1500), salary(dayOfThisMonth(28), 900)];
    expect(computeMonthIncome(txs, CHECKING, THIS)).toBe(2400);
  });

  it('additionne une récurrente ET une recette ponctuelle du même mois', () => {
    const txs = [recurring(dayOfThisMonth(28), 2000), salary(dayOfThisMonth(10), 350)];
    expect(computeMonthIncome(txs, CHECKING, THIS)).toBe(2350);
  });

  it('compte une récurrente hebdomadaire autant de fois qu’elle tombe', () => {
    // Modèle au 1er du mois : 1, 8, 15, 22, 29 → au moins 4 occurrences dans tout mois.
    const total = computeMonthIncome([recurring(dayOfThisMonth(1), 300, 'weekly')], CHECKING, THIS);
    expect(total).toBeGreaterThanOrEqual(1200);
    expect(total).toBeLessThanOrEqual(1500);
  });

  it('ne compte PAS deux fois une échéance déjà matérialisée', () => {
    /* Après matérialisation, l'échéance passée est une ligne réelle ET le modèle a été avancé au
       mois suivant. Le mois courant ne doit donc voir que la ligne réelle. */
    const materialized = salary(dayOfThisMonth(5), 2000);            // is_recurring: false
    const template = recurring(dayOfNextMonth(5), 2000);             // modèle avancé
    expect(computeMonthIncome([materialized, template], CHECKING, THIS)).toBe(2000);
    expect(computeMonthIncome([materialized, template], CHECKING, NEXT)).toBe(2000);
  });

  it('ignore charges fixes, virements internes et remboursements', () => {
    const txs = [
      recurring(dayOfThisMonth(5), -900),                                  // charge fixe
      { ...recurring(dayOfThisMonth(6), 5000), linked_account_id: 'c2' },  // virement interne
      { ...salary(dayOfThisMonth(7), 400), category: { type: 'expense' } }, // remboursement
    ];
    expect(computeMonthIncome(txs, CHECKING, THIS)).toBe(0);
  });

  // ── Quel mois sert de référence ───────────────────────────────────────────────────────────
  it('le mois COURANT sert de référence dès qu’il porte quelque chose', () => {
    const txs = [salary(dayOfThisMonth(15), 2000), salary(dayOfNextMonth(5), 9000)];
    expect(computeReferenceMonthlyIncome(txs, CHECKING, today)).toBe(2000);
  });

  it('le mois SUIVANT ne sert QUE si le mois courant est vide', () => {
    expect(computeReferenceMonthlyIncome([salary(dayOfNextMonth(5), 1900)], CHECKING, today)).toBe(1900);
  });

  it('un salaire récurrent à venir suffit à établir le revenu', () => {
    const txs = [recurring(dayOfNextMonth(5), 2000)];
    expect(computeAvgMonthlyIncome(txs, CHECKING, today)).toBe(0);   // rien de constaté
    expect(computeReferenceMonthlyIncome(txs, CHECKING, today)).toBe(2000);
  });

  it('ignore une recette au-delà du mois suivant', () => {
    const n = new Date();
    const inThreeMonths = iso(new Date(n.getFullYear(), n.getMonth() + 3, 5));
    expect(computeReferenceMonthlyIncome([salary(inThreeMonths, 2000)], CHECKING, today)).toBe(0);
  });

  it('le matelas de sécurité se remplit dès la saisie, sans attendre la paie', () => {
    const income = computeReferenceMonthlyIncome([recurring(dayOfNextMonth(5), 2000)], CHECKING, today);
    const cushion = computeSecurityCushion({ availableSavings: 15000, avgMonthlyIncome: income });
    expect(cushion.months).toBe(7.5);   // au lieu de `null` (« — » à l'écran)
    expect(computeProfileFromData({
      availableSavings: 15000, avgMonthlyIncome: income, monthlySetAside: 0, totalInvested: 0,
    })).toBe('P4');                     // au lieu de P1
  });

  // ── Une fois un mois complet vécu, la déclaration ne sert plus à rien ──
  describe('dès qu’un mois complet est passé, seul le passé compte', () => {
    const oldAccount = dayOfMonthsAgo(4, 12); // créé il y a 4 mois → largement un mois complet

    it('une saisie à venir n’est plus prise en compte', () => {
      expect(computeReferenceMonthlyIncome([recurring(dayOfNextMonth(5), 2000)], CHECKING, today, oldAccount)).toBe(0);
      expect(computeReferenceMonthlyIncome([salary(dayOfNextMonth(5), 2000)], CHECKING, today, oldAccount)).toBe(0);
    });

    it('le revenu mesuré fait foi', () => {
      const txs = [salary(dayOfMonthsAgo(1, 5), 1700), recurring(dayOfNextMonth(5), 9000)];
      expect(computeReferenceMonthlyIncome(txs, CHECKING, today, oldAccount)).toBe(1700);
    });

    it('le premier mois, forcément partiel, ne suffit pas à basculer', () => {
      const justCreated = dayOfThisMonth(1);
      expect(computeReferenceMonthlyIncome([recurring(dayOfNextMonth(5), 2000)], CHECKING, today, justCreated)).toBe(2000);
    });
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
