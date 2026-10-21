/**
 * Chaque bloc d'une réponse de Pépin est illustré par la partie de l'arbre dont il parle.
 */
import { reportTopic } from '../lib/ai/reportTopic';

describe('reportTopic', () => {
  it.each([
    ['Ton crédit immobilier', 'brambles'],
    ['Découvert autorisé', 'brambles'],
    ['Tes placements', 'fruits'],
    ['Épargne de précaution', 'roots'],
    ['Sécurité', 'roots'],
    ['Tes projets', 'setAside'],
    ['Abonnements à revoir', 'recurring'],
    ['Dépenses du mois', 'budget'],
    ['Trésorerie', 'water'],
    ['Le point de vigilance', 'warn'],
    ['Ce que je ferais à ta place', 'tip'],
  ])('%s → %s', (title, key) => {
    expect(reportTopic(title)).toBe(key);
  });

  it('le premier sujet reconnu gagne', () => {
    expect(reportTopic('Dépenses de crédit')).toBe('brambles');
  });

  it("rien de reconnu → l'ampoule", () => {
    expect(reportTopic('Synthèse')).toBe('tip');
    expect(reportTopic('')).toBe('tip');
  });
});
