import { getCurrentAction, type AppStateInputs } from '../lib/engagement/appStateEngine';

const base: AppStateInputs = {
  hasBalance: true, hasIncome: true, hasFixed: true,
  pendingClosureMonth: null, sharedModePrompt: null,
  confidenceLow: false, daysSinceVerification: 0, jointLow: null,
  relykaText: '220 €', closureEnabled: true, mainCheckingId: null,
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
      hasBalance: false,
      confidenceLow: true,
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
    expect(getCurrentAction({ ...base, hasBalance: false })?.type).toBe('setup');
    expect(getCurrentAction({ ...base, confidenceLow: true })?.type).toBe('check_balance');
  });
});
