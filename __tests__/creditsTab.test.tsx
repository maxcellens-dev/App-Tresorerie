/**
 * Onglet « Crédits » — la synthèse du haut, montée pour de vrai.
 *
 * Ce qui se joue ici ne se voit dans aucun moteur pur : ce sont les chiffres TELS QUE LUS.
 *  • les trois composantes affichées s'additionnent EXACTEMENT au « reste à payer » imprimé
 *    (l'assurance manquait à l'écran : l'addition ne tombait jamais, et le bandeau passait pour faux) ;
 *  • l'avancement de l'anneau est bien la part DÉJÀ PAYÉE de ce qui sortira en tout ;
 *  • la mensualité cumulée ne compte QUE les crédits qui ont encore une échéance devant eux ;
 *  • les ÉVÉNEMENTS d'un crédit (remboursement anticipé) arrivent bien jusqu'à cet écran, qui les
 *    ignorait complètement — il affichait le plan d'origine pendant que la fiche du crédit, elle,
 *    montrait le capital réellement restant ;
 *  • un crédit désactivé sort des totaux EN LE DISANT (pastille + « hors total » + note).
 */
import { renderWithProviders, screen } from './utils/renderWithProviders';
import { addMonthsISO } from '../lib/finance/amortization';
import { todayISO } from '../lib/dateUtils';

let mockCredits: any[] = [];
let mockEvents: Record<string, any[]> = {};

jest.mock('../hooks/data/useCredits', () => ({ useCredits: () => ({ data: mockCredits, isLoading: false }) }));
jest.mock('../hooks/data/useCreditEvents', () => ({ useAllCreditEvents: () => ({ data: mockEvents }) }));
jest.mock('../hooks/data/useSharedCredits', () => ({
  useCreditInvitations: () => ({ data: [] }),
  useRespondCreditInvitation: () => ({ mutate: jest.fn(), isPending: false }),
  useSharedCreditsRealtime: () => {},
}));
jest.mock('../hooks/data/useAccounts', () => ({ useAllAccounts: () => ({ data: [{ id: 'acc1', currency: 'EUR' }] }) }));
jest.mock('../hooks/data/useCurrencyRates', () => ({ useCurrencyRates: () => ({ data: { EUR: 1 } }) }));
jest.mock('../hooks/data/useProfile', () => ({ useProfile: () => ({ data: { currency_code: 'EUR' } }) }));

import CreditsTab from '../components/credit/CreditsTab';

const today = todayISO();
/** Crédit en cours : première échéance il y a 3 ans, sur 20 ans. */
const credit = (over: any = {}) => ({
  id: 'c1', label: 'Résidence principale', type: 'immobilier', account_id: 'acc1',
  principal: 200000, duration_months: 240, rate_annual: 3.2, insurance_monthly: 30,
  start_date: addMonthsISO(today, -36), first_payment_date: addMonthsISO(today, -36),
  is_active: true, is_simulation: false, is_shared: false, _role: 'owner',
  ...over,
});

/** Montant lu à l'écran, ramené à un nombre (« 181 411 € » → 181411). */
const shown = (key: string): number => {
  const node = screen.getByTestId(`recap-${key}`);
  const text = Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children);
  return Number(text.replace(/[^\d]/g, ''));
};

beforeEach(() => { mockCredits = [credit()]; mockEvents = {}; });

describe('synthèse — l\'addition doit tomber', () => {
  it('capital + intérêts + assurance = reste à payer, au chiffre affiché près', () => {
    renderWithProviders(<CreditsTab userId="u1" />);
    expect(screen.getByText('Assurance restante')).toBeOnTheScreen();
    expect(shown('crd') + shown('interest') + shown('insurance')).toBe(shown('left'));
    expect(shown('crd')).toBeGreaterThan(0);
    expect(shown('insurance')).toBeGreaterThan(0);
  });

  /* Les tuiles font une demi-largeur : le libellé complet y tient sur tout écran. La grille à trois
     colonnes d'avant devait l'abréger en « Capital » sur téléphone — le mot « restant », qui dit
     précisément de quoi on parle, disparaissait au moment où la place manquait. */
  it('les libellés restent entiers, jamais abrégés', () => {
    renderWithProviders(<CreditsTab userId="u1" />);
    expect(screen.getByText('Capital restant')).toBeOnTheScreen();
    expect(screen.getByText('Intérêts restants')).toBeOnTheScreen();
    expect(screen.getByText('Assurance restante')).toBeOnTheScreen();
    expect(screen.queryByText('Capital')).toBeNull();
  });

  // Sans assurance, la tuile n'a rien à dire : la grille retombe à 3, toujours cohérente.
  it('sans assurance, la tuile disparaît et l\'addition tient encore', () => {
    mockCredits = [credit({ insurance_monthly: 0 })];
    renderWithProviders(<CreditsTab userId="u1" />);
    expect(screen.queryByTestId('recap-insurance')).toBeNull();
    expect(shown('crd') + shown('interest')).toBe(shown('left'));
  });
});

describe('avancement et mensualité', () => {
  /* L'anneau dit la PROPORTION que les six chiffres ne donnent pas : la part déjà versée du coût
     total (intérêts et assurance compris), et non du seul capital. */
  it('le pourcentage de l\'anneau est la part déjà payée du total engagé', () => {
    renderWithProviders(<CreditsTab userId="u1" />);
    const paid = shown('paid');
    const attendu = Math.round((paid / (paid + shown('left'))) * 100);
    expect(shown('pct')).toBe(attendu);
    expect(shown('pct')).toBeGreaterThan(0);
    expect(shown('pct')).toBeLessThan(100);
  });

  it('la mensualité cumule les crédits en cours', () => {
    const solo = renderWithProviders(<CreditsTab userId="u1" />);
    const un = shown('monthly');
    expect(un).toBeGreaterThan(0);
    solo.unmount();

    mockCredits = [credit(), credit({ id: 'c2', label: 'Voiture' })];
    renderWithProviders(<CreditsTab userId="u1" />);
    // À l'euro d'arrondi près : on somme les mensualités RÉELLES puis on arrondit une seule fois,
    // donc 2 × arrondi(1 159,45) ≠ arrondi(2 318,90).
    expect(Math.abs(shown('monthly') - un * 2)).toBeLessThanOrEqual(1);
  });

  /* `nextPaymentAtDate` retombe sur la mensualité NOMINALE quand tout est remboursé — un repli utile
     sur la fiche d'un crédit (ordre de grandeur), mais faux dans une somme : un crédit soldé ne
     prélève plus rien, il ne doit rien ajouter au prélèvement du mois prochain. */
  it('un crédit soldé n\'ajoute rien à la mensualité', () => {
    mockCredits = [credit({ start_date: addMonthsISO(today, -300), first_payment_date: addMonthsISO(today, -300) })];
    renderWithProviders(<CreditsTab userId="u1" />);
    expect(shown('left')).toBe(0);
    expect(shown('monthly')).toBe(0);
  });
});

describe('événements du crédit', () => {
  /* Le défaut : cet écran appelait le moteur d'amortissement SANS les événements. Un remboursement
     anticipé enregistré laissait le bandeau sur le plan d'origine — ~31 000 € d'écart de capital
     restant, en contradiction avec la fiche du crédit ouverte juste à côté. */
  it('un remboursement anticipé passé fait baisser le capital restant', () => {
    const { unmount } = renderWithProviders(<CreditsTab userId="u1" />);
    const sansEvent = shown('crd');
    unmount();

    mockEvents = { c1: [{ date: addMonthsISO(today, -12), kind: 'early_repayment', amount: 30000 }] };
    renderWithProviders(<CreditsTab userId="u1" />);
    expect(shown('crd')).toBeLessThan(sansEvent - 29000);
    expect(shown('crd') + shown('interest') + shown('insurance')).toBe(shown('left'));
  });
});

describe('crédits hors total', () => {
  it('un crédit désactivé sort des totaux, et le dit', () => {
    // Référence : le crédit actif, seul (posé par le beforeEach).
    const solo = renderWithProviders(<CreditsTab userId="u1" />);
    const seul = shown('left');
    solo.unmount();

    mockCredits = [credit(), credit({ id: 'c2', label: 'Voiture', type: 'auto', is_active: false })];
    renderWithProviders(<CreditsTab userId="u1" />);
    expect(screen.getByText(/1 crédit est désactivé ou en simulation/)).toBeOnTheScreen();
    expect(screen.getByText(/· hors total/)).toBeOnTheScreen(); // la LIGNE le dit aussi
    expect(shown('left')).toBe(seul);                          // et le total ne bouge pas
  });
});
