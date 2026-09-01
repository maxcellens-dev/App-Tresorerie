/**
 * Le périmètre des statistiques admin : ce qui est exclu, et surtout ce qui NE DOIT PAS l'être.
 *
 * Le piège que ces tests verrouillent : `NULL NOT IN (…)` ne vaut pas « vrai » en SQL, il vaut NULL.
 * Un filtre naïf ferait donc disparaître les lignes anonymes (crash sur l'écran de connexion,
 * évènement sans profil) — des données qui ne sont à personne, donc à aucun administrateur.
 */
import { adminExclusionFilter, withoutAdmins, withoutAdminRows } from '../lib/admin/statsScope';

const A1 = '11111111-1111-1111-1111-111111111111';
const A2 = '22222222-2222-2222-2222-222222222222';
const USER = '99999999-9999-9999-9999-999999999999';

describe('adminExclusionFilter', () => {
  it('garde explicitement les lignes sans identifiant', () => {
    expect(adminExclusionFilter([A1, A2])).toBe(
      `profile_id.is.null,profile_id.not.in.(${A1},${A2})`,
    );
  });
  it('accepte une autre colonne d’identité', () => {
    expect(adminExclusionFilter([A1], 'user_id')).toBe(`user_id.is.null,user_id.not.in.(${A1})`);
  });
});

describe('withoutAdmins', () => {
  const fakeQuery = () => {
    const calls: string[] = [];
    const q = { calls, or: (f: string) => { calls.push(f); return q; } };
    return q;
  };

  it('applique le filtre quand il y a des admins', () => {
    const q = fakeQuery();
    withoutAdmins(q, [A1]);
    expect(q.calls).toEqual([`profile_id.is.null,profile_id.not.in.(${A1})`]);
  });

  it('ne touche PAS à la requête si la liste est vide (PostgREST refuse un `in.()` vide)', () => {
    const q = fakeQuery();
    expect(withoutAdmins(q, [])).toBe(q);
    expect(q.calls).toEqual([]);
  });
});

describe('withoutAdminRows', () => {
  const rows = [
    { profile_id: A1, n: 1 },
    { profile_id: USER, n: 2 },
    { profile_id: null, n: 3 },
  ];

  it('retire les admins et conserve l’anonyme', () => {
    expect(withoutAdminRows(rows, [A1, A2]).map((r) => r.n)).toEqual([2, 3]);
  });

  it('liste vide = aucune exclusion', () => {
    expect(withoutAdminRows(rows, []).map((r) => r.n)).toEqual([1, 2, 3]);
  });

  it('sait viser une autre colonne (user_id : dans user_financial_profile, profile_id est le PALIER)', () => {
    const ladder = [
      { user_id: A1, profile_id: 'P3' },
      { user_id: USER, profile_id: 'P3' },
    ];
    expect(withoutAdminRows(ladder, [A1], 'user_id')).toEqual([{ user_id: USER, profile_id: 'P3' }]);
  });
});
