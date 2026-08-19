import {
  computeProfileFromData,
  PROFILE_ALLOCATIONS,
  PROFILE_INFO,
  PROFILE_TO_TIER,
  FINANCIAL_PROFILE_IDS,
  PROFILE_TRANSITION_KEYS,
  isMillionaire,
  resolveProfileId,
} from '../lib/finance/financialProfileEngine';

/**
 * Le profil P0–P9 ne dépend d'AUCUNE réponse déclarée : il se déduit du revenu constaté, de
 * l'épargne, de ce qui est mis de côté chaque mois, de ce qui est réellement placé — et, pour les
 * paliers hauts, du patrimoine présent sur les comptes suivis.
 *
 * DEUX AXES, DEUX RÉGIMES :
 *   • P1 → P6 : le MATELAS DE SÉCURITÉ (épargne ÷ revenu mensuel) ;
 *   • P7 → P9 : le PATRIMOINE BANCAIRE, parce qu'au-delà d'un certain montant « combien de mois
 *     tiendrais-tu ? » ne distingue plus personne (400 000 € font 200 mois, comme 800 000 €).
 * P0 n'est pas un jugement : c'est l'absence de données.
 */
const base = { availableSavings: 0, avgMonthlyIncome: 2000, monthlySetAside: 0, totalInvested: 0 };

describe('computeProfileFromData — le profil se déduit des données réelles', () => {
  /* AVANT : un compte sans revenu constaté était classé « épargne critique » — un DIAGNOSTIC servi
     à quelqu'un dont on ne savait rien. P0 dit ce qui est vrai, et il est neutre. */
  it('sans revenu constaté → P0 « Découverte », quel que soit le reste', () => {
    expect(computeProfileFromData({ ...base, avgMonthlyIncome: 0, availableSavings: 50000 })).toBe('P0');
    expect(computeProfileFromData({ ...base, avgMonthlyIncome: 0 })).toBe('P0');
  });

  it('compte neuf avec un revenu, mais rien de côté → P2 (sans découvert, ce n’est pas un déficit)', () => {
    expect(computeProfileFromData(base)).toBe('P2');
  });

  /* Le DÉCOUVERT est le seul signal que les ratios ne voient pas : sans lui, quelqu'un qui finit
     chaque mois dans le rouge recevait exactement les mêmes conseils que quelqu'un qui commence
     tout juste à épargner. */
  it('compte courant dans le rouge → P1 « Sortir du rouge »', () => {
    expect(computeProfileFromData({ ...base, checkingBalance: -420 })).toBe('P1');
  });

  it('le rouge ne l’emporte PAS sur une réserve constituée : c’est le dernier recours', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 4000, checkingBalance: -200 })).toBe('P3');
  });

  it('moins d’un mois mais ≥ 10 % mis de côté → P2', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 1000, monthlySetAside: 250 })).toBe('P2');
  });

  it('1 à 3 mois de sécurité → P3 « Réserve à construire »', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 4000 })).toBe('P3');
  });

  it('1 à 3 mois avec un fort taux d’épargne (≥ 20 %) → P4', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 4000, monthlySetAside: 450 })).toBe('P4');
  });

  it('3 à 6 mois et il met de côté → P4 « Équilibre trouvé »', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 8000, monthlySetAside: 100 })).toBe('P4');
  });

  it('plus de 6 mois, tout en liquide → P5 « Sécurité acquise »', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 20000 })).toBe('P5');
  });

  it('plus de 6 mois ET de l’argent réellement placé → P6 « Premiers placements »', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 20000, totalInvested: 5000 })).toBe('P6');
  });

  // ── Paliers de patrimoine ───────────────────────────────────────────────────────────────────
  it('30 000 € sur les comptes, avec des placements → P7', () => {
    expect(computeProfileFromData({
      ...base, availableSavings: 20000, totalInvested: 12000, totalLiquidWealth: 34000,
    })).toBe('P7');
  });

  it('100 000 € → P8, 300 000 € → P9, et le million est NOMMÉ comme tel', () => {
    expect(computeProfileFromData({
      ...base, availableSavings: 40000, totalInvested: 80000, totalLiquidWealth: 125000,
    })).toBe('P8');
    expect(computeProfileFromData({
      ...base, availableSavings: 60000, totalInvested: 300000, totalLiquidWealth: 380000,
    })).toBe('P9');
    expect(isMillionaire(1_200_000)).toBe(true);
    expect(isMillionaire(940_000)).toBe(false);
  });

  /* Garde-fou : un gros patrimoine SANS liquidité (tout investi, rien de mobilisable) n'est pas un
     profil « patrimoine ». On redescend sur l'échelle du matelas — c'est précisément le conseil
     dont cette personne a besoin. */
  it('patrimoine élevé mais aucune réserve disponible → on retombe sur l’échelle du matelas', () => {
    expect(computeProfileFromData({
      ...base, availableSavings: 0, totalInvested: 400000, totalLiquidWealth: 400000,
    })).toBe('P2');
  });

  it('le profil apparaît dès que la donnée manquante arrive (revenu renseigné)', () => {
    const sansRevenu = { availableSavings: 8000, avgMonthlyIncome: 0, monthlySetAside: 300, totalInvested: 0 };
    expect(computeProfileFromData(sansRevenu)).toBe('P0');
    // Même compte, une fois le revenu constaté : 8 000 ÷ 2 000 = 4 mois, 300 €/mois (15 %) → P4.
    expect(computeProfileFromData({ ...sansRevenu, avgMonthlyIncome: 2000 })).toBe('P4');
  });
});

/**
 * INVARIANTS DU RÉFÉRENTIEL. Ils tiennent en trois lignes et évitent la classe d'erreur la plus
 * coûteuse : une répartition qui ne fait pas 100 % distribue un Relyka faux à tout un palier, et
 * ça ne se voit qu'à l'euro près, sur un écran.
 */
describe('référentiel des profils — invariants', () => {
  it('chaque profil répartit exactement 100 % du Relyka', () => {
    for (const id of FINANCIAL_PROFILE_IDS) {
      const a = PROFILE_ALLOCATIONS[id];
      expect(`${id}:${a.save + a.invest + a.enjoy + a.keep}`).toBe(`${id}:100`);
    }
  });

  it('chaque profil a un libellé, un palier de vocabulaire et une allocation', () => {
    expect(FINANCIAL_PROFILE_IDS).toHaveLength(10);
    for (const id of FINANCIAL_PROFILE_IDS) {
      expect(PROFILE_INFO[id]?.name).toBeTruthy();
      expect(PROFILE_TO_TIER[id]).toBeTruthy();
      expect(PROFILE_ALLOCATIONS[id]).toBeTruthy();
    }
  });

  /* L'investissement ne doit jamais reculer quand on monte l'échelle, et l'épargne de précaution
     jamais progresser : c'est la promesse que la courbe raconte à l'utilisateur.
     DEUX EXCEPTIONS ASSUMÉES, hors de la comparaison :
       • P0 ne classe pas (absence de données) ;
       • P1 est déficitaire — lui demander d'épargner plus qu'un P2 serait absurde, son argent doit
         d'abord rester disponible. La courbe d'épargne part donc de P2. */
  it('l’investissement croît et l’épargne de précaution décroît le long de l’échelle', () => {
    const ranked = FINANCIAL_PROFILE_IDS.filter((p) => p !== 'P0');
    for (let i = 1; i < ranked.length; i++) {
      expect(PROFILE_ALLOCATIONS[ranked[i]].invest).toBeGreaterThanOrEqual(PROFILE_ALLOCATIONS[ranked[i - 1]].invest);
    }
    const savingLadder = ranked.filter((p) => p !== 'P1');
    for (let i = 1; i < savingLadder.length; i++) {
      expect(PROFILE_ALLOCATIONS[savingLadder[i]].save).toBeLessThanOrEqual(PROFILE_ALLOCATIONS[savingLadder[i - 1]].save);
    }
  });

  it('les transitions couvrent tous les paliers voisins, dans l’ordre', () => {
    expect(PROFILE_TRANSITION_KEYS).toEqual([
      'P1_P2', 'P2_P3', 'P3_P4', 'P4_P5', 'P5_P6', 'P6_P7', 'P7_P8', 'P8_P9',
    ]);
  });
});

/**
 * UN IDENTIFIANT VENU DE LA BASE N'EST PAS UNE PROMESSE.
 *
 * Une migration s'applique à la base AVANT que la nouvelle version du code n'atteigne les appareils.
 * Un client encore sur l'ancien bundle lit donc un palier qu'il ne connaît pas — et toutes les
 * tables indexées par profil (PROFILE_INFO, PROFILE_ALLOCATIONS, DEFAULT_PULSE_SIGNALS…) rendaient
 * `undefined`. C'est ce qui a mis l'état des lieux à terre : `undefined.filter(...)`, chez tout le
 * monde en même temps, sur un simple renommage de paliers.
 */
describe('resolveProfileId — aucun identifiant inconnu ne peut casser un écran', () => {
  it('laisse passer les identifiants du référentiel', () => {
    for (const id of FINANCIAL_PROFILE_IDS) expect(resolveProfileId(id)).toBe(id);
  });

  it('ramène un palier PLUS RÉCENT que ce bundle sur le plus haut connu', () => {
    expect(resolveProfileId('P12')).toBe('P9');
    expect(resolveProfileId('P10')).toBe('P9');
  });

  it('ramène l’absence ou l’illisible sur « Découverte » — ce qu’elle signifie', () => {
    expect(resolveProfileId(null)).toBe('P0');
    expect(resolveProfileId(undefined)).toBe('P0');
    expect(resolveProfileId('')).toBe('P0');
    expect(resolveProfileId('inconnu')).toBe('P0');
    expect(resolveProfileId('P-3')).toBe('P0');
  });

  it('toute valeur résolue indexe bien les trois tables du référentiel', () => {
    for (const raw of ['P12', 'inconnu', null, 'P0', 'P9', 'p4']) {
      const id = resolveProfileId(raw as any);
      expect(PROFILE_INFO[id]).toBeTruthy();
      expect(PROFILE_ALLOCATIONS[id]).toBeTruthy();
      expect(PROFILE_TO_TIER[id]).toBeTruthy();
    }
  });
});
