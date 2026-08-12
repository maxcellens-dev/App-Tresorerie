import {
  computeGuideStage, isGuideActive, isGuideInPlay, isInSetup, isTourJustFinished,
  type GuideInput,
} from '../lib/engagement/guideStages';

/** Compte neuf, données lues, rien de fait : le point de départ du parcours. */
const base = (over: Partial<GuideInput> = {}): GuideInput => ({
  hasProfile: true,
  isImpersonating: false,
  flags: { g2_started: true, g2_intro: true },
  appTourDone: false,
  discoveryIntroSeen: false,
  dataReady: true,
  accountsSettled: true,
  txSettled: true,
  accountsCount: 0,
  hasChecking: false,
  hasSavings: false,
  hasRecurring: false,
  ...over,
});

describe('parcours de démarrage — ordre des étapes', () => {
  it('déroule les étapes dans l\'ordre défini, une seule à la fois', () => {
    // 0. L'explication initiale passe avant tout, même avant la lecture des données.
    expect(computeGuideStage(base({ flags: { g2_started: true }, dataReady: false }))).toBe('intro');

    // 1. Aucun compte.
    let i = base();
    expect(computeGuideStage(i)).toBe('accounts');

    // 2. Des comptes, mais pas de compte courant.
    i = base({ accountsCount: 1, hasSavings: true });
    expect(computeGuideStage(i)).toBe('accounts_checking');

    // 3. Compte courant présent, pas d'épargne.
    i = base({ accountsCount: 1, hasChecking: true });
    expect(computeGuideStage(i)).toBe('accounts_savings');

    // 4. Récurrences.
    i = base({ accountsCount: 2, hasChecking: true, hasSavings: true });
    expect(computeGuideStage(i)).toBe('tx_recurring');

    // 5. Dépenses variables, puis marge — les deux derniers réglages.
    i = base({ accountsCount: 2, hasChecking: true, hasSavings: true, hasRecurring: true });
    expect(computeGuideStage(i)).toBe('pilotage_variable');

    i = base({
      accountsCount: 2, hasChecking: true, hasSavings: true, hasRecurring: true,
      flags: { g2_started: true, g2_intro: true, g2_variable: true },
    });
    expect(computeGuideStage(i)).toBe('pilotage_margin');

    // 6. Tout est fait → plus rien à demander.
    i = base({
      accountsCount: 2, hasChecking: true, hasSavings: true, hasRecurring: true,
      flags: { g2_started: true, g2_intro: true, g2_variable: true, g2_margin: true },
    });
    expect(computeGuideStage(i)).toBe('idle');
  });

  it('laisse passer l\'épargne quand l\'utilisateur a répondu « je n\'en ai pas »', () => {
    const i = base({
      accountsCount: 1, hasChecking: true,
      flags: { g2_started: true, g2_intro: true, g2_nudge_savings: true },
    });
    expect(computeGuideStage(i)).toBe('tx_recurring');
  });
});

describe('parcours de démarrage — ne jamais conclure sur une lecture non aboutie', () => {
  /* Le piège central : une liste VIDE peut vouloir dire « aucun compte »… ou « pas encore lu ».
     Confondre les deux renvoie quelqu'un créer un compte qu'il possède déjà. */
  it('n\'annonce pas « aucun compte » tant que les données ne sont pas lues', () => {
    expect(computeGuideStage(base({ dataReady: false }))).toBe('idle');
  });

  it('n\'annonce pas « aucun compte » tant que la lecture des comptes n\'est pas posée', () => {
    expect(computeGuideStage(base({ accountsSettled: false }))).toBe('idle');
  });

  it('n\'annonce pas « aucune récurrente » tant que la lecture des transactions n\'est pas posée', () => {
    const i = base({ accountsCount: 2, hasChecking: true, hasSavings: true, txSettled: false });
    expect(computeGuideStage(i)).toBe('idle');
  });
});

describe('parcours de démarrage — éligibilité', () => {
  it('ne se déclenche jamais sur un compte déjà installé', () => {
    // Traces d'anciens parcours : le guide ne doit pas revenir chez quelqu'un qui a fini le sien.
    expect(isGuideActive(base({ flags: {}, appTourDone: true }))).toBe(false);
    expect(isGuideActive(base({ flags: {}, discoveryIntroSeen: true }))).toBe(false);
    // …mais un compte réellement neuf, lui, entre dans le parcours sans drapeau préalable.
    expect(isGuideActive(base({ flags: {} }))).toBe(true);
  });

  it('reste actif tant qu\'il n\'est pas terminé, même une fois des comptes créés', () => {
    // C'est la garantie « un user qui n'a pas validé le process revoit les modaux » : une fois
    // `g2_started` posé, l'avancement ne dépend plus de l'absence de données.
    const i = base({ accountsCount: 3, hasChecking: true, hasSavings: true });
    expect(isGuideActive(i)).toBe(true);
    expect(computeGuideStage(i)).toBe('tx_recurring');
  });

  it('s\'arrête définitivement une fois terminé', () => {
    const i = base({ flags: { g2_started: true, g2_intro: true, g2_done: true } });
    expect(isGuideActive(i)).toBe(false);
    expect(isGuideInPlay(i)).toBe(false);
    expect(computeGuideStage(i)).toBe('idle');
  });

  it('ne pilote jamais l\'app en consultation admin (« connecté en tant que »)', () => {
    const i = base({ isImpersonating: true });
    expect(isGuideActive(i)).toBe(false);
    expect(isGuideInPlay(i)).toBe(false);
    expect(isTourJustFinished(base({ isImpersonating: true, flags: { g2_done: true } }))).toBe(false);
  });

  it('ne conclut rien tant que le profil n\'est pas chargé', () => {
    expect(isGuideActive(base({ hasProfile: false, flags: {} }))).toBe(false);
    expect(isGuideInPlay(base({ hasProfile: false, flags: {} }))).toBe(false);
  });
});

describe('parcours de démarrage — conséquences sur l\'affichage', () => {
  it('masque le tableau de bord tant que le Relyka n\'est pas calculable', () => {
    expect(isInSetup(base())).toBe(true);                                   // aucun compte
    expect(isInSetup(base({ accountsCount: 2, hasChecking: true, hasSavings: true }))).toBe(true); // pas de récurrente
    // Dès que comptes ET flux existent, le tableau de bord reprend sa place : les deux derniers
    // réglages se jouent PAR-DESSUS lui, pas à sa place.
    expect(isInSetup(base({ accountsCount: 2, hasChecking: true, hasSavings: true, hasRecurring: true }))).toBe(false);
  });

  it('ne présente le profil financier qu\'une seule fois, à la fin', () => {
    expect(isTourJustFinished(base({ flags: { g2_done: true } }))).toBe(true);
    expect(isTourJustFinished(base({ flags: { g2_done: true, g2_profile_shown: true } }))).toBe(false);
    expect(isTourJustFinished(base())).toBe(false); // parcours en cours : surtout pas maintenant
  });

  it('couvre l\'écran pendant le chargement d\'un compte neuf, jamais chez un compte installé', () => {
    expect(isGuideInPlay(base({ flags: {}, dataReady: false }))).toBe(true);
    expect(isGuideInPlay(base({ flags: {}, dataReady: false, appTourDone: true }))).toBe(false);
  });
});
