import { monthlyIds } from '../lib/pulseEngine';
import type { PulseSignalId } from '../lib/pulseEngine';

/**
 * L'état des lieux mensuel se lit APRÈS la clôture, donc bien après la fin du mois concerné : il
 * doit s'ouvrir sur le récapitulatif de CE MOIS (dépenses variables, épargné, investi), avec le
 * matelas de sécurité à la place de « fin de mois » — qui n'a plus de sens une fois le mois fini —
 * puis « Ton projet », puis « Fin de mois ».
 */
const full: PulseSignalId[] = ['end_of_month', 'spending', 'cushion', 'saving', 'investing', 'no_overdraft', 'wealth', 'projects'];

describe('monthlyIds — ordre du bilan de fin de mois', () => {
  it('ouvre sur le récap du mois, matelas compris, et non sur « fin de mois »', () => {
    const ids = monthlyIds(full);
    expect(ids.slice(0, 4)).toEqual(['spending', 'cushion', 'saving', 'investing']);
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
    // Ce sont les deux repères du bilan mensuel : ils ne dépendent pas du profil choisi.
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
