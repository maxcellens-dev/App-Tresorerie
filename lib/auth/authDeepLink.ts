/**
 * Lecture des URL de retour d'authentification (liens profonds).
 *
 * ── POURQUOI CE FICHIER ─────────────────────────────────────────────────────────────────────────
 * Sur WEB, supabase-js lit tout seul les jetons présents dans l'URL (`detectSessionInUrl`) et émet
 * l'événement `PASSWORD_RECOVERY`. Sur NATIF, cette détection est désactivée (il n'y a pas d'URL de
 * page) : personne ne lisait donc le lien de réinitialisation reçu par e-mail. C'est pour ça que
 * `resetPasswordForEmail` n'envoyait AUCUN `redirectTo` depuis le téléphone — le lien retombait sur
 * l'adresse du site, et quelqu'un qui n'a que l'app devait finir sa réinitialisation dans un
 * navigateur, sur un autre écran, avec une autre session.
 *
 * ── LES DEUX FLUX ───────────────────────────────────────────────────────────────────────────────
 * Supabase renvoie soit un `?code=…` (flux PKCE), soit `#access_token=…&refresh_token=…` (flux
 * implicite) — le choix dépend de la configuration du projet, et il peut changer sans prévenir. On
 * lit donc les deux, comme le fait déjà la connexion sociale (components/auth/SocialAuthButtons).
 *
 * ── ET QUAND LE LIEN EST MORT ───────────────────────────────────────────────────────────────────
 * Un lien périmé ou déjà utilisé ne revient pas vide : il revient avec `error_code=otp_expired`. Ce
 * cas DOIT être reconnu, sinon l'app ouvre l'écran « nouveau mot de passe » sans session et
 * l'enregistrement échoue sans que personne comprenne pourquoi.
 *
 * ⚠️ CÔTÉ SUPABASE : l'URL `relyka-app://reset-password` doit figurer dans
 *    Authentication → URL Configuration → Redirect URLs. Sans elle, Supabase ignore le `redirectTo`
 *    et retombe sur le Site URL — c'est-à-dire exactement le comportement d'avant (le web), donc
 *    une dégradation propre, jamais une panne.
 */

/**
 * Récupère une valeur dans une chaîne de paramètres (`a=1&b=2`) — analyse manuelle, fiable en RN.
 *
 * `plusAsSpace` : dans une chaîne de REQUÊTE, `+` code une espace ; dans un fragment porteur de
 * jetons, non. On ne l'active donc que pour les textes lisibles (`error_description`) — jamais pour
 * un jeton, qu'il abîmerait silencieusement.
 */
export function paramFrom(str: string, key: string, plusAsSpace = false): string | null {
  for (const part of str.split('&')) {
    const eq = part.indexOf('=');
    const k = eq >= 0 ? part.slice(0, eq) : part;
    if (decodeURIComponent(k) !== key) continue;
    const raw = eq >= 0 ? part.slice(eq + 1) : '';
    try {
      return decodeURIComponent(plusAsSpace ? raw.replace(/\+/g, '%20') : raw);
    } catch {
      return raw; // séquence d'échappement invalide : mieux vaut la valeur brute que rien
    }
  }
  return null;
}

export type AuthLink =
  /** Lien de réinitialisation exploitable : il reste à ouvrir la session. */
  | { kind: 'recovery'; code: string | null; accessToken: string | null; refreshToken: string | null }
  /**
   * Confirmation d'un CHANGEMENT D'ADRESSE e-mail (`type=email_change`).
   *
   * Ce cas n'était pas reconnu : le lien reçu par e-mail rendait `none` et l'application ne faisait
   * donc RIEN en s'ouvrant — la personne se retrouvait sur son tableau de bord, sans savoir si son
   * changement avait été pris en compte. Pire, le repli sur le CHEMIN (`/reset-password`) pouvait,
   * selon l'URL configurée, le faire passer pour une réinitialisation et ouvrir l'écran
   * « Nouveau mot de passe » — un écran qui n'a rien à voir avec ce qu'on venait de demander.
   */
  | { kind: 'email_change'; code: string | null; accessToken: string | null; refreshToken: string | null }
  /** Le fournisseur a répondu par un refus (lien périmé, déjà utilisé, annulé). */
  | { kind: 'error'; expired: boolean; message: string }
  /** Rien à voir ici (URL d'ouverture ordinaire, retour OAuth traité ailleurs…). */
  | { kind: 'none' };

/**
 * Reconnaît un retour de RÉINITIALISATION DE MOT DE PASSE, et lui seul.
 *
 * Volontairement étroit : le retour de connexion sociale (`…/auth-callback`) est déjà récupéré par
 * `WebBrowser.openAuthSessionAsync`, qui rend l'URL directement à l'appelant. Un lecteur global qui
 * traiterait aussi ces URL les consommerait DEUX fois — d'où le filtrage sur `type=recovery` ou sur
 * le chemin `reset-password`.
 */
export function parseAuthLink(url: string | null | undefined): AuthLink {
  if (!url) return { kind: 'none' };

  const hashIdx = url.indexOf('#');
  const hash = hashIdx >= 0 ? url.slice(hashIdx + 1) : '';
  const beforeHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const qIdx = beforeHash.indexOf('?');
  const query = qIdx >= 0 ? beforeHash.slice(qIdx + 1) : '';
  const path = qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash;

  const pick = (k: string, plusAsSpace = false) =>
    paramFrom(query, k, plusAsSpace) ?? paramFrom(hash, k, plusAsSpace);

  const type = pick('type');
  /* `email_change` est TESTÉ EN PREMIER, et sur le `type` seul : le repli par chemin ci-dessous
     reconnaît « reset-password », or Supabase peut renvoyer une confirmation d'adresse sur cette
     même URL de redirection. Sans cette priorité, un changement d'e-mail confirmé aurait ouvert
     l'écran « Nouveau mot de passe ». */
  const isEmailChange = type === 'email_change';
  // `type=recovery` est posé par Supabase ; le chemin sert de repli, car un lien EN ERREUR ne porte
  // pas toujours de `type` (seulement `error`/`error_code`).
  const isRecovery = !isEmailChange && (type === 'recovery' || /reset-password/i.test(path));
  if (!isEmailChange && !isRecovery) return { kind: 'none' };

  const errorCode = pick('error_code');
  const errorRaw = pick('error');
  const errorDesc = pick('error_description', true);
  if (errorCode || errorRaw) {
    const blob = `${errorCode ?? ''} ${errorRaw ?? ''} ${errorDesc ?? ''}`;
    return {
      kind: 'error',
      // `otp_expired`, `access_denied`, « Email link is invalid or has expired ».
      expired: /expired|invalid|otp/i.test(blob),
      message: errorDesc || (isEmailChange
        ? 'Ce lien de confirmation n’est plus valable.'
        : 'Ce lien de réinitialisation n’est plus valable.'),
    };
  }

  const code = pick('code');
  const accessToken = pick('access_token');
  const refreshToken = pick('refresh_token');
  // Ni jeton ni erreur : ce n'est pas un retour d'e-mail (ouverture manuelle du lien profond, par
  // exemple). On ne déclenche rien plutôt que d'annoncer un faux échec.
  if (!code && !(accessToken && refreshToken)) return { kind: 'none' };

  return { kind: isEmailChange ? 'email_change' : 'recovery', code, accessToken, refreshToken };
}
