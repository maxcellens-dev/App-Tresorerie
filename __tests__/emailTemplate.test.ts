import { renderRelykaEmail, renderBody, looksLikeHtml, EMAIL_TEMPLATES } from '../supabase/functions/_shared/emailTemplate';

describe('gabarit e-mail partagé', () => {
  it('texte simple → un paragraphe par ligne vide, et les caractères spéciaux sont échappés', () => {
    const out = renderBody('Bonjour & bienvenue\n\nDeuxième paragraphe');
    expect(out.match(/<p style=/g)).toHaveLength(2);
    expect(out).toContain('&amp;');
  });

  it('un simple saut de ligne reste dans le même paragraphe', () => {
    const out = renderBody('Ligne un\nLigne deux');
    expect(out.match(/<p style=/g)).toHaveLength(1);
    expect(out).toContain('<br>');
  });

  it('HTML saisi → repris TEL QUEL (c’est tout l’intérêt de la mise en forme)', () => {
    const html = '<h2 style="x">Titre</h2><ul><li>a</li></ul>';
    expect(renderBody(html)).toBe(html);
  });

  it('détection', () => {
    expect(looksLikeHtml('<p>x</p>')).toBe(true);
    expect(looksLikeHtml('Bonjour, 3 < 5 et voilà')).toBe(false);
  });

  it('l’e-mail complet porte le lien de désinscription et l’objet', () => {
    const out = renderRelykaEmail({ subject: 'Objet', body: 'Corps', unsubUrl: 'https://x/u?t=1' });
    expect(out).toContain('https://x/u?t=1');
    expect(out).toContain('Objet');
    expect(out).toContain('Ne plus recevoir');
  });

  it('les 3 gabarits sont exploitables directement', () => {
    expect(EMAIL_TEMPLATES).toHaveLength(3);
    for (const t of EMAIL_TEMPLATES) {
      expect(t.subject.length).toBeGreaterThan(3);
      expect(looksLikeHtml(t.body)).toBe(true);
      // Rendu sans erreur et corps réellement inséré.
      expect(renderRelykaEmail({ subject: t.subject, body: t.body, unsubUrl: 'u' })).toContain(t.body.slice(0, 40));
    }
  });
});
