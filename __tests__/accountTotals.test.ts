import { computeAccountTotals, resolveFilter, isSharedAccount, type TotalsAccount } from '../lib/finance/accountTotals';

// Conversion : 1 CHF = 1,05 € (test), tout le reste est déjà en euros.
const toRef = (v: number, cur: string) => (cur === 'CHF' ? v * 1.05 : v);

const perso = (type: string, balance: number, currency = 'EUR'): TotalsAccount =>
  ({ type, balance, currency, _role: 'owner', is_joint: false });

const joint = (type: string, balance: number, impact: number | null = null): TotalsAccount =>
  ({ type, balance, currency: 'EUR', _role: 'owner', is_joint: true, _impact_pct: impact });

describe('périmètre du filtre', () => {
  const accounts = [perso('checking', 1000), joint('checking', 2000, 50)];

  it('« Tout » additionne perso et partagés', () => {
    expect(computeAccountTotals(accounts, 'all', toRef).total).toBe(2000); // 1000 + 2000×50%
  });

  it('« Perso » exclut les comptes partagés', () => {
    expect(computeAccountTotals(accounts, 'perso', toRef).total).toBe(1000);
  });

  it('« Partagés » ne renvoie plus 0 € — c’était le bug', () => {
    expect(computeAccountTotals(accounts, 'shared', toRef).total).toBe(1000); // 2000 × 50 %
  });

  it('sans compte partagé, une préférence « Partagés » retombe sur « Tout »', () => {
    const onlyPerso = [perso('savings', 500)];
    const t = computeAccountTotals(onlyPerso, 'shared', toRef);
    expect(t.appliedFilter).toBe('all');
    expect(t.total).toBe(500); // et non 0 € sans moyen d'en sortir
  });

  it('reconnaît un compte reçu d’un autre utilisateur comme partagé', () => {
    expect(isSharedAccount({ balance: 0, _role: 'write' })).toBe(true);
    expect(isSharedAccount({ balance: 0, _role: 'owner', is_joint: false })).toBe(false);
    expect(resolveFilter('shared', [{ balance: 0, _role: 'read' }])).toBe('shared');
  });
});

describe('pondération par % d’impact', () => {
  it('un compte joint à 50 % ne compte que pour moitié', () => {
    expect(computeAccountTotals([joint('checking', 1000, 50)], 'all', toRef).total).toBe(500);
  });

  it('_impact_pct absent vaut 100 % (compte perso)', () => {
    expect(computeAccountTotals([perso('checking', 1000)], 'all', toRef).total).toBe(1000);
  });

  it('un 0 explicite reste 0 — le compte ne pèse rien, il n’est pas « non renseigné »', () => {
    expect(computeAccountTotals([joint('checking', 1000, 0)], 'all', toRef).total).toBe(0);
  });
});

describe('LA règle : la somme des postes rendus égale le total', () => {
  it('avec un compte « Autre » dans le lot', () => {
    const t = computeAccountTotals(
      [perso('checking', 1000), perso('savings', 2000), perso('investment', 500), perso('other', 700)],
      'all', toRef,
    );
    expect(t.hasOther).toBe(true);
    expect(t.checking + t.savings + t.investment + t.other).toBe(t.total);
    expect(t.total).toBe(4200);
  });

  it('un type inconnu tombe dans « Autre » plutôt que de disparaître du découpage', () => {
    const t = computeAccountTotals([perso('checking', 100), perso('crypto', 900)], 'all', toRef);
    expect(t.other).toBe(900);
    expect(t.checking + t.savings + t.investment + t.other).toBe(t.total);
  });

  it('sans compte « Autre », la 4ᵉ carte n’est pas demandée', () => {
    const t = computeAccountTotals([perso('checking', 100), perso('savings', 50)], 'all', toRef);
    expect(t.hasOther).toBe(false);
    expect(t.other).toBe(0);
  });
});

describe('devises', () => {
  it('convertit chaque solde dans la devise de référence', () => {
    const t = computeAccountTotals([perso('checking', 100, 'CHF')], 'all', toRef);
    expect(t.total).toBeCloseTo(105, 5);
    expect(t.mixedCurrencies).toBe(false); // une seule devise en jeu : pas de « ≈ »
  });

  it('« ≈ » ne se déclenche que sur le périmètre RÉELLEMENT totalisé', () => {
    const accounts = [perso('checking', 100, 'EUR'), joint('checking', 100), { ...joint('savings', 200), currency: 'CHF' }];
    // Filtre « Perso » : il ne reste que de l'euro → le total est exact, pas approximatif.
    expect(computeAccountTotals(accounts, 'perso', toRef).mixedCurrencies).toBe(false);
    expect(computeAccountTotals(accounts, 'all', toRef).mixedCurrencies).toBe(true);
  });
});

describe('données abîmées', () => {
  it('un solde illisible ne contamine pas le total affiché', () => {
    const t = computeAccountTotals(
      [perso('checking', 1000), { type: 'savings', balance: null as any, _role: 'owner' }],
      'all', toRef,
    );
    expect(t.total).toBe(1000);
    expect(Number.isNaN(t.total)).toBe(false);
  });

  it('aucun compte → tout à zéro, pas de NaN', () => {
    const t = computeAccountTotals([], 'all', toRef);
    expect(t.total).toBe(0);
    expect(t.mixedCurrencies).toBe(false);
  });
});
