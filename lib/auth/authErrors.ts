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
  /** La session de réinitialisation est absente ou périmée : il faut redemander un lien. */
  recoveryExpired?: boolean;
}

/** Secondes d'attente annoncées par gotrue (« after 47 seconds »), si présentes. */
function retryAfter(raw: string): number | null {
  const m = raw.match(/after (\d+) seconds?/i);
  return m ? Number(m[1]) : null;
}

/**
 * « Le serveur a-t-il VRAIMENT refusé, ou n'a-t-on simplement pas pu le joindre ? »
 *
 * Distinction vitale pour la survie d'une session (cf. contexts/AuthContext) : une coupure réseau ne
 * doit JAMAIS déconnecter — l'app reste utilisable sur son cache — alors qu'un refus explicite
 * (compte supprimé, jeton révoqué, mot de passe changé ailleurs) doit l'être, sans quoi l'app tourne
 * avec un jeton mort et n'affiche plus que des écrans vides.
 *
 * ⚠️ LA RÈGLE EST ASYMÉTRIQUE, ET C'EST VOULU. On ne conclut « le serveur a refusé » que sur une
 * PREUVE POSITIVE : un statut 4xx renvoyé par lui. Tout le reste — pas de statut, statut 0, 5xx,
 * erreur illisible, objet vide — est un DOUTE, et un doute ne déconnecte pas. L'asymétrie n'est pas
 * de la prudence gratuite : un utilisateur déconnecté à tort a perdu l'accès à ses données et ne
 * peut rien y faire, alors qu'une session morte laissée en place se répare au prochain démarrage.
 * (Première version : « pas de statut → on lit le message ». Un objet d'erreur vide passait alors
 * pour un refus du serveur et déconnectait.)
 *
 * Deux 4xx font exception, parce qu'ils ne disent RIEN de la validité de la session :
 *   • 408 Request Timeout  → la requête n'est pas arrivée ;
 *   • 429 Too Many Requests → trop de rafraîchissements, à retenter plus tard.
 */
export function isUnreachableServerError(e: unknown): boolean {
  const err = e as { name?: string; status?: number } | null;
  if (!err) return true;
  if (err.name === 'AuthRetryableFetchError') return true;
  if (typeof err.status !== 'number') return true;
  if (err.status === 408 || err.status === 429) return true;
  return !(err.status >= 400 && err.status < 500);
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
  /* ⚠️ AVANT `weak_password`. Le message de gotrue pour un mot de passe réutilisé est « New password
     should be DIFFERENT from the old password » : il contient « password should be », donc la règle
     « trop faible » ci-dessous l'avalait et répondait « rallonge-le et mélange lettres, chiffres et
     symboles » à quelqu'un dont le mot de passe cochait déjà toutes les cases. Conseil impossible à
     suivre, sur un écran dont on ne peut pas sortir sans réussir. */
  if (code === 'same_password' || /different from the old password/i.test(raw)) {
    return { message: 'Ce mot de passe est identique à l’ancien. Choisis-en un autre.' };
  }
  if (code === 'weak_password' || /password should be at least|weak password/i.test(raw)) {
    return { message: 'Mot de passe trop faible : rallonge-le et mélange lettres, chiffres et symboles.', notCreated: true };
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(raw)) {
    return { message: 'E-mail ou mot de passe incorrect.' };
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(raw)) {
    return { message: 'Ton adresse n’est pas encore confirmée. Ouvre le lien reçu par e-mail, puis reviens te connecter.' };
  }

  // ── Session absente / périmée ─────────────────────────────────────────────
  // Cas typique : le lien de réinitialisation a plus d'une heure, ou il a déjà servi. L'écran doit
  // proposer d'en redemander un, pas afficher « Auth session missing! ».
  if (
    code === 'session_not_found' || code === 'refresh_token_not_found' || err?.status === 401
    || /auth session missing|session (from session_id )?not found|jwt expired|token has expired|invalid claim/i.test(raw)
  ) {
    return {
      message: 'Ce lien de réinitialisation a expiré ou a déjà été utilisé. Demande-en un nouveau.',
      recoveryExpired: true, retryable: true,
    };
  }

  // ── Trop de tentatives (hors envoi d'e-mail) ──────────────────────────────
  if (code === 'over_request_rate_limit' || err?.status === 429 || /too many requests/i.test(raw)) {
    const s = retryAfter(raw);
    return {
      message: s ? `Trop de tentatives. Attends ${s} secondes et recommence.` : 'Trop de tentatives en peu de temps. Attends quelques minutes et recommence.',
      retryable: true,
    };
  }

  // ── Réseau ────────────────────────────────────────────────────────────────
  if (/failed to fetch|network|timeout/i.test(low)) {
    return { message: 'Connexion au serveur impossible. Vérifie ta connexion et réessaie.', notCreated: true, retryable: true };
  }

  return { message: raw || 'Une erreur est survenue.' };
}
