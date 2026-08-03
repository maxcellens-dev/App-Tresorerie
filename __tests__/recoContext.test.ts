import { getRecoContextText, type RecoFinancials } from '../lib/recoContext';

const fin: RecoFinancials = { currentChecking: 4000, projectedEndChecking: 4180 };

describe('getRecoContextText — épargner / investir', () => {
  it('rien à dire sur un montant nul', () => {
    expect(getRecoContextText('save', 0, fin, { kind: 'sustainable', monthly: 100 })).toBeNull();
  });

  it('ne promet JAMAIS de montant à x années (plus de projection 10/20 ans)', () => {
    const fits = [
      { kind: 'sustainable', monthly: 300 },
      { kind: 'capped', monthly: 120 },
      { kind: 'month_only' },
      undefined,
    ] as const;
    for (const type of ['save', 'invest'] as const) {
      for (const fit of fits) {
        const txt = getRecoContextText(type, 300, fin, fit as any)!;
        // ⚠️ `\b` des deux côtés : « sans » se termine par « ans ».
        expect(txt).not.toMatch(/\bans?\b/);
        expect(txt).not.toMatch(/%\s*\/\s*an|7\s*%/);
      }
    }
  });

  it('durable → propose le virement mensuel (long terme) et dit que le solde ne baisse pas', () => {
    const txt = getRecoContextText('invest', 300, fin, { kind: 'sustainable', monthly: 300 })!;
    expect(txt).toMatch(/virement mensuel de 300/);
    expect(txt).toMatch(/ne baisse pas/);
    expect(txt).toMatch(/ce mois-ci sans risque/);
  });

  it('plafonné → le mois passe, mais le récurrent est borné au montant tenable', () => {
    const txt = getRecoContextText('save', 300, fin, { kind: 'capped', monthly: 120 })!;
    expect(txt).toMatch(/ces 300/);
    expect(txt).toMatch(/reste à 120 €?\/mois|reste à 120/);
    expect(txt).toMatch(/baisserait mois après mois/);
  });

  it('non tenable → message PONCTUEL, borné au mois en cours', () => {
    const txt = getRecoContextText('save', 300, fin, { kind: 'month_only' })!;
    expect(txt).toMatch(/ce mois-ci sans risque/);
    // La formulation exacte est libre ; ce qui ne l'est pas : ne RIEN proposer en récurrent quand
    // la trajectoire dit que le geste n'est pas répétable.
    expect(txt).not.toMatch(/virement mensuel/);
  });

  it('trajectoire inconnue → ponctuel aussi, sans proposition de récurrent', () => {
    const txt = getRecoContextText('invest', 300, fin, undefined)!;
    expect(txt).toMatch(/ce mois-ci sans risque/);
    expect(txt).not.toMatch(/virement mensuel/);
  });

  it('le verbe suit le type de reco', () => {
    expect(getRecoContextText('save', 100, fin, { kind: 'month_only' })!).toMatch(/mettre de côté/);
    expect(getRecoContextText('invest', 100, fin, { kind: 'month_only' })!).toMatch(/placer/);
  });
});

describe('getRecoContextText — conserver', () => {
  it('annonce le solde de fin de mois avec et sans la somme', () => {
    // toLocaleString('fr-FR') sépare les milliers par une espace INSÉCABLE, pas par ' '.
    const txt = getRecoContextText('keep', 180, fin)!.replace(/[  ]/g, ' ');
    expect(txt).toMatch(/4 180/);
    expect(txt).toMatch(/4 000/);
  });

  it('« Confort » n’a pas de message contextuel', () => {
    expect(getRecoContextText('enjoy', 100, fin)).toBeNull();
  });
});
