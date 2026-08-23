/**
 * Onglet « Crédits » — le bandeau de totaux, monté pour de vrai.
 *
 * Ce qui se joue ici ne se voit dans aucun moteur pur : ce sont les chiffres TELS QUE LUS.
 *  • les trois composantes affichées s'additionnent EXACTEMENT au « reste à payer » imprimé
 *    (l'assurance manquait à l'écran : l'addition ne tombait jamais, et le bandeau passait pour faux) ;
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
let mockCompact = false;

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
// Largeur PILOTÉE par le test : la grille se replie à 3 + 2 colonnes sur téléphone (libellés courts)
// et tient sur une seule ligne au-delà (libellés complets).
jest.mock('../hooks/theme/useResponsive', () => ({ useResponsive: () => ({ isCompact: mockCompact }) }));

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

beforeEach(() => { mockCredits = [credit()]; mockEvents = {}; mockCompact = false; });

describe('bandeau de totaux — l\'addition doit tomber', () => {
  it('capital + intérêts + assurance = reste à payer, au chiffre affiché près', () => {
    renderWithProviders(<CreditsTab userId="u1" />);
    expect(screen.getByText('Assurance restante')).toBeOnTheScreen();
    expect(shown('crd') + shown('interest') + shown('insurance')).toBe(shown('left'));
    expect(shown('crd')).toBeGreaterThan(0);
    expect(shown('insurance')).toBeGreaterThan(0);
  });

  /* Sur téléphone, la ligne à 3 colonnes n'a pas la place des libellés complets : ils y sont
     abrégés, et `adjustsFontSizeToFit` n'existant pas sur web, un libellé trop long serait
     simplement tronqué par `numberOfLines={1}`. Les cinq chiffres, eux, restent les mêmes. */
  it('sur téléphone, les libellés s\'abrègent et les chiffres ne bougent pas', () => {
    mockCompact = true;
    renderWithProviders(<CreditsTab userId="u1" />);
    expect(screen.getByText('Capital')).toBeOnTheScreen();
    expect(screen.getByText('Assurance')).toBeOnTheScreen();
    expect(screen.queryByText('Capital restant')).toBeNull();
    expect(screen.getByText('Reste à payer')).toBeOnTheScreen(); // ligne du bas : 2 cases, au large
    expect(shown('crd') + shown('interest') + shown('insurance')).toBe(shown('left'));
  });

  // Sans assurance, la case n'a rien à dire : la grille reprend sa forme d'avant, toujours cohérente.
  it('sans assurance, la case disparaît et l\'addition tient encore', () => {
    mockCredits = [credit({ insurance_monthly: 0 })];
    renderWithProviders(<CreditsTab userId="u1" />);
    expect(screen.queryByTestId('recap-insurance')).toBeNull();
    expect(shown('crd') + shown('interest')).toBe(shown('left'));
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
