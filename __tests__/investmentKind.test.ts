/**
 * Nature d'une opération d'investissement — apport ou plus/moins-value.
 *
 * Elle se DEVINAIT au libellé (`/plus|moins|gain|perte/i`, `/apport/i`). Or le libellé est un champ
 * de texte libre, modifiable après coup depuis l'écran d'édition. Deux dérives silencieuses :
 *   • renommer « Plus-value » en « Revalorisation T3 » la sortait des plus-values — et le montant
 *     se mettait à gonfler l'APPORT, donc à écraser la performance affichée du compte ;
 *   • « Apport moins les frais » contient « moins » : le versement passait en moins-value.
 *
 * La nature est désormais une DONNÉE (`investment_kind`, migration 196), posée par le bouton qui
 * crée l'opération. Ces tests figent la primauté du marqueur sur le texte.
 */
import {
  isInvestmentGainLoss, isInvestmentDeposit, computeInvestmentGains,
} from '../lib/finance/investment';
import { computeContributed } from '../lib/finance/contributed';

describe('le MARQUEUR prime sur le libellé', () => {
  it('une plus-value renommée reste une plus-value', () => {
    const t = { investment_kind: 'gain' as const, note: 'Revalorisation T3' };
    expect(isInvestmentGainLoss(t)).toBe(true);
    expect(isInvestmentDeposit(t)).toBe(false);
  });

  it('un apport dont le libellé contient « moins » reste un apport', () => {
    const t = { investment_kind: 'deposit' as const, note: 'Apport moins les frais' };
    expect(isInvestmentDeposit(t)).toBe(true);
    // C'est exactement le cas que l'ancienne règle classait en MOINS-value.
    expect(isInvestmentGainLoss(t)).toBe(false);
  });

  it('une moins-value au libellé anodin reste une moins-value', () => {
    expect(isInvestmentGainLoss({ investment_kind: 'loss', note: 'Ajustement' })).toBe(true);
  });
});

describe('repli sur le libellé — lignes d\'avant la migration', () => {
  it('reconnaît encore une plus-value non marquée', () => {
    expect(isInvestmentGainLoss({ note: 'Plus-value' })).toBe(true);
    expect(isInvestmentGainLoss({ note: 'Perte sur cession' })).toBe(true);
  });

  it('reconnaît encore un apport non marqué', () => {
    expect(isInvestmentDeposit({ note: 'Apport janvier' })).toBe(true);
  });

  it('ne reconnaît rien sur un libellé neutre ou absent', () => {
    expect(isInvestmentGainLoss({ note: 'Virement' })).toBe(false);
    expect(isInvestmentGainLoss({ note: null })).toBe(false);
    expect(isInvestmentGainLoss(null)).toBe(false);
    expect(isInvestmentDeposit(undefined)).toBe(false);
  });
});

describe('computeInvestmentGains', () => {
  const inv = (over: any) => ({ account: { type: 'investment' }, ...over });

  it('additionne les plus/moins-values marquées, quel que soit leur libellé', () => {
    const { gains } = computeInvestmentGains([
      inv({ amount: 500, investment_kind: 'gain', note: 'Revalorisation' }),
      inv({ amount: -200, investment_kind: 'loss', note: 'Ajustement' }),
    ]);
    expect(gains).toBe(300);
  });

  it('n\'y compte PAS un apport, même intitulé « Apport moins les frais »', () => {
    const { gains } = computeInvestmentGains([
      inv({ amount: 1000, investment_kind: 'deposit', note: 'Apport moins les frais' }),
    ]);
    expect(gains).toBe(0);
  });

  it('ignore les brouillons et les comptes non-investissement', () => {
    const { gains } = computeInvestmentGains([
      inv({ amount: 500, investment_kind: 'gain', is_draft: true }),
      { account: { type: 'savings' }, amount: 500, investment_kind: 'gain' } as any,
    ]);
    expect(gains).toBe(0);
  });
});

describe('computeContributed — l\'apport ne bouge pas sur une plus-value', () => {
  const account = { id: 'a1', type: 'investment', balance: 12000, initial_contributed: 10000 };
  const tx = (over: any) => ({ account_id: 'a1', date: '2020-01-01', ...over });

  it('un versement marqué augmente l\'apport', () => {
    const out = computeContributed(account, [tx({ amount: 1000, investment_kind: 'deposit', note: 'Versement' })]);
    expect(out).toBe(11000);
  });

  /* LE CAS QUI CASSAIT : la plus-value renommée n'était plus reconnue, donc traitée comme un
     apport — le capital investi grimpait et la performance du compte s'effondrait. */
  it('une plus-value RENOMMÉE ne touche pas à l\'apport', () => {
    const out = computeContributed(account, [tx({ amount: 2000, investment_kind: 'gain', note: 'Revalorisation T3' })]);
    expect(out).toBe(10000);
  });

  it('un versement dont le libellé contient « moins » augmente bien l\'apport', () => {
    const out = computeContributed(account, [tx({ amount: 800, investment_kind: 'deposit', note: 'Apport moins les frais' })]);
    expect(out).toBe(10800);
  });

  it('un virement entrant reste un apport, sans marqueur', () => {
    const out = computeContributed(account, [tx({ amount: 500, linked_account_id: 'a2' })]);
    expect(out).toBe(10500);
  });
});
