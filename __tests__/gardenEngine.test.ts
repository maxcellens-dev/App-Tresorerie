/**
 * Moteur de l'arbre, choix de Pico et dessin (phases 2 et 3 de la refonte Jardin).
 *
 * Les situations viennent des 10 personnes du canevas « Relyka Essentiel » : chacune doit se lire
 * sur l'arbre comme elle se lit dans ses chiffres — sans jamais rendre l'arbre malade.
 */
import { computeTreeState, type GardenInputs } from '../lib/garden/treeState';
import { buildPicoChoices, permanentTransferHint } from '../lib/garden/picoChoices';
import { buildScene, describeScene } from '../lib/garden/sceneSvg';

const base: GardenInputs = {
  currentBalance: 0, minimumToKeep: 200, monthlyReference: 2000, securityMonths: 0,
  investedValue: 0, investedContributed: 0, enjoyThisMonth: 0,
  recurringSavingsMonthly: 0, recurringInvestMonthly: 0, consecutiveSavingMonths: 0, streakWeeks: 0, credits: [],
};
const person = (p: Partial<GardenInputs>): GardenInputs => ({ ...base, ...p });

const PEOPLE: Record<string, GardenInputs> = {
  camille: person({ currentBalance: 1653, monthlyReference: 1900, securityMonths: 1.8, enjoyThisMonth: 96, consecutiveSavingMonths: 3, streakWeeks: 6, credits: [{ id: 'auto', kind: 'healthy', remaining: 4300, borrowed: 10000 }] }),
  lea: person({ currentBalance: 140, minimumToKeep: 50, monthlyReference: 900, securityMonths: 0.13 }),
  karim: person({ currentBalance: -90, minimumToKeep: 0, monthlyReference: 1810, securityMonths: 0, credits: [{ id: 'revo', kind: 'expensive', remaining: 3000 }] }),
  sophie: person({ currentBalance: 70, minimumToKeep: 50, monthlyReference: 1700, securityMonths: 0.18, enjoyThisMonth: 20 }),
  couple: person({ currentBalance: 1900, monthlyReference: 3300, securityMonths: 2.7, recurringSavingsMonthly: 300, credits: [{ id: 'maison', kind: 'healthy', remaining: 186000, borrowed: 230000 }] }),
  marc: person({ currentBalance: 2300, monthlyReference: 2300, securityMonths: 3, enjoyThisMonth: 200 }),
  nadia: person({ currentBalance: 300, monthlyReference: 2800, securityMonths: 0, enjoyThisMonth: 400 }),
  pierre: person({ currentBalance: 15000, monthlyReference: 2000, securityMonths: 42 }),
  hugo: person({ currentBalance: 200, monthlyReference: 1500, securityMonths: 0, investedValue: 6000, investedContributed: 5000, recurringInvestMonthly: 150 }),
  aicha: person({ currentBalance: 3100, monthlyReference: 3500, securityMonths: 4, investedValue: 2000, investedContributed: 1800, credits: [{ id: 'maison', kind: 'healthy', remaining: 150000, borrowed: 300000 }] }),
  jean: person({ currentBalance: 700, monthlyReference: 2400, securityMonths: 1, credits: [{ id: 'maison', kind: 'healthy', remaining: 90000, borrowed: 200000 }] }),
};

describe('computeTreeState — les 10 personnes', () => {
  const S = Object.fromEntries(Object.entries(PEOPLE).map(([k, v]) => [k, computeTreeState(v)]));

  it('ne produit jamais de valeur invalide ni d\'état de maladie', () => {
    Object.values(S).forEach((s) => {
      const json = JSON.stringify(s).replace(/"cabin":null/, "");
      expect(json).not.toMatch(/null|NaN|Infinity/);
      expect(Object.keys(s)).not.toEqual(expect.arrayContaining(['health']));
      expect(json).not.toMatch(/sick|rot|dead|tilt|fallen/i);
    });
  });

  it('Camille : jeune arbre, racines au-delà du 1er mois, cabane à 57 %, fleurs, arrosage régulier', () => {
    const s = S.camille;
    expect(s.stage).toBe('young');
    expect(s.roots.marks).toEqual({ one: true, three: false, six: false });
    expect(s.cabin?.progress).toBeCloseTo(0.57, 2);
    expect(s.flowers).toBeGreaterThan(0);
    expect(s.drip.roots).toBe(true);
    expect(s.rings).toBe(6);
    expect(s.brambles).toBe(0);
  });

  it('Karim : une pousse, arrosoir vide, des ronces — et rien d\'autre de négatif', () => {
    const s = S.karim;
    expect(s.stage).toBe('sprout');
    expect(s.water).toBe(0);
    expect(s.brambles).toBeGreaterThan(0);
    expect(s.fruits).toBe(0);
  });

  it('Pierre : la nappe au-delà de 6 mois, 36 mois en plus', () => {
    expect(S.pierre.roots.beyondSix).toBe(true);
    expect(S.pierre.roots.extraMonths).toBe(36);
    expect(S.pierre.roots.depth).toBe(1);
  });

  it('Hugo : un placement en gain = un fruit mûr, des racines encore courtes', () => {
    expect(S.hugo.fruits).toBe(1);
    expect(S.hugo.ripe).toBe(true);
    expect(S.hugo.branches).toBeGreaterThan(0);
    expect(S.hugo.roots.depth).toBe(0);
    expect(S.hugo.drip.branches).toBe(true);
  });

  it('Thomas et Julie : cabane de la maison encore en construction, arrosage régulier', () => {
    expect(S.couple.cabin?.progress).toBeLessThan(0.3);
    expect(S.couple.drip.roots).toBe(true);
  });

  it('Nadia : pas de racines mais des fleurs (elle se fait plaisir)', () => {
    expect(S.nadia.roots.months).toBe(0);
    expect(S.nadia.flowers).toBe(4);
    expect(S.nadia.flowers).toBeGreaterThan(S.sophie.flowers);
  });
});

describe('computeTreeState — règles générales', () => {
  it('l\'arbre grandit avec l\'épargne de secours, sans jamais rapetisser quand elle monte', () => {
    let prev = -1;
    for (const m of [0, 0.5, 1, 2, 3, 6, 12]) {
      const g = computeTreeState(person({ securityMonths: m })).growth;
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });

  it("l'arrosoir suit le Relyka : l'eau libre, pas le solde entier", () => {
    expect(computeTreeState(person({ currentBalance: 4000, relyka: 1000 })).water).toBeCloseTo(0.25, 5);
    expect(computeTreeState(person({ currentBalance: 4000, relyka: 0 })).water).toBe(0);
    expect(computeTreeState(person({ currentBalance: 4000, relyka: -300 })).water).toBe(0);
    expect(computeTreeState(person({ currentBalance: 4000, relyka: 9000 })).water).toBe(1);
  });

  it('un compte sous le minimum à garder donne un arrosoir vide, pas une alerte', () => {
    const s = computeTreeState(person({ currentBalance: 150, minimumToKeep: 200 }));
    expect(s.water).toBe(0);
  });

  it('pas de gain → le fruit reste jeune (jamais abîmé ni tombé)', () => {
    const s = computeTreeState(person({ investedValue: 4000, investedContributed: 5000 }));
    expect(s.fruits).toBe(1);
    expect(s.ripe).toBe(false);
  });

  it('un fruit par placement, avec des paliers 0 / 1 / 2 / 3 / 5+ / 10+', () => {
    const at = (n: number) => computeTreeState(person({ investedValue: n ? 5000 : 0, investedContributed: 4000, investmentCount: n }));
    expect([0, 1, 2, 3, 4, 5, 9, 10, 25].map((n) => at(n).fruitTier)).toEqual([0, 1, 2, 3, 3, 5, 5, 10, 10]);
    expect([0, 1, 2, 3, 4, 5, 9, 10, 25].map((n) => at(n).fruits)).toEqual([0, 1, 2, 3, 4, 6, 6, 10, 10]);
  });

  it('les ronces ne viennent que d\'un crédit cher', () => {
    expect(computeTreeState(person({ credits: [{ id: 'a', kind: 'healthy', remaining: 5000, borrowed: 8000 }] })).brambles).toBe(0);
    expect(computeTreeState(person({ credits: [{ id: 'b', kind: 'expensive', remaining: 100 }] })).brambles).toBeGreaterThan(0);
  });

  it('un crédit soldé ne dessine plus de cabane', () => {
    expect(computeTreeState(person({ credits: [{ id: 'a', kind: 'healthy', remaining: 0, borrowed: 8000 }] })).cabin).toBeNull();
  });

  it('plusieurs crédits sains = UNE cabane, avancement pondéré par les montants', () => {
    const s = computeTreeState(person({ credits: [
      { id: 'immo', kind: 'healthy', remaining: 180000, borrowed: 200000 },
      { id: 'ptz', kind: 'healthy', remaining: 10000, borrowed: 40000 },
      { id: 'travaux', kind: 'healthy', remaining: 0, borrowed: 15000 },
      { id: 'conso', kind: 'expensive', remaining: 3000, borrowed: 5000 },
    ] }));
    expect(s.cabin?.count).toBe(2);
    // (200 000 + 40 000 − 190 000) ÷ 240 000
    expect(s.cabin?.progress).toBeCloseTo(50000 / 240000, 4);
  });

  it('accepte une référence mensuelle inconnue sans planter', () => {
    const s = computeTreeState(person({ monthlyReference: 0, securityMonths: null, investedValue: 100, investedContributed: 50 }));
    expect(JSON.stringify(s)).not.toMatch(/NaN|Infinity/);
  });
});

describe('buildPicoChoices', () => {
  const recos = [
    { type: 'keep' as const, actionAmount: 224 },
    { type: 'save' as const, actionAmount: 320, recurringFit: { kind: 'sustainable' as const, monthly: 300 } },
    { type: 'enjoy' as const, actionAmount: 96 },
    { type: 'invest' as const, actionAmount: 0 },
  ];

  it('reprend les recommandations dans l\'ordre, sans celles à 0 €', () => {
    const c = buildPicoChoices(recos, { from: 'Compte perso', savingsTo: 'Livret A' });
    expect(c.map((x) => x.type)).toEqual(['save', 'enjoy', 'keep']);
    expect(c[0]).toMatchObject({ kind: 'transfer', part: 'roots', amount: 320, from: 'Compte perso', to: 'Livret A' });
    expect(c[0].text).toBe('Vire 320 € de Compte perso vers Livret A.');
    expect(c[1].kind).toBe('info');
    expect(c[2].text).toBe('224 € restent sur ton compte.');
  });

  it('nomme les comptes simplement quand ils sont inconnus', () => {
    const c = buildPicoChoices([{ type: 'save', actionAmount: 1250 }]);
    expect(c[0].text).toBe('Vire 1 250 € de ton compte courant vers ton épargne de secours.');
  });

  it('ne conseille un virement permanent que quand le moteur le juge tenable', () => {
    const c = buildPicoChoices(recos);
    expect(permanentTransferHint(c[0])).toContain('300 €');
    expect(permanentTransferHint(c[1])).toBeNull();
    const capped = buildPicoChoices([{ type: 'save', actionAmount: 320, recurringFit: { kind: 'capped', monthly: 100 } }]);
    expect(permanentTransferHint(capped[0])).toBeNull();
  });

  it('n\'invente aucun choix en dehors des quatre recommandations', () => {
    const c = buildPicoChoices(recos);
    c.forEach((x) => expect(['save', 'invest', 'enjoy', 'keep']).toContain(x.type));
  });
});

describe('buildScene', () => {
  const scene = (k: keyof typeof PEOPLE, extra = {}) => buildScene(computeTreeState(PEOPLE[k]), { id: k, ...extra });

  it('n\'utilise aucun filtre SVG (rendu identique Android, iOS, web)', () => {
    Object.keys(PEOPLE).forEach((k) => expect(scene(k as keyof typeof PEOPLE).svg).not.toMatch(/<filter|filter=/));
  });

  it('ne contient aucune valeur invalide', () => {
    Object.keys(PEOPLE).forEach((k) => expect(scene(k as keyof typeof PEOPLE).svg).not.toMatch(/NaN|undefined|Infinity/));
  });

  it('dessine la nappe pour Pierre, pas pour Camille', () => {
    expect(scene('pierre').svg).toContain('pierre-nappe');
    expect(scene('camille').svg).not.toContain('url(#camille-nappe)');
  });

  it('pose le toit de la cabane seulement quand le crédit est presque remboursé', () => {
    const roofless = buildScene(computeTreeState(person({ securityMonths: 2, credits: [{ id: 'a', kind: 'healthy', remaining: 6000, borrowed: 10000 }] })), { id: 'a' });
    const roofed = buildScene(computeTreeState(person({ securityMonths: 2, credits: [{ id: 'a', kind: 'healthy', remaining: 1000, borrowed: 10000 }] })), { id: 'b' });
    expect(roofless.svg).not.toContain('url(#a-roof)');
    expect(roofed.svg).toContain('url(#b-roof)');
  });

  it('expose les zones touchables des parties présentes', () => {
    const parts = scene('camille').hotspots.map((h) => h.part);
    expect(parts).toEqual(expect.arrayContaining(['can', 'roots', 'tree', 'cabin', 'pico']));
    expect(parts).not.toContain('brambles');
    expect(scene('karim').hotspots.map((h) => h.part)).toContain('brambles');
  });

  it('décrit la scène en français pour les lecteurs d\'écran', () => {
    expect(describeScene(computeTreeState(PEOPLE.pierre))).toContain('au-delà de 6 mois');
    expect(describeScene(computeTreeState(PEOPLE.camille))).toMatch(/cabane construite à 57 %/);
  });
});
