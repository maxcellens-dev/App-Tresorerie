import { describeAuthError, isUnreachableServerError } from '../lib/auth/authErrors';

/**
 * Le point critique : tout échec qui laisse l'utilisateur SANS COMPTE doit être signalé comme tel
 * (`notCreated`). C'est ce silence qui a produit des comptes introuvables — l'app annonçait
 * « vérifie ton mail » alors que le serveur avait tout annulé.
 */
describe('describeAuthError', () => {
  it('signale que le compte n\'a pas été créé quand le débit d\'envoi est dépassé', () => {
    const info = describeAuthError({ code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 47 seconds.' });
    expect(info.notCreated).toBe(true);
    expect(info.retryable).toBe(true);
    expect(info.message).toContain('47');
    expect(info.message).toContain("n'a PAS été créé");
  });

  it('signale que le compte n\'a pas été créé quand l\'e-mail de confirmation ne part pas', () => {
    const info = describeAuthError({ message: 'Error sending confirmation email' });
    expect(info.notCreated).toBe(true);
    expect(info.message).toContain("n'a donc PAS été créé");
  });

  it('signale un échec serveur à la création (déclencheur de profil)', () => {
    const info = describeAuthError({ code: 'unexpected_failure', message: 'Database error saving new user' });
    expect(info.notCreated).toBe(true);
    expect(info.message).toContain("rien n'a été enregistré");
  });

  it('reconnaît une adresse déjà inscrite et ne la présente pas comme un échec de création', () => {
    const info = describeAuthError({ code: 'user_already_exists', message: 'User already registered' });
    expect(info.alreadyExists).toBe(true);
    expect(info.notCreated).toBeUndefined();
  });

  it('traduit les erreurs de connexion courantes', () => {
    expect(describeAuthError({ message: 'Invalid login credentials' }).message).toBe('E-mail ou mot de passe incorrect.');
    expect(describeAuthError({ message: 'Email not confirmed' }).message).toContain('pas encore confirmée');
  });

  it('retombe sur le message brut plutôt que d\'inventer', () => {
    expect(describeAuthError({ message: 'Quelque chose de neuf' }).message).toBe('Quelque chose de neuf');
    expect(describeAuthError(null).message).toBe('Une erreur est survenue.');
  });

  /* Les trois cas ci-dessous sortaient EN ANGLAIS sur les écrans de réinitialisation et de
     changement de mot de passe, qui n'appelaient pas ce traducteur du tout. */
  it('traduit « nouveau mot de passe identique à l\'ancien »', () => {
    const info = describeAuthError({ code: 'same_password', message: 'New password should be different from the old password.' });
    expect(info.message).toContain('identique à l’ancien');
    expect(info.recoveryExpired).toBeUndefined();
  });

  it('reconnaît un lien de réinitialisation périmé et le signale à l\'écran', () => {
    const missing = describeAuthError({ message: 'Auth session missing!', status: 400 });
    expect(missing.recoveryExpired).toBe(true);
    expect(missing.message).toContain('expiré');

    const expired = describeAuthError({ message: 'JWT expired', status: 401 });
    expect(expired.recoveryExpired).toBe(true);
  });

  it('annonce l\'attente sur une limite de tentatives (hors envoi d\'e-mail)', () => {
    const info = describeAuthError({ code: 'over_request_rate_limit', message: 'Request rate limit reached, retry after 30 seconds' });
    expect(info.retryable).toBe(true);
    expect(info.message).toContain('30');
  });

  it('ne confond pas un mot de passe erroné avec une session périmée', () => {
    // `invalid_credentials` arrive AVANT le test de statut : sans cette priorité, une connexion
    // ratée aurait annoncé « ton lien de réinitialisation a expiré ».
    const info = describeAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 });
    expect(info.message).toBe('E-mail ou mot de passe incorrect.');
    expect(info.recoveryExpired).toBeUndefined();
  });
});

/**
 * Ce prédicat décide si l'app DÉCONNECTE l'utilisateur. Se tromper dans un sens le jette dehors
 * chaque fois que le réseau tousse ; se tromper dans l'autre le laisse tourner avec un jeton mort,
 * devant des écrans vides. Les deux directions sont donc testées.
 */
describe('isUnreachableServerError', () => {
  it('considère les pannes de transport comme « injoignable » → on NE déconnecte PAS', () => {
    expect(isUnreachableServerError({ name: 'AuthRetryableFetchError', status: 0 })).toBe(true);
    expect(isUnreachableServerError({ message: 'Failed to fetch' })).toBe(true);
    expect(isUnreachableServerError({ message: 'Network request failed' })).toBe(true);
    expect(isUnreachableServerError({ status: 503, message: 'Service unavailable' })).toBe(true);
    expect(isUnreachableServerError({ status: 0 })).toBe(true);
  });

  it('sur un DOUTE (erreur absente ou illisible), ne déconnecte pas non plus', () => {
    expect(isUnreachableServerError(null)).toBe(true);
    expect(isUnreachableServerError(undefined)).toBe(true);
    expect(isUnreachableServerError({})).toBe(true);
  });

  it('reconnaît un REFUS du serveur → là, on déconnecte pour de bon', () => {
    // Jeton révoqué / compte supprimé / mot de passe changé ailleurs.
    expect(isUnreachableServerError({ status: 400, message: 'Invalid Refresh Token: Refresh Token Not Found' })).toBe(false);
    expect(isUnreachableServerError({ status: 401, message: 'invalid claim: missing sub claim' })).toBe(false);
    expect(isUnreachableServerError({ status: 403, message: 'User from sub claim in JWT does not exist' })).toBe(false);
  });
});
