/**
 * LE MATELAS DE SÉCURITÉ — la mesure la plus structurante de l'app, et elle n'avait aucun test.
 *
 * Elle décide du profil financier, des recommandations, du bilan mensuel et de la moitié des
 * messages. Sa définition a changé en cours de route (mois de REVENUS → mois de DÉPENSES
 * essentielles), et c'est ce changement, propagé à moitié, qui a fait dire à deux écrans « 7 mois »
 * et « 4 mois » pour la même personne.
 *
 * Ce qui compte ici n'est pas la division — c'est l'ORDRE DES REPLIS et ce qu'on affiche quand on
 * n'a rien : un matelas faussement rassurant est bien plus grave qu'un matelas absent.
 */
import {
  computeSecurityCushion,
  securityBaseLabel,
  securityMonthsLabel,
} from '../lib/finance/securityCushion';

describe('computeSecurityCushion — l’ordre des bases', () => {
  it('mesure sur les DÉPENSES essentielles dès qu’on les connaît, même si le revenu est connu', () => {
    const c = computeSecurityCushion({
      availableSavings: 6000, monthlyEssentialExpenses: 1500, avgMonthlyIncome: 3000,
    });
    expect(c.base).toBe('expenses');
    expect(c.months).toBe(4);      // 6000 / 1500 — et surtout PAS 2 (6000 / 3000)
    expect(c.reference).toBe(1500);
  });

  /* Sur un compte neuf, aucune charge récurrente n'est saisie : mesurer sur des dépenses nulles
     donnerait un matelas INFINI. Le revenu, lui, est toujours ≥ aux dépenses de quelqu'un qui n'est
     pas en déficit — ce repli sous-estime donc le matelas, et ne peut pas faire croire à une
     sécurité qui n'existe pas. C'est le bon sens de l'erreur. */
  it('sans dépenses connues, retombe sur le revenu — jamais sur un matelas infini', () => {
    const c = computeSecurityCushion({ availableSavings: 6000, avgMonthlyIncome: 3000 });
    expect(c.base).toBe('income');
    expect(c.months).toBe(2);
    expect(Number.isFinite(c.months!)).toBe(true);
  });

  it('des dépenses à zéro ou négatives ne sont pas une base', () => {
    expect(computeSecurityCushion({ availableSavings: 6000, monthlyEssentialExpenses: 0, avgMonthlyIncome: 3000 }).base).toBe('income');
    expect(computeSecurityCushion({ availableSavings: 6000, monthlyEssentialExpenses: -50, avgMonthlyIncome: 3000 }).base).toBe('income');
  });

  /* Le repli sur la tranche de revenu DÉCLARÉE (questionnaire d'accueil) a été retiré : ce
     questionnaire n'existe plus, et il ne s'activait que quand aucun revenu n'est constaté —
     c'est-à-dire précisément le cas où le classement, lui, refuse de conclure. */
  it('sans revenu constaté, on ne conclut plus rien', () => {
    const c = computeSecurityCushion({ availableSavings: 4000, avgMonthlyIncome: 0 });
    expect(c.months).toBeNull();
    expect(c.base).toBeNull();
  });

  /* `null` et non `0` : zéro mois est une AFFIRMATION (« tu ne tiens pas un jour »), alors qu'on ne
     sait simplement rien. Les écrans doivent pouvoir ne rien afficher plutôt que d'accuser. */
  it('aucune base exploitable → months null, pas zéro', () => {
    const c = computeSecurityCushion({ availableSavings: 6000, avgMonthlyIncome: 0 });
    expect(c.months).toBeNull();
    expect(c.base).toBeNull();
  });

  it('une épargne négative (compte à découvert) ne creuse pas le matelas', () => {
    const c = computeSecurityCushion({ availableSavings: -800, monthlyEssentialExpenses: 1000, avgMonthlyIncome: 2000 });
    expect(c.months).toBe(0);
  });
});

describe('libellés — on dit toujours ce qu’on divise', () => {
  it('chaque base a une phrase de provenance, et l’absence de base n’en a aucune', () => {
    expect(securityBaseLabel('expenses')).toContain('dépenses');
    expect(securityBaseLabel('income')).toContain('revenu');
    expect(securityBaseLabel(null)).toBe('');
  });

  it('formate sans virgule inutile ni précision trompeuse', () => {
    expect(securityMonthsLabel(0.4)).toBe('moins d’1 mois');
    expect(securityMonthsLabel(2)).toBe('2 mois');
    expect(securityMonthsLabel(2.35)).toBe('2,4 mois');
    // Au-delà de dix mois, la décimale n'apporte rien : on arrondit.
    expect(securityMonthsLabel(14.6)).toBe('15 mois');
  });
});
