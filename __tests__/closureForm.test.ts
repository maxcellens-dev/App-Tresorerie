import {
  balanceAtEnd,
  lastVerifiedDate,
  parseTypedAmount,
  unknownGap,
  unknownTotalGap,
  hasAnyTypedBalance,
  closingSharePct,
} from '../lib/finance/closureForm';

/**
 * Tests de caractérisation du CALCUL de la clôture mensuelle.
 *
 * Ces fonctions décident de montants qui finissent écrits en base sous forme de régularisation : un
 * écart mal signé, et le solde de l'utilisateur part dans le mauvais sens. Jusqu'ici elles vivaient
 * au milieu d'un composant de 800 lignes, donc vérifiables uniquement à l'œil, dans l'app.
 *
 * L'horloge est injectée : « ce qui s'est passé depuis » est la moitié de ces calculs.
 */

/** Horloge de référence : 15 juin 2026. On clôture donc mai (2026-05). */
const NOW = new Date(2026, 5, 15, 12, 0, 0);
const CLOSE = '2026-05';

const tx = (over: any = {}): any => ({
  account_id: 'acc-1', date: '2026-06-10', amount: -100,
  is_draft: false, is_recurring: false, regul_target: null, note: null, category: null,
  ...over,
});

describe('balanceAtEnd — reconstituer le solde de fin de mois', () => {
  it('retire du solde actuel ce qui est arrivé APRÈS la fin du mois clôturé', () => {
    const allTx = [
      tx({ date: '2026-06-02', amount: -300 }),
      tx({ date: '2026-06-10', amount: -200 }),
      tx({ date: '2026-05-28', amount: -999 }), // dans le mois clôturé → déjà pris en compte
    ];
    // 1000 − (−500) = 1500 : le compte valait 1500 fin mai
    expect(balanceAtEnd(allTx, 'acc-1', 1000, CLOSE, NOW)).toBe(1500);
  });

  it('ignore les brouillons : ce n\'est pas de l\'argent sorti', () => {
    expect(balanceAtEnd([tx({ amount: -500, is_draft: true })], 'acc-1', 1000, CLOSE, NOW)).toBe(1000);
  });

  it('ignore les lignes récurrentes : ce sont des occurrences PROJETÉES', () => {
    expect(balanceAtEnd([tx({ amount: -500, is_recurring: true })], 'acc-1', 1000, CLOSE, NOW)).toBe(1000);
  });

  it('ne mélange pas les comptes', () => {
    expect(balanceAtEnd([tx({ account_id: 'acc-2', amount: -500 })], 'acc-1', 1000, CLOSE, NOW)).toBe(1000);
  });

  it('exclut la fin de mois elle-même — le dernier jour appartient au mois clôturé', () => {
    expect(balanceAtEnd([tx({ date: '2026-05-31', amount: -500 })], 'acc-1', 1000, CLOSE, NOW)).toBe(1000);
    expect(balanceAtEnd([tx({ date: '2026-06-01', amount: -500 })], 'acc-1', 1000, CLOSE, NOW)).toBe(1500);
  });

  /* LE BUG QUI FAISAIT « BOUGER » UN MOIS DÉJÀ CLÔTURÉ.
     `accounts.balance` est le solde À DATE (la fonction SQL ne somme que `date <= aujourd'hui`).
     Retrancher les opérations PLANIFIÉES revenait donc à retirer du solde ce qui n'y était pas :
     le chiffre proposé était faux, et il changeait à chaque nouvelle saisie de futur — d'où deux
     propositions différentes pour le même mois entre la première clôture et une réouverture. */
  it('ignore le FUTUR : il n\'est pas dans le solde à date qu\'on décompte', () => {
    const planned = tx({ date: '2026-07-05', amount: -800 }); // après NOW (15 juin)
    expect(balanceAtEnd([planned], 'acc-1', 1000, CLOSE, NOW)).toBe(1000);
    // …et une opération passée du mois suivant, elle, compte bien.
    expect(balanceAtEnd([planned, tx({ date: '2026-06-02', amount: -300 })], 'acc-1', 1000, CLOSE, NOW)).toBe(1300);
  });

  it('rend le solde tel quel quand aucun mois n\'est visé', () => {
    expect(balanceAtEnd([tx({ amount: -500 })], 'acc-1', 1000, null, NOW)).toBe(1000);
  });

  it('gère un février (dernier jour au 28)', () => {
    expect(balanceAtEnd([tx({ date: '2026-02-28', amount: -500 })], 'acc-1', 1000, '2026-02', NOW)).toBe(1000);
    expect(balanceAtEnd([tx({ date: '2026-03-01', amount: -500 })], 'acc-1', 1000, '2026-02', NOW)).toBe(1500);
  });
});

describe('lastVerifiedDate — depuis quand le solde n\'a-t-il pas été vérifié', () => {
  it('retient la régularisation la PLUS RÉCENTE, mais pas une future', () => {
    const allTx = [
      tx({ date: '2026-04-10', regul_target: 900 }),
      tx({ date: '2026-06-01', regul_target: 950 }),
      tx({ date: '2026-08-01', regul_target: 999 }), // future → ne vérifie rien encore
    ];
    expect(lastVerifiedDate(allTx, 'acc-1', CLOSE, NOW)).toBe('2026-06-01');
  });

  it('se replie sur le 1er du mois clôturé quand aucune régul n\'existe', () => {
    expect(lastVerifiedDate([tx({ amount: -50 })], 'acc-1', CLOSE, NOW)).toBe('2026-05-01');
  });

  it('reconnaît une régul ancienne par sa note, sans regul_target', () => {
    const allTx = [tx({ date: '2026-06-01', note: 'Ajustement de solde' })];
    expect(lastVerifiedDate(allTx, 'acc-1', CLOSE, NOW)).toBe('2026-06-01');
  });

  it('ne prend pas la régul d\'un AUTRE compte', () => {
    const allTx = [tx({ account_id: 'acc-2', date: '2026-06-01', regul_target: 950 })];
    expect(lastVerifiedDate(allTx, 'acc-1', CLOSE, NOW)).toBe('2026-05-01');
  });
});

describe('parseTypedAmount', () => {
  it('accepte la virgule décimale', () => {
    expect(parseTypedAmount('1234,56')).toBeCloseTo(1234.56);
  });
  it('rend null sur un champ vide, blanc ou illisible', () => {
    expect(parseTypedAmount('')).toBeNull();
    expect(parseTypedAmount('   ')).toBeNull();
    expect(parseTypedAmount('abc')).toBeNull();
    expect(parseTypedAmount(null)).toBeNull();
    expect(parseTypedAmount(undefined)).toBeNull();
  });
  it('distingue un zéro SAISI d\'un champ vide', () => {
    expect(parseTypedAmount('0')).toBe(0);
  });
});

describe('unknownGap — « je ne sais pas ce que valait mon compte »', () => {
  const acc = { id: 'acc-1', balance: 1000 };

  it('compare le solde annoncé au solde CONNU à la date annoncée, pas à la fin du mois', () => {
    // L'utilisateur dit : « au 1er juin, j'avais 1200 ». Depuis, −300 sont passés.
    // Solde connu au 1er juin = 1000 − (−300) = 1300. Écart = 1200 − 1300 = −100.
    const allTx = [tx({ date: '2026-06-05', amount: -300 })];
    expect(unknownGap(allTx, acc, '1200', '2026-06-01', NOW)).toBe(-100);
  });

  it('ignore ce qui vient APRÈS aujourd\'hui : le futur n\'est pas encore sorti du compte', () => {
    const allTx = [tx({ date: '2026-06-20', amount: -300 })]; // après le 15
    expect(unknownGap(allTx, acc, '1200', '2026-06-01', NOW)).toBe(200); // 1200 − 1000
  });

  it('vaut zéro quand rien n\'est saisi — un champ vide n\'est pas un écart nul constaté', () => {
    expect(unknownGap([], acc, '', '2026-06-01', NOW)).toBe(0);
    expect(unknownGap([], acc, undefined, '2026-06-01', NOW)).toBe(0);
  });

  it('exclut brouillons et récurrentes du « depuis »', () => {
    const allTx = [
      tx({ date: '2026-06-05', amount: -300, is_draft: true }),
      tx({ date: '2026-06-05', amount: -300, is_recurring: true }),
    ];
    expect(unknownGap(allTx, acc, '1000', '2026-06-01', NOW)).toBe(0);
  });

  it('somme les écarts de tous les comptes renseignés', () => {
    const accounts = [{ id: 'acc-1', balance: 1000 }, { id: 'acc-2', balance: 500 }];
    const balances = { 'acc-1': '1100', 'acc-2': '450' };
    expect(unknownTotalGap([], accounts, balances, '2026-06-01', NOW)).toBe(50); // +100 −50
  });

  it('un compte non renseigné ne pèse rien dans le total', () => {
    const accounts = [{ id: 'acc-1', balance: 1000 }, { id: 'acc-2', balance: 500 }];
    expect(unknownTotalGap([], accounts, { 'acc-1': '1100' }, '2026-06-01', NOW)).toBe(100);
  });

  /* Multi-devises : l'écart de chaque compte est libellé dans SA devise. Les additionner tels quels
     donne un nombre qui ne veut rien dire — d'où le convertisseur fourni par l'appelant. */
  it('convertit chaque écart avant de sommer quand les comptes sont en devises différentes', () => {
    const accounts = [
      { id: 'acc-eur', balance: 1000, currency: 'EUR' },
      { id: 'acc-chf', balance: 500, currency: 'CHF' },
    ];
    const balances = { 'acc-eur': '1100', 'acc-chf': '600' }; // +100 EUR et +100 CHF
    // 1 EUR = 0,95 CHF → 100 CHF ≈ 105,26 EUR. Sans conversion, on lirait 200.
    const toEur = (gap: number, a: { currency?: string | null }) =>
      a.currency === 'CHF' ? gap / 0.95 : gap;
    const total = unknownTotalGap([], accounts, balances, '2026-06-01', NOW, toEur);
    expect(total).toBeCloseTo(100 + 100 / 0.95, 2);
    expect(total).not.toBe(200);
  });

  it('sans convertisseur, le comportement mono-devise est inchangé', () => {
    const accounts = [{ id: 'acc-1', balance: 1000 }, { id: 'acc-2', balance: 500 }];
    const balances = { 'acc-1': '1100', 'acc-2': '600' };
    expect(unknownTotalGap([], accounts, balances, '2026-06-01', NOW)).toBe(200);
  });
});

describe('hasAnyTypedBalance', () => {
  const accounts = [{ id: 'a', balance: 0 }, { id: 'b', balance: 0 }];
  it('est faux tant qu\'aucun montant lisible n\'est saisi', () => {
    expect(hasAnyTypedBalance(accounts, {})).toBe(false);
    expect(hasAnyTypedBalance(accounts, { a: '', b: '   ' })).toBe(false);
    expect(hasAnyTypedBalance(accounts, { a: 'abc' })).toBe(false);
  });
  it('est vrai dès qu\'un seul compte est renseigné, zéro compris', () => {
    expect(hasAnyTypedBalance(accounts, { b: '0' })).toBe(true);
  });
});

describe('closingSharePct — répartir l\'écart entre le mois clôturé et le mois en cours', () => {
  it('respecte le curseur dès que l\'utilisateur l\'a bougé', () => {
    expect(closingSharePct([], 'acc-1', CLOSE, '2026-06-10', 80, NOW)).toBe(80);
    expect(closingSharePct([], 'acc-1', CLOSE, '2026-06-10', 0, NOW)).toBe(0);
  });

  it('propose un prorata par jours quand le curseur n\'a pas bougé', () => {
    // Aucune régul → segment = du 1er mai au 10 juin. La part de mai est majoritaire.
    const pct = closingSharePct([], 'acc-1', CLOSE, '2026-06-10', null, NOW);
    expect(pct).toBeGreaterThan(50);
    expect(pct).toBeLessThanOrEqual(100);
  });

  it('reste borné à [0, 100]', () => {
    const pct = closingSharePct([], 'acc-1', CLOSE, '2026-12-31', null, NOW);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  it('retombe sur 50 % quand aucun mois n\'est visé', () => {
    expect(closingSharePct([], 'acc-1', null, '2026-06-10', null, NOW)).toBe(50);
  });
});
