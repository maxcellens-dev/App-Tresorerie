/**
 * GABARIT DES E-MAILS APPLICATIFS RELYKA — source UNIQUE.
 *
 * Importé à la fois par l'Edge Function qui envoie (Deno) et par l'écran admin qui prévisualise
 * (React Native / web). C'est le seul moyen que l'aperçu montre EXACTEMENT ce qui partira : deux
 * copies de ce rendu auraient dérivé au premier ajustement de style.
 *
 * Module volontairement SANS DÉPENDANCE (pas d'import) : il doit se charger aussi bien sous Deno
 * que sous Metro.
 *
 * Mise en forme : tables + styles en ligne. C'est la seule qui traverse tous les clients mail —
 * Outlook ignore une bonne partie du CSS moderne, Gmail supprime les feuilles de style distantes.
 */

export const RELYKA_APP_URL = 'https://relyka.app';

/** Le corps saisi contient-il du HTML, ou est-ce du texte brut ? */
export function looksLikeHtml(body: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(body);
}

/**
 * Le contenu est-il un e-mail COMPLET, qui porte déjà son propre en-tête et son pied de page ?
 *
 * Certains e-mails sont conçus de bout en bout (mise en page dédiée, couleurs propres, pied de page
 * sur mesure). Les faire passer par le gabarit standard produirait un document imbriqué dans un
 * autre : deux `<body>`, deux en-têtes Relyka, deux liens de désinscription — ce que Gmail et Outlook
 * réécrivent n'importe comment. On les envoie donc TELS QUELS.
 */
export function isStandaloneHtmlEmail(body: string): boolean {
  return /<!doctype\s+html|<html[\s>]|<\/head>|<body[\s>]/i.test(body);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Corps prêt à insérer : le HTML est repris tel quel, le texte brut est transformé en paragraphes
 * (une ligne vide = un nouveau paragraphe). L'admin peut donc écrire simplement OU mettre en forme,
 * sans avoir à choisir un mode.
 */
export function renderBody(body: string): string {
  if (looksLikeHtml(body)) return body;
  return body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#2f3a37;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

export interface RenderOptions {
  subject: string;
  body: string;
  /** Lien de désinscription PROPRE au destinataire (obligation légale). */
  unsubUrl: string;
  appUrl?: string;
  /** Bouton principal — masqué si le corps porte déjà son propre appel à l'action. */
  showCta?: boolean;
}

/** E-mail complet : en-tête Relyka, corps, bouton, pied de page avec désinscription. */
export function renderRelykaEmail(o: RenderOptions): string {
  const appUrl = (o.appUrl ?? RELYKA_APP_URL).replace(/\/$/, '');

  /* ── Contenu déjà complet : on n'enveloppe PAS (cf. isStandaloneHtmlEmail). ──
     Seule obligation à honorer coûte que coûte : le lien de désinscription. S'il figure déjà dans le
     document (le cas normal, via {{LIEN_DESABO}}), on ne touche à rien. Sinon on ajoute un pied
     minimal : envoyer une campagne sans moyen de se désinscrire n'est pas une option, et c'est
     précisément ce qu'un document sur mesure peut oublier. */
  if (isStandaloneHtmlEmail(o.body)) {
    if (o.body.includes(o.unsubUrl)) return o.body;
    const footer = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F8F6;padding:18px 12px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
    <tr><td align="center">
      <p style="margin:0;font-size:12px;line-height:18px;color:#839992;">
        <a href="${o.unsubUrl}" style="color:#839992;text-decoration:underline;">Ne plus recevoir ces e-mails</a>
      </p>
    </td></tr>
  </table>`;
    // Inséré juste avant la fermeture du corps, sinon les clients mail le placent hors du document.
    return /<\/body>/i.test(o.body)
      ? o.body.replace(/<\/body>/i, `${footer}\n</body>`)
      : o.body + footer;
  }

  const cta = o.showCta === false ? '' : `
        <tr><td style="padding:6px 32px 30px;" align="center">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="background:#00B67A;border-radius:12px;">
              <a href="${appUrl}" style="display:inline-block;padding:15px 30px;font-size:15.5px;font-weight:700;color:#ffffff;text-decoration:none;">Ouvrir Relyka</a>
            </td>
          </tr></table>
        </td></tr>`;
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(o.subject)}</title></head>
<body style="margin:0;padding:0;background:#F4EFE6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4EFE6;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 2px 12px rgba(13,46,42,.08);">
        <tr><td style="background:#0D2E2A;padding:30px 32px;text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-.6px;">Relyka</div>
          <div style="font-size:12.5px;color:#8FD8C4;margin-top:5px;">Ton argent, au clair</div>
        </td></tr>
        <tr><td style="padding:34px 32px 10px;">
          <h1 style="margin:0 0 20px;font-size:21px;line-height:29px;color:#0D2E2A;font-weight:800;">${escapeHtml(o.subject)}</h1>
${renderBody(o.body)}
        </td></tr>${cta}
        <tr><td style="padding:20px 32px 28px;border-top:1px solid #EAE4DA;">
          <p style="margin:0 0 8px;font-size:12px;line-height:18px;color:#7A8783;">
            Tu reçois cet e-mail parce que tu as un compte Relyka.
          </p>
          <p style="margin:0;font-size:12px;line-height:18px;color:#7A8783;">
            <a href="${o.unsubUrl}" style="color:#7A8783;text-decoration:underline;">Ne plus recevoir ces e-mails</a>
            &nbsp;·&nbsp;
            <a href="${appUrl}/confidentialite" style="color:#7A8783;text-decoration:underline;">Confidentialité</a>
            &nbsp;·&nbsp;
            <a href="${appUrl}/legal" style="color:#7A8783;text-decoration:underline;">Mentions légales</a>
          </p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:11.5px;color:#9AA5A1;">© Relyka</p>
    </td></tr>
  </table>
</body></html>`;
}

/* ══════════════ GABARITS PRÊTS À L'EMPLOI ══════════════════════════════════════════════════════
   Trois intentions distinctes, pas trois habillages du même message. Chacun s'insère dans le corps
   (l'en-tête, le bouton et le pied de page sont ajoutés autour) et reste modifiable ensuite : ce
   sont des points de départ, pas des carcans.
   Les styles sont EN LIGNE et les blocs faits de <table> : indispensable en e-mail. */

export interface EmailTemplate {
  id: string;
  label: string;
  /** Ce à quoi il sert — affiché sous le nom pour choisir sans ouvrir. */
  hint: string;
  subject: string;
  body: string;
}

const P = 'margin:0 0 16px;font-size:15px;line-height:24px;color:#2f3a37;';
const H2 = 'margin:24px 0 10px;font-size:17px;line-height:24px;color:#0D2E2A;font-weight:800;';
const LI = 'margin:0 0 8px;font-size:15px;line-height:23px;color:#2f3a37;';

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'nouveaute',
    label: 'Nouveauté',
    hint: 'Annoncer une fonctionnalité : ce que c’est, à quoi ça sert, où la trouver.',
    subject: 'Du nouveau dans Relyka',
    body: `<p style="${P}">Bonjour,</p>
<p style="${P}">Une nouveauté vient d'arriver dans Relyka, et elle devrait te faire gagner du temps.</p>

<h2 style="${H2}">Ce qui change</h2>
<p style="${P}"><strong>Décris ici la nouveauté en une phrase.</strong> Explique ensuite en deux ou trois lignes ce qu'elle apporte concrètement, avec des mots simples.</p>

<h2 style="${H2}">Concrètement</h2>
<ul style="margin:0 0 16px;padding-left:20px;">
  <li style="${LI}">Premier bénéfice, formulé du point de vue de l'utilisateur.</li>
  <li style="${LI}">Deuxième bénéfice.</li>
  <li style="${LI}">Troisième bénéfice.</li>
</ul>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;background:#F1F7F5;border-radius:12px;border-left:4px solid #00B67A;">
  <tr><td style="padding:14px 16px;font-size:14.5px;line-height:22px;color:#0D4A3E;">
    <strong>Où la trouver :</strong> indique le chemin exact, par exemple « Pilotage → Ce qui va encore sortir ».
  </td></tr>
</table>

<p style="${P}">Bonne découverte,<br>L'équipe Relyka</p>`,
  },
  {
    id: 'conseil',
    label: 'Conseil du mois',
    hint: 'Un conseil utile, avec le geste à faire dans l’app. Ton pédagogique.',
    subject: 'Le conseil Relyka du mois',
    body: `<p style="${P}">Bonjour,</p>
<p style="${P}"><strong>Une habitude simple change beaucoup de choses :</strong> énonce ici le conseil en une phrase claire.</p>

<h2 style="${H2}">Pourquoi ça marche</h2>
<p style="${P}">Explique le raisonnement en deux ou trois lignes. Reste concret : un exemple chiffré vaut mieux qu'un principe général.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;background:#FFF6E8;border-radius:12px;border-left:4px solid #E8A33D;">
  <tr><td style="padding:14px 16px;font-size:14.5px;line-height:22px;color:#6A4A12;">
    <strong>À retenir :</strong> la phrase que tu veux qu'on garde en tête, même sans lire le reste.
  </td></tr>
</table>

<h2 style="${H2}">Le geste, dans Relyka</h2>
<ol style="margin:0 0 16px;padding-left:20px;">
  <li style="${LI}">Première étape.</li>
  <li style="${LI}">Deuxième étape.</li>
  <li style="${LI}">C'est fait.</li>
</ol>

<p style="${P}">À bientôt,<br>L'équipe Relyka</p>`,
  },
  {
    id: 'retour',
    label: 'On ne t’a pas vu',
    hint: 'Réactivation : donner envie de revenir sans culpabiliser.',
    subject: 'Ton budget t’attend',
    body: `<p style="${P}">Bonjour,</p>
<p style="${P}">Ça fait un moment qu'on ne t'a pas vu dans Relyka. Rien de grave — mais tes chiffres, eux, ont continué d'avancer sans toi.</p>

<h2 style="${H2}">Reprendre la main prend deux minutes</h2>
<ul style="margin:0 0 16px;padding-left:20px;">
  <li style="${LI}"><strong>Mets à jour ton solde</strong> : c'est le geste qui remet tous les montants au clair.</li>
  <li style="${LI}"><strong>Clôture le mois passé</strong> pour fiabiliser tes moyennes.</li>
  <li style="${LI}"><strong>Regarde ton Relyka</strong> : ce qu'il te reste vraiment à décider ce mois-ci.</li>
</ul>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;background:#F1F7F5;border-radius:12px;border-left:4px solid #00B67A;">
  <tr><td style="padding:14px 16px;font-size:14.5px;line-height:22px;color:#0D4A3E;">
    Pas besoin de tout rattraper : Relyka repart de ton solde d'aujourd'hui.
  </td></tr>
</table>

<p style="${P}">À très vite,<br>L'équipe Relyka</p>`,
  },
];
