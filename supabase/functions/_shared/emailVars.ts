/**
 * VARIABLES D'E-MAIL — `{{PRENOM}}`, `{{MOIS_PASSE}}`…
 *
 * Sans cette couche, un `{{PRENOM}}` écrit dans une campagne partait TEL QUEL : les destinataires
 * lisaient « Bonjour {{PRENOM}}, ». Rien ne substituait quoi que ce soit.
 *
 * La substitution se fait DESTINATAIRE PAR DESTINATAIRE (le prénom et le lien de désinscription
 * diffèrent), donc à l'intérieur de la boucle d'envoi et jamais une seule fois pour le lot.
 *
 * Module sans dépendance : chargé aussi bien sous Deno (Edge Function) que sous Metro (aperçu admin),
 * exactement comme `emailTemplate.ts` — c'est ce qui garantit que l'aperçu montre le vrai rendu.
 */

export interface EmailVarContext {
  /** Nom complet du destinataire (on n'en garde que le prénom). */
  fullName?: string | null;
  /** Lien de désinscription PROPRE au destinataire (obligation légale). */
  unsubUrl: string;
  /** Racine de l'app, sans slash final. */
  appUrl: string;
  /** Date de référence pour les variables de mois. Défaut : maintenant. */
  now?: Date;
}

/** Prénom seul : « Marie Dupont » → « Marie ». Chaîne vide si on ne sait pas. */
function firstName(fullName?: string | null): string {
  const n = String(fullName ?? '').trim();
  if (!n) return '';
  return n.split(/\s+/)[0];
}

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Table des variables disponibles. Les mois désignent le mois PRÉCÉDENT : ces e-mails parlent
 * toujours du mois qui vient de s'achever (clôture, bilan), jamais du mois en cours.
 */
export function emailVars(ctx: EmailVarContext): Record<string, string> {
  const now = ctx.now ?? new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const mois = MONTHS[prev.getMonth()];
  const app = ctx.appUrl.replace(/\/$/, '');

  return {
    PRENOM: firstName(ctx.fullName),
    /** Mois précédent en minuscules — pour un milieu de phrase (« ton mois de juillet »). */
    MOIS_PASSE: mois,
    /** Idem, capitalisé — pour un début de phrase. */
    MOIS_PASSE_CAP: cap(mois),
    /** Mois + année, capitalisé (« Juillet 2026 ») — titres et boutons. */
    MOIS_ANNEE: `${cap(mois)} ${prev.getFullYear()}`,
    ANNEE: String(prev.getFullYear()),
    LIEN_APP: app,
    LIEN_PREFERENCES: `${app}/parametres`,
    LIEN_DESABO: ctx.unsubUrl,
    LIEN_CONFIDENTIALITE: `${app}/confidentialite`,
  };
}

/** Noms de variables reconnus — affichés dans l'écran admin pour qu'on ne les devine pas. */
export const EMAIL_VAR_NAMES = [
  'PRENOM', 'MOIS_PASSE', 'MOIS_PASSE_CAP', 'MOIS_ANNEE', 'ANNEE',
  'LIEN_APP', 'LIEN_PREFERENCES', 'LIEN_DESABO', 'LIEN_CONFIDENTIALITE',
] as const;

/**
 * Remplace les `{{VARIABLES}}` d'un contenu.
 *
 * Deux partis pris :
 *  • une variable INCONNUE est remplacée par du vide, pas laissée en place — mieux vaut une phrase
 *    incomplète qu'un `{{TRUC}}` affiché à des milliers de personnes ;
 *  • le nettoyage final rattrape les trous de ponctuation (« Bonjour , » quand le destinataire n'a
 *    pas renseigné son nom), sinon chaque variable optionnelle laisserait une cicatrice visible.
 */
export function applyEmailVars(content: string, ctx: EmailVarContext): string {
  const vars = emailVars(ctx);
  return content
    .replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '')
    // Espace avant une virgule / un point / un point d'exclamation, laissé par une variable vide.
    .replace(/ +([,.!?;:])/g, '$1')
    // « Bonjour , » → « Bonjour, » couvert ci-dessus ; ici les doubles espaces résiduels.
    .replace(/[ \t]{2,}/g, ' ');
}
