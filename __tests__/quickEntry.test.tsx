import { pressKey, keypadNumber } from '../components/transaction/AmountKeypad';
import { rankCategories } from '../components/transaction/QuickEntry';
import { RECURRING_PRESETS, presetCategory } from '../lib/finance/recurringPresets';

const cat = (id: string, name: string, type: 'expense' | 'income' = 'expense', parent_id: string | null = 'p') =>
  ({ id, name, type, parent_id, profile_id: 'u', created_at: '' }) as any;

describe('pavé numérique', () => {
  const type = (keys: string[]) => keys.reduce(pressKey, '');
  it('tape un montant avec deux décimales au plus', () => {
    expect(type(['1', '2', ',', '5', '0', '9'])).toBe('12,50');
    expect(keypadNumber('12,50')).toBe(12.5);
  });
  it('pas de zéro en tête, une seule virgule, effacer', () => {
    expect(type(['0', '7'])).toBe('7');
    expect(type([',', '5', ','])).toBe('0,5');
    expect(type(['4', '2', 'back'])).toBe('4');
    expect(keypadNumber('')).toBe(0);
  });
});

describe('catégories de la saisie rapide', () => {
  const children = [cat('a', 'Courses'), cat('b', 'Restaurants'), cat('c', 'Loisirs'), cat('r', 'Régularisation Solde')];
  it('les plus utilisées d’abord, dans le bon sens d’argent, sans la régularisation', () => {
    const txs = [
      { category_id: 'c', amount: -10, date: '2026-10-01' },
      { category_id: 'c', amount: -10, date: '2026-10-02' },
      { category_id: 'b', amount: -10, date: '2026-10-03' },
      { category_id: 'a', amount: 50, date: '2026-10-03' }, // remboursement : ne compte pas en dépense
      { category_id: 'a', amount: -5, date: '2025-01-01' }, // trop ancien
    ];
    expect(rankCategories(children, txs, 'expense', '2026-07-01').map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('récurrentes en tuiles', () => {
  const rent = RECURRING_PRESETS.find((p) => p.key === 'rent')!;
  it('vise la sous-catégorie de base, sinon un mot-clé, sinon « autres »', () => {
    expect(presetCategory(rent, [cat('x', 'Divers'), cat('l', 'Loyer')])?.id).toBe('l');
    expect(presetCategory(rent, [cat('x', 'Divers'), cat('l', 'Mon loyer appart')])?.id).toBe('l');
    expect(presetCategory(rent, [cat('z', 'Courses'), cat('o', 'Autres charges')])?.id).toBe('o');
    expect(presetCategory(rent, [cat('s', 'Salaire', 'income')])).toBeNull();
  });
  it('les tuiles « Autre » ne choisissent pas de catégorie ; le rythme habituel est porté par la tuile', () => {
    expect(presetCategory(RECURRING_PRESETS.find((p) => p.key === 'other_expense')!, [cat('o', 'Autres charges')])).toBeNull();
    expect(RECURRING_PRESETS.find((p) => p.key === 'home_ins')!.recurrence).toBe('yearly');
    expect(rent.recurrence).toBe('monthly');
  });
});

describe('bocal des projets', () => {
  const { jarCoins } = require('../components/project/ProjectJar');
  it('se remplit de pièces avec l’avancement, vide à 0 %', () => {
    expect(jarCoins(0)).toHaveLength(0);
    const half = jarCoins(50).length, full = jarCoins(100).length;
    expect(half).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(half);
  });
});
