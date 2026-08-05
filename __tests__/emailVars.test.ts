import { applyEmailVars, emailVars } from '../supabase/functions/_shared/emailVars';
import { renderRelykaEmail, isStandaloneHtmlEmail } from '../supabase/functions/_shared/emailTemplate';

const CTX = {
  fullName: 'Marie Dupont',
  unsubUrl: 'https://relyka.app/desinscription?t=abc',
  appUrl: 'https://relyka.app',
  // 5 août 2026 → le mois « passé » est juillet 2026.
  now: new Date(2026, 7, 5),
};

describe('emailVars', () => {
  it('ne garde que le prénom', () => {
    expect(emailVars(CTX).PRENOM).toBe('Marie');
  });

  it('désigne le mois PRÉCÉDENT, avec la casse attendue selon la place dans la phrase', () => {
    const v = emailVars(CTX);
    expect(v.MOIS_PASSE).toBe('juillet');       // milieu de phrase
    expect(v.MOIS_PASSE_CAP).toBe('Juillet');   // début de phrase
    expect(v.MOIS_ANNEE).toBe('Juillet 2026');  // titre / bouton
    expect(v.ANNEE).toBe('2026');
  });

  it('passe correctement de janvier à décembre de l’année précédente', () => {
    const v = emailVars({ ...CTX, now: new Date(2026, 0, 9) });
    expect(v.MOIS_ANNEE).toBe('Décembre 2025');
  });

  it('substitue les variables du mail de clôture', () => {
    const out = applyEmailVars(
      'Bonjour {{PRENOM}}, clôture ton mois de {{MOIS_PASSE}}. {{MOIS_ANNEE}} est terminé.',
      CTX,
    );
    expect(out).toBe('Bonjour Marie, clôture ton mois de juillet. Juillet 2026 est terminé.');
  });

  it('substitue les liens, dont la désinscription propre au destinataire', () => {
    const out = applyEmailVars('<a href="{{LIEN_DESABO}}">stop</a> <a href="{{LIEN_APP}}">app</a>', CTX);
    expect(out).toContain('https://relyka.app/desinscription?t=abc');
    expect(out).toContain('href="https://relyka.app"');
  });

  it('ne laisse pas de cicatrice quand le prénom est inconnu', () => {
    const out = applyEmailVars('Bonjour {{PRENOM}}, ça va ?', { ...CTX, fullName: null });
    expect(out).toBe('Bonjour, ça va ?');
  });

  it('vide une variable inconnue au lieu de l’afficher', () => {
    expect(applyEmailVars('Salut {{INEXISTANT}}!', CTX)).toBe('Salut!');
  });
});

describe('e-mail autonome', () => {
  const standalone = '<!doctype html><html><head></head><body><p>Coucou</p>'
    + '<a href="https://relyka.app/desinscription?t=abc">Se désabonner</a></body></html>';

  it('reconnaît un document complet', () => {
    expect(isStandaloneHtmlEmail(standalone)).toBe(true);
    expect(isStandaloneHtmlEmail('<p>juste un paragraphe</p>')).toBe(false);
  });

  it('n’enveloppe PAS un document complet (sinon deux en-têtes et deux pieds de page)', () => {
    const html = renderRelykaEmail({ subject: 'Test', body: standalone, unsubUrl: CTX.unsubUrl });
    expect(html).toBe(standalone);
    // Un seul <body> : la preuve qu'il n'y a pas d'imbrication.
    expect(html.match(/<body/gi) ?? []).toHaveLength(1);
  });

  it('ajoute un pied de désinscription si le document autonome n’en a pas', () => {
    const sansDesabo = '<!doctype html><html><body><p>Coucou</p></body></html>';
    const html = renderRelykaEmail({ subject: 'Test', body: sansDesabo, unsubUrl: CTX.unsubUrl });
    expect(html).toContain(CTX.unsubUrl);
    expect(html.indexOf(CTX.unsubUrl)).toBeLessThan(html.indexOf('</body>'));
  });

  it('enveloppe toujours un corps ordinaire', () => {
    const html = renderRelykaEmail({ subject: 'Test', body: 'Bonjour', unsubUrl: CTX.unsubUrl });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Ton argent, au clair');
  });
});
