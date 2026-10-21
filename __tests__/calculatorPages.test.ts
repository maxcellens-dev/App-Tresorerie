/**
 * Pages de la calculatrice : le choix enregistré est ramené aux pages d'aujourd'hui, sans perdre
 * ce que l'utilisateur avait coché sur une page renommée.
 */
import { resolveCalculatorPages, DEFAULT_CALCULATOR_PAGES, CALCULATOR_PAGES } from '../lib/ui/calculatorPages';

describe('resolveCalculatorPages', () => {
  it('rien d’enregistré → le défaut', () => {
    expect(resolveCalculatorPages(undefined)).toEqual(DEFAULT_CALCULATOR_PAGES);
  });

  it('une liste vide reste vide (choix explicite : nulle part)', () => {
    expect(resolveCalculatorPages([])).toEqual([]);
  });

  it('les anciens identifiants suivent leur page, les pages retirées disparaissent', () => {
    expect(resolveCalculatorPages(['transactions', 'conseils-ia', 'projection', 'reporting', 'inconnue'])).toEqual(['transactions', 'pepin']);
  });

  it('pas de doublon', () => {
    expect(resolveCalculatorPages(['pepin', 'conseils-ia'])).toEqual(['pepin']);
  });

  it('toutes les pages demandées sont proposées', () => {
    expect(CALCULATOR_PAGES.map((p) => p.id)).toEqual(expect.arrayContaining(['jardin', 'argent', 'comptes', 'projets', 'pepin', 'tresorerie', 'budgets', 'placements']));
  });
});
