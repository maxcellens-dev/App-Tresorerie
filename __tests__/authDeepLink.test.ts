import { parseAuthLink, paramFrom } from '../lib/auth/authDeepLink';

/**
 * Ce lecteur décide de DEUX choses irréversibles pour l'utilisateur :
 *  • ouvrir (ou non) une session de récupération à partir d'un lien reçu par e-mail ;
 *  • reconnaître un lien mort AVANT d'afficher un formulaire qui ne pourra rien enregistrer.
 * Et il ne doit JAMAIS consommer le retour de connexion sociale, déjà traité ailleurs.
 */
describe('parseAuthLink', () => {
  it('lit le flux implicite (jetons dans le fragment)', () => {
    const link = parseAuthLink('relyka-app://reset-password#access_token=abc.def.ghi&refresh_token=r1&type=recovery');
    expect(link.kind).toBe('recovery');
    if (link.kind !== 'recovery') return;
    expect(link.accessToken).toBe('abc.def.ghi');
    expect(link.refreshToken).toBe('r1');
    expect(link.code).toBeNull();
  });

  it('lit le flux PKCE (code dans la requête)', () => {
    const link = parseAuthLink('relyka-app://reset-password?code=9f1c-abcd&type=recovery');
    expect(link.kind).toBe('recovery');
    if (link.kind !== 'recovery') return;
    expect(link.code).toBe('9f1c-abcd');
  });

  it('reconnaît un lien périmé au lieu d\'ouvrir un formulaire inutilisable', () => {
    const link = parseAuthLink(
      'relyka-app://reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    expect(link.kind).toBe('error');
    if (link.kind !== 'error') return;
    expect(link.expired).toBe(true);
    // `+` = espace dans un texte lisible : sans ça, le message s'affichait avec des plus partout.
    expect(link.message).toBe('Email link is invalid or has expired');
  });

  it('ne touche PAS au retour de connexion sociale (déjà consommé par le navigateur d\'auth)', () => {
    const link = parseAuthLink('relyka-app://auth-callback?code=9f1c-abcd');
    expect(link.kind).toBe('none');
  });

  it('ignore une ouverture ordinaire de l\'app', () => {
    expect(parseAuthLink('relyka-app://').kind).toBe('none');
    expect(parseAuthLink(null).kind).toBe('none');
    // Chemin de réinitialisation SANS jeton ni erreur : ce n'est pas un retour d'e-mail.
    expect(parseAuthLink('relyka-app://reset-password').kind).toBe('none');
  });

  it('fonctionne aussi sur une URL web (retour de lien sur le site)', () => {
    const link = parseAuthLink('https://relyka.app/reset-password#error_code=otp_expired&error_description=expired');
    expect(link.kind).toBe('error');
  });

  it('reconnaît le lien même sans `type` quand le chemin le dit (Expo Go)', () => {
    const link = parseAuthLink('exp://192.168.1.10:8081/--/reset-password#access_token=a&refresh_token=b');
    expect(link.kind).toBe('recovery');
  });
});

describe('paramFrom', () => {
  it('ne transforme PAS les « + » par défaut (un jeton serait abîmé)', () => {
    expect(paramFrom('t=a+b', 't')).toBe('a+b');
    expect(paramFrom('t=a+b', 't', true)).toBe('a b');
  });

  it('rend la valeur brute plutôt que de lever sur un échappement invalide', () => {
    expect(paramFrom('t=%E0%A4%A', 't')).toBe('%E0%A4%A');
  });
});
