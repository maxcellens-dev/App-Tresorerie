/**
 * Politique de mot de passe — SOURCE UNIQUE de vérité, partagée par tous les écrans qui définissent
 * ou changent un mot de passe (inscription, réinitialisation, changement dans les Paramètres).
 *
 * Règles (comptes e-mail) : ≥ 12 caractères, au moins une majuscule, une minuscule, un chiffre et un
 * caractère spécial. On refuse aussi les mots de passe manifestement faibles (suites, répétitions,
 * mots courants) même s'ils cochent les cases.
 *
 * ⚠️ Ceci est la validation CÔTÉ CLIENT (UX immédiate). Elle DOIT être doublée côté serveur : régler
 * dans Supabase Auth → Policies la longueur minimale (12) et « required characters », et activer la
 * protection contre les mots de passe compromis (HaveIBeenPwned). Voir docs/SECURITY.md.
 */

export const PASSWORD_MIN_LENGTH = 12;

export interface PasswordCheck {
  id: 'length' | 'upper' | 'lower' | 'digit' | 'special' | 'notCommon';
  label: string;
  ok: boolean;
}

export interface PasswordEvaluation {
  checks: PasswordCheck[];
  /** Toutes les règles obligatoires sont respectées. */
  valid: boolean;
  /** Force indicative 0 (vide) → 4 (excellent), pour la jauge. */
  score: 0 | 1 | 2 | 3 | 4;
  /** Libellé de force pour l'UI. */
  label: 'Trop court' | 'Faible' | 'Moyen' | 'Bon' | 'Excellent';
  /** Premier message d'erreur bloquant (pour une Alert), ou null si valide. */
  firstError: string | null;
}

// Petit garde-fou anti « Password123! » : suites clavier / répétitions / mots ultra-courants.
const WEAK_PATTERNS = [
  /(.)\1{3,}/, // 4+ fois le même caractère d'affilée (aaaa, !!!!)
  /0123|1234|2345|3456|4567|5678|6789/, // suites de chiffres
  /abcd|bcde|cdef|qwer|azer|wxcv/i, // suites clavier
];
const COMMON_WORDS = ['password', 'motdepasse', 'azerty', 'qwerty', 'relyka', 'admin', 'bienvenue', 'welcome'];

const SPECIAL_RE = /[^A-Za-z0-9]/;

export function evaluatePassword(pw: string): PasswordEvaluation {
  const value = pw ?? '';
  const lower = value.toLowerCase();

  const notCommon =
    value.length > 0 &&
    !WEAK_PATTERNS.some((re) => re.test(value)) &&
    !COMMON_WORDS.some((w) => lower.includes(w));

  const checks: PasswordCheck[] = [
    { id: 'length', label: `Au moins ${PASSWORD_MIN_LENGTH} caractères`, ok: value.length >= PASSWORD_MIN_LENGTH },
    { id: 'upper', label: 'Une majuscule (A-Z)', ok: /[A-Z]/.test(value) },
    { id: 'lower', label: 'Une minuscule (a-z)', ok: /[a-z]/.test(value) },
    { id: 'digit', label: 'Un chiffre (0-9)', ok: /[0-9]/.test(value) },
    { id: 'special', label: 'Un caractère spécial (!?@#…)', ok: SPECIAL_RE.test(value) },
    { id: 'notCommon', label: 'Pas de suite ni de mot trop courant', ok: notCommon },
  ];

  const required = checks.filter((c) => c.id !== 'notCommon');
  const requiredOk = required.every((c) => c.ok);
  const valid = requiredOk && notCommon;

  // Score : nombre de règles cochées, borné, avec bonus longueur.
  const passed = checks.filter((c) => c.ok).length;
  let score: PasswordEvaluation['score'] = 0;
  if (value.length === 0) score = 0;
  else if (!requiredOk) score = passed <= 2 ? 1 : 2;
  else score = value.length >= 16 && notCommon ? 4 : 3;

  const label = (['Trop court', 'Faible', 'Moyen', 'Bon', 'Excellent'] as const)[score];

  const firstError = valid
    ? null
    : value.length < PASSWORD_MIN_LENGTH
      ? `Ton mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`
      : !notCommon
        ? 'Évite les suites (1234, azer) et les mots trop courants.'
        : 'Ajoute une majuscule, une minuscule, un chiffre et un caractère spécial.';

  return { checks, valid, score, label, firstError };
}

/** Raccourci booléen (validation serveur légère / tests). */
export function isPasswordValid(pw: string): boolean {
  return evaluatePassword(pw).valid;
}
