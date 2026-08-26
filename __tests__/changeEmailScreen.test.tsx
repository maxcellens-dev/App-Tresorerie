/**
 * CHANGEMENT D'ADRESSE — l'écran.
 *
 * Ce qui se vérifie ici et nulle part ailleurs : que l'écran n'envoie RIEN sans avoir vérifié le
 * titulaire, et qu'il dit clairement que rien n'a encore changé tant que le lien n'est pas ouvert.
 * C'est le malentendu le plus courant de ce genre de formulaire — on croit son adresse changée, on
 * se déconnecte, et on ne peut plus rentrer.
 */
import React from 'react';
import { renderWithProviders, screen, fireEvent, waitFor } from './utils/renderWithProviders';
import { mockSupabase } from '../jest.setup';

/* `createURL` construit le lien de retour à partir du schéma déclaré dans la configuration native :
   hors application, elle n'a rien à lire. On la remplace par une valeur fixe — ce test porte sur la
   logique de l'écran, pas sur la fabrication de l'URL. */
jest.mock('expo-linking', () => ({
  createURL: (p: string) => `relyka-app://${p}`,
  addEventListener: () => ({ remove: () => {} }),
  getInitialURL: async () => null,
}));

import ChangeEmailScreen from '../app/(tabs)/(secondary)/change-email';

const USER_ID = 'user-1';
const CURRENT = 'moi@exemple.test';

function tableMock(result: any) {
  const builder: any = {
    select: () => builder, eq: () => builder, order: () => builder, limit: () => builder,
    update: () => builder, insert: () => builder,
    maybeSingle: async () => result,
    single: async () => result,
    then: (ok: any, ko: any) => Promise.resolve(result).then(ok, ko),
  };
  return builder;
}

/** `provider` : 'email' (mot de passe) ou 'google' (identité extérieure). */
function setup(provider: 'email' | 'google' = 'email') {
  mockSupabase.auth.getSession.mockResolvedValue({
    data: { session: { user: { id: USER_ID, email: CURRENT, identities: [{ provider }] } } },
    error: null,
  } as any);
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'profiles') return tableMock({ data: { id: USER_ID, email: CURRENT }, error: null });
    return tableMock({ data: table === 'app_config' ? { features: {}, theme: {} } : [], error: null });
  });
}

async function fill(email: string, password: string) {
  fireEvent.changeText(await screen.findByPlaceholderText('nouvelle@exemple.com'), email);
  fireEvent.changeText(screen.getByPlaceholderText('••••••••••••'), password);
  fireEvent.press(screen.getByText('Envoyer le lien de confirmation'));
}

beforeEach(() => {
  mockSupabase.from.mockReset();
  mockSupabase.auth.getSession.mockReset();
  mockSupabase.auth.updateUser.mockReset();
  mockSupabase.auth.signInWithPassword.mockReset();
});

describe('demander un changement d’adresse', () => {
  it('montre l’adresse actuelle et prévient que le changement n’est pas immédiat', async () => {
    setup();
    renderWithProviders(<ChangeEmailScreen />);
    expect(await screen.findByText(CURRENT)).toBeTruthy();
    expect(screen.getByText(/ne prend effet qu'une fois ce lien ouvert/)).toBeTruthy();
  });

  /* Le mot de passe n'est pas une formalité : sans lui, un téléphone déverrouillé laissé sur une
     table suffirait à détourner le compte (la nouvelle adresse reçoit ensuite les liens de
     récupération). */
  it('n’envoie rien sans le mot de passe actuel', async () => {
    setup();
    renderWithProviders(<ChangeEmailScreen />);
    fireEvent.changeText(await screen.findByPlaceholderText('nouvelle@exemple.com'), 'neuf@exemple.test');
    fireEvent.press(screen.getByText('Envoyer le lien de confirmation'));
    expect(await screen.findByText(/mot de passe actuel pour confirmer/)).toBeTruthy();
    expect(mockSupabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it('n’envoie rien si le mot de passe est faux, et le dit', async () => {
    setup();
    mockSupabase.auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } } as any);
    renderWithProviders(<ChangeEmailScreen />);

    await fill('neuf@exemple.test', 'mauvais');

    expect(await screen.findByText('Mot de passe incorrect.')).toBeTruthy();
    expect(mockSupabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it('refuse l’adresse déjà utilisée par le compte', async () => {
    setup();
    renderWithProviders(<ChangeEmailScreen />);
    await fill(CURRENT.toUpperCase(), 'bonmotdepasse');
    expect(await screen.findByText(/déjà ton adresse actuelle/)).toBeTruthy();
    expect(mockSupabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('envoie la demande, puis explique que rien ne change avant la confirmation', async () => {
    setup();
    mockSupabase.auth.signInWithPassword.mockResolvedValue({ data: { user: {} }, error: null } as any);
    mockSupabase.auth.updateUser.mockResolvedValue({ data: { user: {} }, error: null } as any);
    renderWithProviders(<ChangeEmailScreen />);

    await fill('  NEUF@Exemple.test ', 'bonmotdepasse');

    expect(await screen.findByText('Vérifie ta boîte mail')).toBeTruthy();
    // L'adresse est normalisée avant d'être envoyée au serveur.
    await waitFor(() => expect(mockSupabase.auth.updateUser).toHaveBeenCalledWith(
      { email: 'neuf@exemple.test' },
      expect.objectContaining({ emailRedirectTo: expect.any(String) }),
    ));
    /* Le lien de retour doit être une ROUTE RÉELLE : les groupes d'expo-router (les segments entre
       parenthèses) n'apparaissent pas dans une adresse, et une URL qui en contient ne correspond à
       rien — en plus de devoir être déclarée telle quelle dans les redirections autorisées. */
    const redirect = mockSupabase.auth.updateUser.mock.calls[0][1].emailRedirectTo as string;
    expect(redirect).not.toMatch(/[()]|%28|%29/);
    expect(redirect).toMatch(/profile$/);
    expect(screen.getByText(/rien ne change/)).toBeTruthy();
  });
});

describe('compte Google', () => {
  /* Remplacer l'adresse d'un compte Google ne changerait pas la façon de se connecter : on la
     mettrait seulement en désaccord avec l'identité qui l'authentifie. */
  it('n’offre pas le formulaire, et explique où aller', async () => {
    setup('google');
    renderWithProviders(<ChangeEmailScreen />);
    expect(await screen.findByText(/connexion Google/)).toBeTruthy();
    expect(screen.queryByPlaceholderText('nouvelle@exemple.com')).toBeNull();
  });
});
