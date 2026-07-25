import { sortAccounts, compareAccounts, accountTypeRank } from '../lib/accountOrder';

const acc = (name: string, type: string, is_default = false) => ({ name, type, is_default });

describe('accountOrder — ordre unique des comptes dans toute l’app', () => {
  it('trie par TYPE : courant → épargne → investissement → autre', () => {
    const list = [acc('Divers', 'other'), acc('PEA', 'investment'), acc('Livret A', 'savings'), acc('CCP', 'checking')];
    expect(sortAccounts(list).map((a) => a.type)).toEqual(['checking', 'savings', 'investment', 'other']);
  });

  it('le compte PRINCIPAL passe toujours en tête, quel que soit son rang de type', () => {
    const list = [acc('CCP', 'checking'), acc('Livret A', 'savings'), acc('Compte 2', 'checking', true)];
    expect(sortAccounts(list).map((a) => a.name)).toEqual(['Compte 2', 'CCP', 'Livret A']);
  });

  it('à type égal, tri alphabétique (accents gérés)', () => {
    const list = [acc('Zébu', 'checking'), acc('École', 'checking'), acc('Auto', 'checking')];
    expect(sortAccounts(list).map((a) => a.name)).toEqual(['Auto', 'École', 'Zébu']);
  });

  it('un type inconnu finit en dernier (jamais devant les types connus)', () => {
    expect(accountTypeRank('inconnu')).toBeGreaterThan(accountTypeRank('other'));
    const list = [acc('Mystère', 'crypto'), acc('CCP', 'checking')];
    expect(sortAccounts(list).map((a) => a.name)).toEqual(['CCP', 'Mystère']);
  });

  it('à type égal, les comptes JOINTS passent après les persos', () => {
    const joint = (name: string, type: string) => ({ name, type, is_default: false, is_joint: true });
    const list = [joint('Compte commun', 'checking'), acc('Zébu', 'checking'), acc('Auto', 'checking')];
    expect(sortAccounts(list).map((a) => a.name)).toEqual(['Auto', 'Zébu', 'Compte commun']);
  });

  it('le type prime sur le caractère joint (un courant joint reste avant une épargne perso)', () => {
    const list = [acc('Livret A', 'savings'), { name: 'Commun', type: 'checking', is_default: false, is_joint: true }];
    expect(sortAccounts(list).map((a) => a.name)).toEqual(['Commun', 'Livret A']);
  });

  it('ne modifie pas le tableau d’origine', () => {
    const list = [acc('Livret A', 'savings'), acc('CCP', 'checking')];
    const before = list.map((a) => a.name);
    sortAccounts(list);
    expect(list.map((a) => a.name)).toEqual(before);
  });

  it('comparateur : deux comptes identiques en type et nom → 0 (tri stable)', () => {
    expect(compareAccounts(acc('CCP', 'checking'), acc('CCP', 'checking'))).toBe(0);
  });
});
