/**
 * MES DONNÉES — l'export RGPD, monté avec des données réalistes.
 *
 * Deux silences y coexistaient, et c'est le pire endroit pour ça :
 *   • chaque requête était lue en `?? []` — une seule lecture refusée produisait un fichier qui
 *     annonçait « TRANSACTIONS (0) », c'est-à-dire un export AMPUTÉ présenté comme complet ;
 *   • l'échec global ne partait qu'en console — le rouage tournait, s'arrêtait, et il ne se passait
 *     rien : ni fichier, ni message.
 */
import React from 'react';
import { renderWithProviders, screen, fireEvent, waitFor } from './utils/renderWithProviders';
import { mockSupabase } from '../jest.setup';
import MesDonneesScreen from '../app/(tabs)/(secondary)/mes-donnees';

const USER_ID = 'user-1';

function tableMock(result: any) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    update: () => builder,
    upsert: () => builder,
    insert: () => builder,
    maybeSingle: async () => result,
    single: async () => result,
    then: (ok: any, ko: any) => Promise.resolve(result).then(ok, ko),
  };
  return builder;
}

/** `failTable` : la table nommée refuse la lecture (réseau, jeton expiré). */
function setupData({ failTable = null as string | null } = {}) {
  mockSupabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: USER_ID } } }, error: null } as any);
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === failTable) return tableMock({ data: null, error: { message: 'réseau indisponible' } });
    switch (table) {
      case 'profiles':
        return tableMock({ data: { id: USER_ID, theme_mode: 'dark', currency_code: 'EUR', full_name: 'Alex' }, error: null });
      case 'accounts':
        return tableMock({ data: [{ id: 'a1', profile_id: USER_ID, name: 'Courant', type: 'checking', balance: 100, currency: 'EUR', is_active: true }], error: null });
      case 'user_gamification':
        return tableMock({ data: null, error: null });
      default:
        return tableMock({ data: [], error: null });
    }
  });
}

beforeEach(() => {
  mockSupabase.from.mockReset();
  mockSupabase.auth.getSession.mockReset();
});

describe('export des données personnelles', () => {
  it('affiche la page et son bouton', async () => {
    setupData();
    expect(await renderAndWait()).toBeTruthy();
  });

  /* LA RÉGRESSION À NE PLUS JAMAIS REFAIRE : une lecture ratée produisait un fichier incomplet,
     sans le dire. Elle interrompt désormais l'export, et l'écran l'annonce. */
  it("refuse de produire un fichier amputé quand une lecture échoue, et le dit", async () => {
    setupData({ failTable: 'transactions' });
    const btn = await renderAndWait();
    fireEvent.press(btn);
    await waitFor(() => expect(screen.getByText(/n'ont pas pu être lues/i)).toBeTruthy());
    // Et surtout : aucune confirmation de succès.
    expect(screen.queryByText('Export généré !')).toBeNull();
  });
});

/** Monte l'écran et rend le bouton d'export une fois les données de base chargées. */
async function renderAndWait() {
  renderWithProviders(<MesDonneesScreen />);
  await screen.findByText('Mes données');
  const btn = await screen.findByText('Exporter mes données');
  // Le bouton reste inerte tant que profil et comptes ne sont pas là.
  await waitFor(() => expect(screen.getByText(/1 compte/)).toBeTruthy());
  return btn;
}
