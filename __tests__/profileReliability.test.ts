import {
  computeProfileReliability,
  monthsOfHistorySince,
  type ProfileReliabilityInputs,
} from '../lib/finance/profileReliability';

/**
 * FIABILITÉ DU PROFIL — une notion strictement INDÉPENDANTE du palier.
 *
 * Elle répond à « sur quoi ce classement repose-t-il ? », jamais à « quel est le palier ? ». Si elle
 * déplaçait un profil, on aurait deux moteurs de classement dont l'un serait caché.
 *
 * Elle n'a AUCUN effet mécanique : elle informe, elle ne pilote rien. Lui donner un effet, ce
 * serait recréer un second moteur de décision à côté du premier, invisible depuis l'échelle.
 */

/** Compte complet et installé : tout est là. */
const complet: ProfileReliabilityInputs = {
  avgMonthlyIncome: 2500,
  incomeSource: 'explicit',
  hasSavingsAccount: true,
  hasRecurringExpenses: true,
  cushionBase: 'expenses',
  variableEnvelopeSource: 'history',
  monthsOfHistory: 8,
  daysSinceVerification: 3,
};

describe('trois niveaux, et jamais un badge nu', () => {
  it('tout est là → fiable, aucun manque à signaler', () => {
    const r = computeProfileReliability(complet);
    expect(r.level).toBe('reliable');
    expect(r.tone).toBe('good');
    expect(r.gaps).toHaveLength(0);
  });

  it('une donnée STRUCTURANTE manque → incomplet', () => {
    expect(computeProfileReliability({ ...complet, hasSavingsAccount: false }).level).toBe('incomplete');
    expect(computeProfileReliability({ ...complet, hasRecurringExpenses: false }).level).toBe('incomplete');
    expect(computeProfileReliability({ ...complet, avgMonthlyIncome: 0 }).level).toBe('incomplete');
  });

  it('rien ne manque, mais quelque chose est deviné ou récent → estimé', () => {
    expect(computeProfileReliability({ ...complet, monthsOfHistory: 0 }).level).toBe('estimated');
    expect(computeProfileReliability({ ...complet, incomeSource: 'inferred' }).level).toBe('estimated');
    expect(computeProfileReliability({ ...complet, variableEnvelopeSource: 'onboarding' }).level).toBe('estimated');
    expect(computeProfileReliability({ ...complet, daysSinceVerification: 120 }).level).toBe('estimated');
  });

  /* La règle d'écriture : chaque manque porte le GESTE qui le lève. « Profil estimé » tout seul est
     une inquiétude sans issue ; « ajoute tes charges récurrentes » est une action. */
  it('chaque manque porte un libellé ET une action', () => {
    const r = computeProfileReliability({
      ...complet, hasSavingsAccount: false, hasRecurringExpenses: false, monthsOfHistory: 0,
    });
    expect(r.gaps.length).toBeGreaterThan(0);
    for (const g of r.gaps) {
      expect(g.label.trim()).not.toBe('');
      expect(g.action.trim()).not.toBe('');
    }
  });

  it('le résumé NOMME le manque quand il n’y en a qu’un', () => {
    const r = computeProfileReliability({ ...complet, hasSavingsAccount: false });
    expect(r.summary).toContain('compte d’épargne');
  });

  /* Le matelas mesuré sur le revenu est un REPLI prudent, pas une erreur : il se signale, il ne
     disqualifie pas. Et il ne se signale que si les charges existent — sinon le manque de charges
     est déjà remonté comme cause bloquante, et le dire deux fois serait du bruit. */
  it('le repli sur le revenu se signale sans rendre le profil incomplet', () => {
    const r = computeProfileReliability({ ...complet, cushionBase: 'income' });
    expect(r.level).toBe('estimated');
    expect(r.gaps.some((g) => g.id === 'cushion_on_income')).toBe(true);

    const sansCharges = computeProfileReliability({
      ...complet, hasRecurringExpenses: false, cushionBase: 'income',
    });
    expect(sansCharges.gaps.filter((g) => g.id === 'cushion_on_income')).toHaveLength(0);
  });
});

describe('monthsOfHistorySince — le mois d’arrivée ne compte pas', () => {
  const at = (y: number, m: number) => new Date(y, m - 1, 15);

  it('le mois d’inscription, forcément partiel, ne compte pas', () => {
    expect(monthsOfHistorySince('2026-08-03', at(2026, 8))).toBe(0);
    expect(monthsOfHistorySince('2026-07-28', at(2026, 8))).toBe(0);
  });

  it('compte les mois entièrement vécus', () => {
    expect(monthsOfHistorySince('2026-05-01', at(2026, 8))).toBe(2);
    expect(monthsOfHistorySince('2025-08-01', at(2026, 8))).toBe(11);
  });

  it('date absente ou illisible → aucun historique supposé', () => {
    expect(monthsOfHistorySince(null)).toBe(0);
    expect(monthsOfHistorySince('pas une date')).toBe(0);
  });
});
