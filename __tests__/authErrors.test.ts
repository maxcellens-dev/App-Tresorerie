import { describeAuthError } from '../lib/auth/authErrors';

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
});
