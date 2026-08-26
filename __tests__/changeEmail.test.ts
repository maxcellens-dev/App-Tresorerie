/**
 * CHANGEMENT D'ADRESSE E-MAIL — les règles, sans l'écran.
 *
 * L'adresse est l'identifiant de connexion : la changer engage tout le compte (récupération de mot
 * de passe comprise). Les décisions testées ici sont donc celles qui protègent contre un changement
 * fait par erreur — ou par quelqu'un d'autre.
 */
import { checkNewEmail, normalizeEmail, canChangeEmail, EMAIL_MAX_LENGTH } from '../lib/auth/emailPolicy';
import { parseAuthLink } from '../lib/auth/authDeepLink';

describe('adresse acceptée', () => {
  it('accepte les adresses réelles, y compris celles que les règles trop strictes rejettent', () => {
    for (const ok of [
      'jean@exemple.fr',
      'jean.dupont+banque@sous.domaine.exemple.com',
      'j@a.io',
      "prenom-nom_2@mon-domaine.travel",
    ]) {
      expect(checkNewEmail(ok).valid).toBe(true);
    }
  });

  it('refuse ce qui ne peut pas être une adresse', () => {
    for (const bad of ['', '   ', 'jean', 'jean@', '@exemple.fr', 'jean@exemple', 'jean @exemple.fr', 'a@b.c']) {
      expect(checkNewEmail(bad).valid).toBe(false);
    }
  });

  it('donne une raison lisible, jamais un code technique', () => {
    expect(checkNewEmail('jean').error).toMatch(/adresse e-mail/i);
    expect(checkNewEmail('').error).toMatch(/Saisis/i);
  });

  /* Sans ce test, Supabase accepte la demande et envoie un lien qui ne changera rien : on
     attendrait un changement qui n'a jamais eu lieu. */
  it('refuse l’adresse déjà utilisée par le compte, quelle qu’en soit la casse', () => {
    expect(checkNewEmail('Moi@Exemple.fr', 'moi@exemple.fr').valid).toBe(false);
    expect(checkNewEmail('  MOI@EXEMPLE.FR  ', 'moi@exemple.fr').error).toMatch(/déjà ton adresse/i);
    expect(checkNewEmail('autre@exemple.fr', 'moi@exemple.fr').valid).toBe(true);
  });

  it('refuse au-delà de la longueur qu’un serveur accepte de délivrer', () => {
    const trop = 'a'.repeat(EMAIL_MAX_LENGTH) + '@exemple.fr';
    expect(checkNewEmail(trop).valid).toBe(false);
  });

  it('normalise la saisie (espaces, majuscules)', () => {
    expect(normalizeEmail('  Jean.Dupont@Exemple.FR ')).toBe('jean.dupont@exemple.fr');
  });
});

describe('qui a le droit de changer d’adresse', () => {
  it('un compte e-mail / mot de passe : oui', () => {
    expect(canChangeEmail([{ provider: 'email' }])).toBe(true);
  });

  /* Un compte Google n'a pas de mot de passe chez nous et son adresse vient de Google : la
     remplacer ici ne changerait pas la façon de se connecter, seulement la cohérence du compte. */
  it('un compte Google seul : non', () => {
    expect(canChangeEmail([{ provider: 'google' }])).toBe(false);
  });

  it('un compte Google AVEC mot de passe : oui', () => {
    expect(canChangeEmail([{ provider: 'google' }, { provider: 'email' }])).toBe(true);
  });

  it('information absente : on n’interdit pas (l’écran resterait sans explication)', () => {
    expect(canChangeEmail(undefined)).toBe(true);
    expect(canChangeEmail([])).toBe(true);
  });
});

describe('lien de confirmation reçu par e-mail', () => {
  /* CE CAS N'ÉTAIT PAS RECONNU : le lien rendait « rien à faire », l'app s'ouvrait sur le tableau
     de bord et personne ne savait si le changement avait pris. */
  it('reconnaît une confirmation de changement d’adresse', () => {
    const link = parseAuthLink('relyka-app://profile?type=email_change&code=abc123');
    expect(link.kind).toBe('email_change');
  });

  /* Et il ne doit SURTOUT pas passer pour une réinitialisation : l'écran « Nouveau mot de passe »
     n'a rien à voir avec ce qu'on venait de demander. */
  it('ne le confond pas avec une réinitialisation, même sur l’URL de reset', () => {
    const link = parseAuthLink('relyka-app://reset-password?type=email_change&code=abc123');
    expect(link.kind).toBe('email_change');
  });

  it('laisse la réinitialisation se comporter comme avant', () => {
    expect(parseAuthLink('relyka-app://reset-password?type=recovery&code=x').kind).toBe('recovery');
    expect(parseAuthLink('relyka-app://reset-password?code=x').kind).toBe('recovery');
    expect(parseAuthLink('relyka-app://pilotage').kind).toBe('none');
  });

  it('dit qu’un lien de confirmation est périmé, dans les mots du bon flux', () => {
    const link = parseAuthLink('relyka-app://profile?type=email_change&error_code=otp_expired');
    expect(link.kind).toBe('error');
    if (link.kind === 'error') {
      expect(link.expired).toBe(true);
      expect(link.message).toMatch(/confirmation/i);
    }
  });
});
