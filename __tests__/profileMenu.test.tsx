/**
 * MENU DU COMPTE (l'avatar de l'en-tête) — components/ui/ProfileMenuModal.
 *
 * Ce menu est, sur téléphone, le SEUL chemin vers Plan, Boutique, Succès, Paramètres, Support et la
 * déconnexion. Les trois choses vérifiées ici sont celles qui, en cassant, rendent une page ou une
 * action inatteignable sans que rien ne signale la panne.
 */
import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { renderWithProviders, screen, fireEvent, waitFor } from './utils/renderWithProviders';
import { mockSupabase, mockRouter } from '../jest.setup';
import ProfileMenuModal from '../components/ui/ProfileMenuModal';

const USER_ID = 'user-1';

function tableMock(result: any) {
  const builder: any = {
    select: () => builder, eq: () => builder, in: () => builder, order: () => builder, limit: () => builder,
    update: () => builder, upsert: () => builder,
    maybeSingle: async () => result,
    single: async () => result,
    then: (ok: any, ko: any) => Promise.resolve(result).then(ok, ko),
  };
  return builder;
}

function setupData({ isPremium = false, premiumEnabled = true } = {}) {
  mockSupabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: USER_ID } } }, error: null } as any);
  mockSupabase.from.mockImplementation((table: string) => {
    switch (table) {
      case 'profiles':
        return tableMock({ data: { id: USER_ID, full_name: 'Alex', theme_mode: 'dark', is_premium: isPremium }, error: null });
      case 'app_config':
        return tableMock({ data: { features: { premium_enabled: premiumEnabled }, theme: {}, gamification: null }, error: null });
      default:
        return tableMock({ data: [], error: null });
    }
  });
}

beforeEach(() => {
  mockSupabase.from.mockReset();
  mockSupabase.auth.getSession.mockReset();
});

it('donne accès à toutes ses destinations, déconnexion comprise', async () => {
  setupData();
  renderWithProviders(<ProfileMenuModal visible onClose={() => {}} />);
  for (const label of ['Mon Profil', 'Apparence', 'Reporting', 'Conseils Intelligents', 'Succès', 'Boutique', 'Plan', 'Paramètres', 'Support']) {
    expect(await screen.findByText(label)).toBeTruthy();
  }
  expect(screen.getByText('Se déconnecter')).toBeTruthy();
});

/* LE PANNEAU DÉBORDAIT DE L'ÉCRAN. Seule la liste des entrées était plafonnée : « Se déconnecter »
   et le pied de page tombaient hors champ, sans défilement possible — sur un petit téléphone, et
   sur n'importe lequel en mode paysage (l'app n'est pas verrouillée en portrait). */
it('ne dépasse jamais la hauteur de la fenêtre', async () => {
  setupData();
  const Probe = () => {
    const { height } = useWindowDimensions();
    return <ProfileMenuModal visible onClose={() => {}} key={height} />;
  };
  renderWithProviders(<Probe />);
  const panel = await screen.findByTestId('profile-menu-panel');
  const flat = StyleSheet.flatten(panel.props.style) as any;
  expect(typeof flat.maxHeight).toBe('number');
  // La fenêtre de test fait 1334 de haut (jest-expo) ; le panneau démarre 70 px sous le bord.
  expect(flat.maxHeight).toBeLessThanOrEqual(1334 - 70);
});

/* Une entrée de menu REVIENT sur une page ; elle n'empile pas une n-ième copie de l'écran. */
it('navigue (sans empiler) et referme le menu', async () => {
  setupData();
  const onClose = jest.fn();
  renderWithProviders(<ProfileMenuModal visible onClose={onClose} />);
  fireEvent.press(await screen.findByText('Plan'));
  expect(onClose).toHaveBeenCalled();
  expect(mockRouter.navigate).toHaveBeenCalledWith('/(tabs)/(secondary)/premium');
  expect(mockRouter.push).not.toHaveBeenCalled();
});

/* L'étoile signale « réservé aux abonnés » : elle n'a de sens que pour un non-abonné, et seulement
   une fois le plan CONNU (sinon elle clignote sur les entrées d'un abonné à chaque ouverture). */
it('ne montre pas l’étoile « Premium » à un abonné', async () => {
  setupData({ isPremium: true });
  renderWithProviders(<ProfileMenuModal visible onClose={() => {}} />);
  await waitFor(() => expect(screen.getByText('Premium')).toBeTruthy()); // l'étiquette du profil
  expect(screen.queryAllByTestId('premium-star')).toHaveLength(0);
});
