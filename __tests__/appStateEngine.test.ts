import { getCurrentAction, type AppStateInputs } from '../lib/engagement/appStateEngine';

const base: AppStateInputs = {
  hasIncome: true, hasFixed: true,
  pendingClosureMonth: null, sharedModePrompt: null,
  jointLow: null, closureEnabled: true,
};

describe('appStateEngine — proposition de verrouillage biométrique', () => {
  it("n'est pas proposée tant que offerAppLock est faux", () => {
    // Plus rien à signaler → AUCUN bandeau (le cas « ok » a été retiré : un bandeau positif
    // n'appelait aucun geste et occupait le haut de l'écran pour rien).
    expect(getCurrentAction(base)).toBeNull();
  });

  it('passe AVANT tous les autres signaux (elle n’est proposée qu’une fois)', () => {
    const noisy: AppStateInputs = {
      ...base,
      offerAppLock: true,
      hasIncome: false,
      pendingClosureMonth: '2026-06',
      jointLow: { accountId: 'a', name: 'Compte commun' },
    };
    expect(getCurrentAction(noisy)?.type).toBe('app_lock');
  });

  it('est cliquable sans navigation (action dans l’app, pas de deeplink)', () => {
    const a = getCurrentAction({ ...base, offerAppLock: true });
    expect(a?.interactive).toBe(true);
    expect(a?.deeplink).toBeUndefined();
    expect(a?.positive).toBeFalsy();       // pas d'auto-effacement : reste jusqu'à fermeture manuelle
    expect(a?.dismissKey).toBe('app_lock');
  });

  it('une fois traitée, les autres signaux reprennent leur ordre normal', () => {
    expect(getCurrentAction({ ...base, hasIncome: false })?.type).toBe('setup');
    expect(getCurrentAction({ ...base, pendingClosureMonth: '2026-06' })?.type).toBe('soft_close');
  });
});

describe('appStateEngine — le SOLDE ne fait jamais l’objet d’un bandeau', () => {
  /* La carte « Ton Relyka » signale déjà l'estimation et propose la mise à jour, là où le chiffre
     se lit. Vérifier son solde en fin de mois — ou plus tard — reste le choix de l'utilisateur :
     aucun overlay ne doit le réclamer. */
  it("ne propose rien quand aucun solde n'est renseigné", () => {
    expect(getCurrentAction(base)).toBeNull();
  });

  it('laisse passer les autres signaux sans jamais parler de solde', () => {
    const a = getCurrentAction({ ...base, hasFixed: false });
    expect(a?.type).toBe('setup');
    expect(a?.title).not.toMatch(/solde/i);
  });
});
