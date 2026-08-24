import {
  computeAvgMonthlyIncome, computeMonthIncome, computeReferenceMonthlyIncome,
} from '../lib/finance/incomeAverage';
import { computeProfileFromData } from '../lib/finance/financialProfileEngine';
import { computeSecurityCushion } from '../lib/finance/securityCushion';

/**
 * Le revenu de référence décidait du PROFIL, et il en existait deux mesures divergentes : celle du
 * Pilotage (mois courant compris) et celle du moteur de profils (6 mois révolus ÷ 6). Pour un
 * compte neuf, la seconde renvoyait 0 → « aucun revenu constaté » → P1 définitif, pendant que la
 * page affichait « 2 000 € » et « 7,5 mois de sécurité ». Ces tests verrouillent la mesure unique.
 */
const CHECKING = new Set(['c1']);
/* Les deux PORTES D'ENTRÉE du classement (cf. ProfileDataInputs) : ces cas-ci portent sur le revenu,
   pas sur la complétude des données — on ouvre donc les deux pour ne mesurer qu'une chose à la fois. */
const known = { hasSavingsAccount: true, hasRecurringExpenses: true };
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
  const recurring = (date: string, amount = 2000, rule = 'monthly', id = 'r1') => ({
    ...salary(date, amount), id, is_recurring: true, recurrence_rule: rule,
  });
  /** Occurrence déjà matérialisée d'un modèle (migration 030 : is_recurring=false + lien). */
  const materializedOf = (date: string, amount: number, parent = 'r1') => ({
    ...salary(date, amount), materialized_from: parent,
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

  /* ── Toute périodicité est ramenée au MOIS ────────────────────────────────────────────────
     Un revenu trimestriel de 6 000 €, ce n'est pas « 6 000 € un mois et rien les deux suivants »
     quand on cherche combien quelqu'un gagne : c'est 2 000 €/mois. Le matelas et le profil
     raisonnent en rythme mensuel. */
  it('ramène l’hebdomadaire au mois (≈ 4,35 semaines)', () => {
    expect(computeMonthIncome([recurring(dayOfThisMonth(1), 300, 'weekly')], CHECKING, THIS))
      .toBeCloseTo(300 * (365 / 12 / 7), 2);
  });

  it('ramène le TRIMESTRIEL au mois (÷ 3)', () => {
    expect(computeMonthIncome([recurring(dayOfThisMonth(10), 6000, 'quarterly')], CHECKING, THIS)).toBe(2000);
  });

  it('ramène l’ANNUEL au mois (÷ 12)', () => {
    expect(computeMonthIncome([recurring(dayOfThisMonth(10), 12000, 'yearly')], CHECKING, THIS)).toBe(1000);
  });

  it('un trimestriel rapporte AUSSI les mois où il ne tombe pas', () => {
    // Modèle daté dans 2 mois : il ne tombe pas ce mois-ci, mais il rapporte bien 2 000 €/mois.
    const n = new Date();
    const inTwoMonths = iso(new Date(n.getFullYear(), n.getMonth() + 2, 10));
    const txs = [{ ...recurring(inTwoMonths, 6000, 'quarterly'), id: 'q1' },
                 materializedOf(dayOfThisMonth(2), 6000, 'q1')];
    expect(computeMonthIncome(txs, CHECKING, THIS)).toBe(2000);
  });

  it('ne compte PAS deux fois une échéance déjà matérialisée', () => {
    /* Après matérialisation, l'échéance passée est une ligne réelle (avec materialized_from) ET le
       modèle a été avancé au mois suivant. Le mois ne doit compter le salaire qu'une fois. */
    const txs = [materializedOf(dayOfThisMonth(5), 2000), recurring(dayOfNextMonth(5), 2000)];
    expect(computeMonthIncome(txs, CHECKING, THIS)).toBe(2000);
    expect(computeMonthIncome(txs, CHECKING, NEXT)).toBe(2000);
  });

  it('le mois où le salaire est DÉJÀ tombé garde aussi les primes ponctuelles', () => {
    /* Le modèle a été avancé au mois prochain : le lire naïvement ferait conclure « rien ce
       mois-ci » et le mois perdrait le salaire, ne gardant que la prime. */
    const txs = [
      materializedOf(dayOfThisMonth(5), 2000),      // salaire déjà versé
      recurring(dayOfNextMonth(5), 2000),           // modèle avancé
      salary(dayOfThisMonth(20), 500),              // prime ponctuelle
    ];
    expect(computeMonthIncome(txs, CHECKING, THIS)).toBe(2500);
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
      availableSavings: 15000, avgMonthlyIncome: income, totalInvested: 0, ...known,
    })).toBe('P5');                     // au lieu de P1 : 7,5 mois de réserve, tout en liquide
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
  it('7,5 mois de sécurité ne peut plus donner le profil le plus bas', () => {
    const income = computeAvgMonthlyIncome([salary(dayOfThisMonth(1))], CHECKING, iso(new Date()));
    const profile = computeProfileFromData({
      availableSavings: 15000,
      avgMonthlyIncome: income,
      totalInvested: 0,
      ...known,
    });
    expect(income).toBe(2000);
    expect(profile).toBe('P5');
  });

  it('sans la mesure partagée, le même utilisateur retombait au plus bas — désormais P0 « Découverte »', () => {
    // Reproduction de l'ancien calcul : un seul mois de recette, divisé par 6 mois révolus → 0.
    const ancien = 0;
    expect(computeProfileFromData({
      availableSavings: 15000, avgMonthlyIncome: ancien, totalInvested: 0, ...known,
    })).toBe('P0');
  });
});

/**
 * RECEVOIR DE L'ARGENT NE PEUT PAS DÉGRADER LA SITUATION.
 *
 * Le revenu de référence est le DIVISEUR du matelas de sécurité (épargne ÷ revenu), donc du profil.
 * Une rentrée ponctuelle très élevée le faisait bondir : le matelas s'effondrait et le profil
 * tombait de P5 à P3 — pour se relever dès qu'on supprimait la ligne. Les mois sans commune mesure
 * avec les autres sont donc écartés de la moyenne : ils ne disent rien du revenu habituel.
 */
describe('une rentrée exceptionnelle ne fait pas chuter le revenu de référence', () => {
  const today = iso(new Date());
  const etabli = dayOfMonthsAgo(8, 1); // compte installé : le passé fait foi

  /** Cinq mois de salaire + le mois courant, dont le montant est paramétrable. */
  const sixMonths = (thisMonthAmount: number) => [
    ...[5, 4, 3, 2, 1].map((n) => salary(dayOfMonthsAgo(n, 5), 2000)),
    salary(dayOfThisMonth(1), thisMonthAmount),
  ];

  it('écarte le mois hors norme au lieu de le moyenner', () => {
    expect(computeReferenceMonthlyIncome(sixMonths(2000), CHECKING, today, etabli)).toBe(2000);
    // Avant : (2 000 × 5 + 22 000) ÷ 6 = 5 333 € — un « revenu habituel » que personne n'a jamais eu.
    expect(computeReferenceMonthlyIncome(sixMonths(22000), CHECKING, today, etabli)).toBe(2000);
  });

  it('le profil ne redescend plus après avoir encaissé une grosse somme', () => {
    const profileFor = (thisMonthAmount: number) => computeProfileFromData({
      availableSavings: 15000,
      avgMonthlyIncome: computeReferenceMonthlyIncome(sixMonths(thisMonthAmount), CHECKING, today, etabli),
      totalInvested: 3000,
      ...known,
    });
    expect(profileFor(2000)).toBe('P6');    // 7,5 mois de sécurité + il investit
    expect(profileFor(22000)).toBe('P6');   // encaisser 20 000 € de plus ne peut pas faire redescendre
  });

  it('une vraie hausse de revenu passe (elle n’est pas « hors norme »)', () => {
    // Second salaire qui arrive sur le compte : 2 000 → 4 000 €. La moyenne doit le refléter.
    const txs = [
      ...[5, 4, 3].map((n) => salary(dayOfMonthsAgo(n, 5), 2000)),
      ...[2, 1].map((n) => salary(dayOfMonthsAgo(n, 5), 4000)),
      salary(dayOfThisMonth(1), 4000),
    ];
    expect(computeReferenceMonthlyIncome(txs, CHECKING, today, etabli)).toBe(3000);
  });

  it('un revenu irrégulier garde tous ses mois (jamais de moyenne vide)', () => {
    const txs = [
      salary(dayOfMonthsAgo(2, 5), 1000),
      salary(dayOfMonthsAgo(1, 5), 2000),
      salary(dayOfThisMonth(1), 3000),
    ];
    expect(computeReferenceMonthlyIncome(txs, CHECKING, today, etabli)).toBe(2000);
  });
});
