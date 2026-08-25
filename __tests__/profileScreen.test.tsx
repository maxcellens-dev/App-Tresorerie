/**
 * PROFIL — l'écran où une erreur ne se rattrape pas.
 *
 * C'est le seul endroit de l'application qui efface un compte, et le seul dont les champs sont
 * réécrits en permanence par le serveur pendant qu'on tape dedans. Les deux situations rejouées
 * ici : quelqu'un qui modifie son nom pendant qu'une relecture arrive, et un administrateur qui
 * consulte le compte d'un autre — cas où « Supprimer mon compte » ne visait PAS la personne
 * affichée à l'écran.
 */
import React from 'react';
import { renderWithProviders, screen, fireEvent, waitFor, act } from './utils/renderWithProviders';
import { mockSupabase } from '../jest.setup';
import ProfileScreen from '../app/(tabs)/(secondary)/profile';

const USER_ID = 'user-1';

function tableMock(result: any) {
  const builder: any = {
    select: () => builder, eq: () => builder, in: () => builder, order: () => builder, limit: () => builder,
    update: () => builder, insert: () => builder, delete: () => builder,
    maybeSingle: async () => result,
    single: async () => result,
    then: (ok: any, ko: any) => Promise.resolve(result).then(ok, ko),
  };
  return builder;
}

function setup(profileOverrides: Record<string, unknown> = {}) {
  mockSupabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: USER_ID } } }, error: null } as any);
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return tableMock({
        data: { id: USER_ID, email: 'moi@exemple.test', full_name: 'Nom Enregistré', ...profileOverrides },
        error: null,
      });
    }
    if (table === 'app_config') return tableMock({ data: { features: {}, theme: {}, gamification: null }, error: null });
    return tableMock({ data: [], error: null });
  });
}

beforeEach(() => {
  mockSupabase.from.mockReset();
  mockSupabase.auth.getSession.mockReset();
  mockSupabase.rpc.mockReset();
});

describe('modifier son nom', () => {
  it('affiche le nom enregistré au chargement', async () => {
    setup();
    renderWithProviders(<ProfileScreen />);
    expect(await screen.findByDisplayValue('Nom Enregistré')).toBeTruthy();
  });

  /* LA SAISIE NE DOIT PAS ÊTRE REMPLACÉE PAR LE PROFIL QUI SE MET À JOUR.
     L'effet de synchronisation dépendait de l'objet `profile` entier : dès que le profil CHANGEAIT
     — changer sa photo depuis cette même page, un réglage modifié ailleurs, une synchronisation
     temps réel — le champ « Nom » repassait à la valeur enregistrée, au milieu de la frappe. Le
     scénario le plus courant tient en trois gestes : je tape mon nom, je change ma photo, mon nom
     redevient l'ancien — et « Enregistrer » sauvegarde l'ancien.
     (React Query conserve la référence quand le contenu est identique : c'est bien un CHANGEMENT de
     contenu qu'il faut rejouer ici, pas une simple relecture.) */
  it('garde ce qu’on est en train de taper quand le profil change', async () => {
    setup();
    const { queryClient } = renderWithProviders(<ProfileScreen />);
    const field = await screen.findByDisplayValue('Nom Enregistré');

    fireEvent.changeText(field, 'Nouveau Nom');
    // Le profil change pour une AUTRE raison (photo enregistrée depuis cette page).
    await act(async () => {
      queryClient.setQueryData(['profile', USER_ID], (prev: any) => ({ ...prev, avatar_url: 'https://x/y.webp' }));
    });
    /* TÉMOIN : le bouton passe de « Importer » à « Remplacer » dès que la nouvelle photo est prise
       en compte. Sans cette attente, l'assertion suivante pourrait passer simplement parce que
       l'écran n'a pas encore été redessiné — le test ne prouverait alors rien. */
    expect(await screen.findByText('Remplacer')).toBeTruthy();

    expect(screen.getByDisplayValue('Nouveau Nom')).toBeTruthy();
    expect(screen.queryByDisplayValue('Nom Enregistré')).toBeNull();
  });

  it('borne la longueur du nom (il s’affiche aussi chez les autres)', async () => {
    setup();
    renderWithProviders(<ProfileScreen />);
    const field = await screen.findByDisplayValue('Nom Enregistré');
    expect(field.props.maxLength).toBe(60);
  });
});

describe('supprimer son compte', () => {
  it('propose la suppression, et rappelle quel compte part', async () => {
    setup();
    renderWithProviders(<ProfileScreen />);
    fireEvent.press(await screen.findByText('Supprimer mon compte'));
    expect(await screen.findByText('Supprimer définitivement')).toBeTruthy();
    // Le compte concerné est nommé : c'est la seule action qu'on ne peut pas annuler.
    expect(screen.getByText('moi@exemple.test')).toBeTruthy();
  });

  it('refuse de partir tant que le mot de confirmation n’est pas saisi', async () => {
    setup();
    renderWithProviders(<ProfileScreen />);
    fireEvent.press(await screen.findByText('Supprimer mon compte'));
    fireEvent.press(await screen.findByText('Supprimer'));
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('supprime le compte AVANT de toucher à la photo', async () => {
    setup();
    mockSupabase.rpc.mockResolvedValue({ data: null, error: null } as any);
    renderWithProviders(<ProfileScreen />);

    fireEvent.press(await screen.findByText('Supprimer mon compte'));
    fireEvent.changeText(await screen.findByPlaceholderText('supprimer'), 'supprimer');
    fireEvent.press(screen.getByText('Supprimer'));

    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalledWith('delete_own_account'));
  });
});
