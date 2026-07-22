import { parseAiReport, signalMeta, scoreColor } from '../lib/aiReport';

const C = { success: '#0f0', warning: '#fa0', danger: '#f00' };

describe('aiReport — parsing des réponses Conseils IA en rapport structuré', () => {
  it('extrait le bloc de synthèse ##RELYKA (verdict, score, tag, signaux, actions)', () => {
    const txt = [
      '##RELYKA',
      'verdict: Tu es solide mais ta marge se resserre.',
      'score: 68',
      'tag: Bonne direction',
      'protege: Tu peux tenir plusieurs mois sans revenus.',
      'vigilance: Presque tout ton revenu part en charges fixes.',
      'signal: Sécurité | good | Matelas 4,2 mois',
      'signal: Trésorerie | watch | Fin de mois +90 €',
      'signal: Budget | over | 612 / 480 €',
      'action: Suspendre les versements | Priorité immédiate',
      'action: Vérifier le budget | Cette semaine',
      '##END',
      '',
      '**🩺 Score : 68/100**',
      "L'épargne tire vers le haut, la trésorerie vers le bas.",
      '**🎯 Tes priorités**',
      '- Suspendre les versements',
    ].join('\n');

    const r = parseAiReport(txt);
    expect(r.structured).toBe(true);
    expect(r.summary).not.toBeNull();
    expect(r.summary!.verdict).toMatch(/marge se resserre/);
    expect(r.summary!.score).toBe(68);
    expect(r.summary!.tag).toBe('Bonne direction');
    expect(r.summary!.protect).toMatch(/plusieurs mois sans revenus/);
    expect(r.summary!.vigilance).toMatch(/charges fixes/);
    expect(r.summary!.signals).toHaveLength(3);
    expect(r.summary!.signals[1]).toMatchObject({ label: 'Trésorerie', status: 'watch' });
    expect(r.summary!.signals[2].status).toBe('over');
    // Première action = prioritaire par défaut.
    expect(r.summary!.actions[0]).toMatchObject({ title: 'Suspendre les versements', primary: true });
    // Le bloc est retiré du corps ; les sections restent.
    expect(r.sections.map((s) => s.title)).toEqual(['Score : 68/100', 'Tes priorités']);
    expect(r.sections[0].emoji).toBe('🩺');
    expect(r.sections[1].body).toContain('Suspendre les versements');
  });

  it('repêche le score du corps si le bloc ne le donne pas (anneau toujours affiché)', () => {
    const txt = '##RELYKA\nverdict: Solide mais tréso à surveiller.\ntag: À consolider\n##END\n\n**🩺 Santé financière : 67/100**\nBonne base.';
    const r = parseAiReport(txt);
    expect(r.summary!.score).toBe(67);
  });

  it('borne le score à [0,100] et tolère un bloc non fermé (jusqu’à la 1ʳᵉ section)', () => {
    const txt = '##RELYKA\nverdict: Ça va.\nscore: 250\n\n**💸 À optimiser**\n- Rien de significatif.';
    const r = parseAiReport(txt);
    expect(r.summary!.score).toBe(100);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0].title).toBe('À optimiser');
  });

  it('sans bloc ##RELYKA, rend quand même les sections (anciens messages / analyses v3)', () => {
    const txt = '**🎯 Ce qui ressort**\nTon poste courses pèse lourd.\n**⚠ À surveiller**\nFin de mois juste.';
    const r = parseAiReport(txt);
    expect(r.summary).toBeNull();
    expect(r.structured).toBe(true);
    expect(r.sections).toHaveLength(2);
    expect(r.sections[0].emoji).toBe('🎯');
    expect(r.sections[1].emoji).toBe('⚠');
  });

  it('réponse simple (chat) sans structure → non structuré (fallback texte)', () => {
    const txt = 'Oui, tu peux te le permettre : il te reste 320 € de marge ce mois-ci. 👉 Mets-en 150 de côté.';
    const r = parseAiReport(txt);
    expect(r.structured).toBe(false);
    expect(r.summary).toBeNull();
    expect(r.sections).toHaveLength(0);
  });

  it('détecte les titres avec emoji DEVANT le gras (📊 **Titre**) comme sections', () => {
    const txt = '📱 **Compte courant**\n2 519 € → baisse prévue.\n🛡️ **Réserve**\n23 000 € d\'autonomie.';
    const r = parseAiReport(txt);
    expect(r.sections).toHaveLength(2);
    expect(r.sections[0]).toMatchObject({ emoji: '📱', title: 'Compte courant' });
    expect(r.sections[0].body).toContain('baisse prévue');
    expect(r.sections[1].emoji).toBe('🛡️');
  });

  it('regroupe les sous-points (> et -) DANS la section, pas en cartes séparées', () => {
    const txt = [
      '**🩺 Santé financière : 73/100**',
      '> 🟢 **Forces :**',
      'Bonne épargne.',
      '- **Ce qui se passe :**',
      'Patrimoine en hausse.',
      '**🧭 Où tu en es**',
      'Amélioration.',
    ].join('\n');
    const r = parseAiReport(txt);
    expect(r.sections).toHaveLength(2); // 2 sections de 1ᵉʳ niveau, pas 4+
    expect(r.sections[0].title).toContain('Santé');
    expect(r.sections[0].body).toContain('Forces');
    expect(r.sections[0].body).toContain('Ce qui se passe');
    expect(r.sections[1].title).toContain('Où tu en es');
  });

  it('regroupe les sous-labels emoji « 👉 L\'action : » / « 💡 Pourquoi : » dans la section', () => {
    const txt = [
      '**🎯 Les meilleures décisions**',
      '• 1. Optimiser ton surplus',
      '👉 **L\'action :**',
      'Mets 2 958 € de côté.',
      '💡 **Pourquoi :**',
      'Renforce ton épargne.',
      '• 2. Investir',
      '👉 **L\'action :**',
      'Vise 700 €/mois.',
    ].join('\n');
    const r = parseAiReport(txt);
    expect(r.sections).toHaveLength(1); // UNE carte « Les meilleures décisions », pas 4+
    expect(r.sections[0].body).toContain("L'action");
    expect(r.sections[0].body).toContain('Pourquoi');
    expect(r.sections[0].body).toContain('700');
  });

  it('contrat ### : seules les lignes ### ouvrent une carte, emojis/gras restent dedans', () => {
    const txt = [
      '### 🎯 Les meilleures décisions',
      '- 1. Accélérer l\'investissement',
      '👉 **L\'action :** investis 700 €/mois.',
      '💡 **Pourquoi :** patrimoine encore faible.',
      '- 2. Catégoriser tes dépenses',
      '👉 **L\'action :** catégorise 131 €/mois.',
      '### 📊 Ce que tu peux améliorer',
      '- **Optimiser tes variables** — gain ~200 €/mois.',
    ].join('\n');
    const r = parseAiReport(txt);
    expect(r.sections).toHaveLength(2); // UNIQUEMENT les 2 ###
    expect(r.sections[0]).toMatchObject({ emoji: '🎯', title: 'Les meilleures décisions' });
    expect(r.sections[0].body).toContain('Pourquoi');
    expect(r.sections[0].body).toContain('Catégoriser');
    expect(r.sections[1].emoji).toBe('📊');
  });

  it('ne confond pas le gras EN LIGNE avec un titre de section', () => {
    const txt = 'Tu as **1 200 €** de charges fixes, soit un poids important sur ton budget.';
    const r = parseAiReport(txt);
    expect(r.sections).toHaveLength(0);
    expect(r.structured).toBe(false);
  });

  it('helpers de couleur/statut', () => {
    expect(signalMeta('good', C)).toEqual({ color: '#0f0', label: 'OK' });
    expect(signalMeta('over', C)).toEqual({ color: '#f00', label: 'Dépassé' });
    expect(scoreColor(80, C)).toBe('#0f0');
    expect(scoreColor(50, C)).toBe('#fa0');
    expect(scoreColor(20, C)).toBe('#f00');
  });
});
