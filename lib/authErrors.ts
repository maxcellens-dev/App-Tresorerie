/**
 * Traduction des échecs d'authentification Supabase en messages EXPLOITABLES.
 *
 * Pourquoi ce fichier existe : une inscription peut être ANNULÉE CÔTÉ SERVEUR après coup. Supabase
 * crée la ligne `auth.users`, tente d'envoyer l'e-mail de confirmation, et si l'envoi échoue
 * (quota SMTP, limite de débit sur l'adresse) ou si le déclencheur de profil lève, il ANNULE toute
 * la transaction : plus rien, ni dans `auth.users`, ni dans `profiles`. L'app, elle, ne recevait
 * qu'un message technique en anglais dans un dialogue — quand elle ne l'écrasait pas par un
 * « vérifie ton mail » optimiste. L'utilisateur repartait convaincu d'avoir un compte qui
 * n'existait nulle part, et attendait un e-mail qui ne partirait jamais.
 *
 * Règle : quand la création a échoué, le message doit le DIRE et proposer le geste suivant.
 * On s'appuie d'abord sur `code` (stable, fourni par gotrue), le texte ne servant que de repli.
 */

export interface AuthErrorInfo {
  /** Message affichable, en français, tutoyé. */
  message: string;
  /** Le compte n'a PAS été créé : l'utilisateur doit refaire une tentative. */
  notCreated?: boolean;
  /** L'adresse est déjà prise : proposer la connexion plutôt qu'une nouvelle inscription. */
  alreadyExists?: boolean;
  /** Échec temporaire (débit, réseau) : réessayer plus tard a du sens. */
  retryable?: boolean;
}

/** Secondes d'attente annoncées par gotrue (« after 47 seconds »), si présentes. */
function retryAfter(raw: string): number | null {
  const m = raw.match(/after (\d+) seconds?/i);
  return m ? Number(m[1]) : null;
}

export function describeAuthError(e: unknown): AuthErrorInfo {
  const err = e as { message?: string; code?: string; status?: number } | null;
  const raw = (err?.message ?? '').trim();
  const code = (err?.code ?? '').trim();
  const low = raw.toLowerCase();

  // ── L'adresse est déjà utilisée ────────────────────────────────────────────
  if (code === 'user_already_exists' || /already registered|already exists|user already/i.test(raw)) {
    return { message: 'Un compte existe déjà avec cette adresse.', alreadyExists: true };
  }

  // ── Débit d'envoi : rien n'a été créé, il faut patienter puis recommencer ──
  // C'est LE piège du parcours « je m'inscris, je réessaie, je supprime, je recrée » : à la 3ᵉ ou
  // 4ᵉ demande vers la même adresse, l'envoi est refusé et l'inscription annulée avec lui.
  if (code === 'over_email_send_rate_limit' || /email rate limit|for security purposes|only request this after/i.test(raw)) {
    const s = retryAfter(raw);
    return {
      message: s
        ? `Trop de demandes pour cette adresse. Ton compte n'a PAS été créé : attends ${s} secondes et recommence.`
        : "Trop d'e-mails demandés pour cette adresse ces dernières minutes. Ton compte n'a PAS été créé : attends quelques minutes et recommence.",
      notCreated: true, retryable: true,
    };
  }

  // ── L'e-mail de confirmation n'est pas parti → inscription annulée ─────────
  if (/error sending|failed to send|smtp/i.test(raw)) {
    return {
      message: "L'e-mail de confirmation n'a pas pu être envoyé, et ton compte n'a donc PAS été créé. Réessaie dans quelques minutes ; si ça se reproduit, préviens-nous.",
      notCreated: true, retryable: true,
    };
  }

  // ── Échec serveur à la création (déclencheur de profil, contrainte…) ───────
  if (code === 'unexpected_failure' || /database error/i.test(raw)) {
    return {
      message: "La création du compte a échoué côté serveur : rien n'a été enregistré. Réessaie, et préviens-nous si le problème persiste.",
      notCreated: true, retryable: true,
    };
  }

  // ── Saisie ────────────────────────────────────────────────────────────────
  if (code === 'email_address_invalid' || /invalid format|unable to validate email/i.test(raw)) {
    return { message: "Cette adresse e-mail n'est pas valide.", notCreated: true };
  }
  if (code === 'weak_password' || /password should be|weak password/i.test(raw)) {
    return { message: 'Mot de passe trop faible : rallonge-le et mélange lettres, chiffres et symboles.', notCreated: true };
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(raw)) {
    return { message: 'E-mail ou mot de passe incorrect.' };
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(raw)) {
    return { message: 'Ton adresse n’est pas encore confirmée. Ouvre le lien reçu par e-mail, puis reviens te connecter.' };
  }

  // ── Réseau ────────────────────────────────────────────────────────────────
  if (/failed to fetch|network|timeout/i.test(low)) {
    return { message: 'Connexion au serveur impossible. Vérifie ta connexion et réessaie.', notCreated: true, retryable: true };
  }

  return { message: raw || 'Une erreur est survenue.' };
}
