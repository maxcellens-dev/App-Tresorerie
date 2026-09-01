import { monthlyIds } from '../lib/pulse/pulseEngine';
import type { PulseSignalId } from '../lib/pulse/pulseEngine';

/**
 * L'état des lieux se lit APRÈS la clôture, donc bien après la fin du mois concerné : il doit
 * s'ouvrir sur les deux repères du mois (dépenses variables, matelas de sécurité — les lignes de
 * la carte de récapitulatif), puis « Ton projet », puis « Fin de mois », puis le reste du profil.
 */
const full: PulseSignalId[] = ['end_of_month', 'spending', 'cushion', 'wealth', 'projects'];

describe('monthlyIds — ordre du bilan de fin de mois', () => {
  it('ouvre sur les deux repères du mois, et non sur « fin de mois »', () => {
    const ids = monthlyIds(full);
    expect(ids.slice(0, 2)).toEqual(['spending', 'cushion']);
    expect(ids.indexOf('end_of_month')).toBeGreaterThan(ids.indexOf('cushion'));
  });

  it('« Ton projet » passe avant « Fin de mois »', () => {
    const ids = monthlyIds(full);
    expect(ids.indexOf('projects')).toBeLessThan(ids.indexOf('end_of_month'));
  });

  it('aucun projet dans le profil → aucune carte projet (on n’en invente pas)', () => {
    const ids = monthlyIds(full.filter((id) => id !== 'projects'));
    expect(ids).not.toContain('projects');
  });

  it('le matelas et les dépenses sont là même s’ils ne sont pas dans le profil', () => {
    // Ce sont les deux repères du bilan : ils ne dépendent pas du profil choisi.
    const ids = monthlyIds(['end_of_month', 'wealth']);
    expect(ids).toContain('spending');
    expect(ids).toContain('cushion');
  });

  it('ne perd aucun signal du profil et n’en duplique aucun', () => {
    const ids = monthlyIds(full);
    for (const id of full) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
