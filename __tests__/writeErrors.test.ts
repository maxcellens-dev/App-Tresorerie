/**
 * Backstop des échecs d'écriture — plus aucune mutation ne doit échouer en silence.
 *
 * Le seul gestionnaire global ne traitait que les limites d'usage. Tout le reste — réseau coupé,
 * refus RLS, session expirée — était avalé dès que l'appelant faisait un simple `.mutate()` : la
 * modale se refermait, et l'utilisateur repartait convaincu que son montant était enregistré.
 */
import { describeWriteError, reportUnhandledWriteError } from '../lib/ui/writeErrors';

const mutation = (meta?: Record<string, unknown>) => ({ meta } as any);

describe('describeWriteError — un message pour un humain', () => {
  it('traduit une coupure réseau', () => {
    expect(describeWriteError(new Error('Network request failed'))).toMatch(/connexion/i);
    expect(describeWriteError(new Error('TypeError: Failed to fetch'))).toMatch(/connexion/i);
  });

  it('traduit une session expirée', () => {
    expect(describeWriteError(new Error('JWT expired'))).toMatch(/session a expiré/i);
    expect(describeWriteError(new Error('Non connecté'))).toMatch(/session a expiré/i);
  });

  it('traduit un refus de la base', () => {
    expect(describeWriteError(new Error('new row violates row-level security policy')))
      .toMatch(/n'est pas autorisée/i);
  });

  it('garde un message métier déjà rédigé par l\'app', () => {
    const metier = 'Un compte actif s\'appelle déjà « Livret A ». Renomme-le avant de rouvrir celui-ci.';
    expect(describeWriteError(new Error(metier))).toBe(metier);
  });

  it('ne laisse jamais fuiter un charabia technique', () => {
    const out = describeWriteError(new Error('duplicate key value violates unique constraint "idx_42"'));
    expect(out).toMatch(/n’a pas pu être enregistré/i);
  });

  it('couvre l\'absence d\'erreur exploitable', () => {
    expect(describeWriteError(undefined)).toMatch(/connexion/i);
    expect(describeWriteError(null)).toMatch(/connexion/i);
  });
});

describe('reportUnhandledWriteError — quand le filet se déclenche', () => {
  it('signale une erreur ordinaire', () => {
    const show = jest.fn();
    reportUnhandledWriteError(new Error('Network request failed'), false, mutation(), show);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0]).toBe('Changement non enregistré');
  });

  /* Une limite d'usage a déjà SON message (page Plan, « supprime des éléments ») : le doubler
     n'apprendrait rien et remplacerait un message précis par un message générique. */
  it('se tait quand la limite d\'usage a déjà parlé', () => {
    const show = jest.fn();
    reportUnhandledWriteError(new Error('USAGE_LIMIT_ACCOUNTS'), true, mutation(), show);
    expect(show).not.toHaveBeenCalled();
  });

  it('se tait sur une mutation qui a demandé le silence', () => {
    const show = jest.fn();
    reportUnhandledWriteError(new Error('boom'), false, mutation({ silentError: true }), show);
    expect(show).not.toHaveBeenCalled();
  });

  it('parle quand `meta` existe sans demander le silence', () => {
    const show = jest.fn();
    reportUnhandledWriteError(new Error('boom'), false, mutation({ autre: 1 }), show);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('parle quand la mutation est inconnue', () => {
    const show = jest.fn();
    reportUnhandledWriteError(new Error('boom'), false, undefined, show);
    expect(show).toHaveBeenCalledTimes(1);
  });
});
