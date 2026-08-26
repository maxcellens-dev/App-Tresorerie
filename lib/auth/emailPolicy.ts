/**
 * Ce qu'on accepte comme adresse e-mail, et ce qu'on en dit.
 *
 * Volontairement PERMISSIF sur la forme : la seule preuve qu'une adresse existe est le message
 * qu'on y envoie, et c'est exactement ce que fait le changement d'adresse (lien de confirmation).
 * Une expression trop stricte ne protège de rien et rejette des adresses parfaitement valides —
 * les sous-domaines, les nouvelles extensions, les signes `+` de tri. On écarte donc seulement ce
 * qui ne peut PAS être une adresse : pas d'arobase, pas de point après, des espaces au milieu.
 *
 * La limite de 254 caractères est celle de la norme (RFC 5321) : au-delà, aucun serveur n'accepte
 * de délivrer le message.
 */

export const EMAIL_MAX_LENGTH = 254;

/** Forme minimale : `quelquechose@domaine.ext`, sans espace ni arobase en trop. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface EmailCheck {
  valid: boolean;
  /** Message prêt à afficher quand `valid` est faux — jamais un jargon technique. */
  error?: string;
}

/** Nettoie une saisie : espaces autour, casse. Les adresses ne sont pas sensibles à la casse. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Valide une nouvelle adresse. `current` permet de refuser tout de suite celle qu'on utilise déjà —
 * sinon Supabase accepte la demande, envoie un lien, et il ne se passe rien : on attendrait un
 * changement qui n'a jamais eu lieu.
 */
export function checkNewEmail(raw: string, current?: string | null): EmailCheck {
  const email = normalizeEmail(raw);
  if (!email) return { valid: false, error: 'Saisis ta nouvelle adresse e-mail.' };
  if (email.length > EMAIL_MAX_LENGTH) return { valid: false, error: 'Cette adresse est trop longue.' };
  if (!EMAIL_RE.test(email)) return { valid: false, error: 'Cette adresse ne ressemble pas à une adresse e-mail.' };
  if (current && email === normalizeEmail(current)) {
    return { valid: false, error: 'C’est déjà ton adresse actuelle.' };
  }
  return { valid: true };
}

/**
 * Le compte peut-il changer d'adresse depuis l'application ?
 *
 * Un compte créé avec Google n'a pas de mot de passe chez nous, et son adresse VIENT de Google :
 * la remplacer ici ne changerait pas la façon dont la personne se connecte (toujours le bouton
 * Google, toujours l'adresse Google) — on la mettrait juste en désaccord avec elle-même. Tant que
 * le compte n'a pas d'identifiant e-mail/mot de passe, on ne propose donc pas le changement, et on
 * explique pourquoi plutôt que de laisser un bouton qui échoue.
 */
export function canChangeEmail(identities: { provider?: string }[] | null | undefined): boolean {
  if (!identities || identities.length === 0) return true; // information absente : on n'interdit pas
  return identities.some((i) => i.provider === 'email');
}
