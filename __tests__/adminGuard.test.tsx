/**
 * PANNEAU D'ADMINISTRATION — le contrôle d'accès vit sur le GABARIT, pas page par page.
 *
 * Seul l'accueil du panneau (`admin/index`) refusait les non-administrateurs. Les vingt et une
 * autres pages — utilisateurs, notifications de masse, centre de sécurité, éditeur de style — se
 * rendaient normalement pour n'importe quel compte connecté qui en tapait l'adresse. Les données
 * restaient protégées côté base, mais l'écran s'ouvrait : formulaires, listes, boutons d'envoi de
 * masse cliquables, et un refus technique à chaque geste.
 *
 * Ces tests figent les trois seules réponses acceptables du gabarit : on attend tant qu'on ne sait
 * pas, on refuse quand on sait que non, on ouvre quand on sait que oui.
 */
import React from 'react';
import { renderWithProviders, screen, waitFor } from './utils/renderWithProviders';
import { mockSupabase } from '../jest.setup';
import AdminLayout from '../app/(tabs)/(secondary)/admin/_layout';

const USER_ID = 'user-1';

function tableMock(result: any) {
  const builder: any = {
    select: () => builder, eq: () => builder, in: () => builder, order: () => builder, limit: () => builder,
    update: () => builder, upsert: () => builder, insert: () => builder,
    maybeSingle: async () => result,
    single: async () => result,
    then: (ok: any, ko: any) => Promise.resolve(result).then(ok, ko),
  };
  return builder;
}

function setupProfile({ isAdmin, fail = false }: { isAdmin: boolean; fail?: boolean }) {
  mockSupabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: USER_ID } } }, error: null } as any);
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return tableMock(fail
        ? { data: null, error: { message: 'réseau indisponible' } }
        : { data: { id: USER_ID, theme_mode: 'dark', is_admin: isAdmin }, error: null });
    }
    return tableMock({ data: [], error: null });
  });
}

beforeEach(() => {
  mockSupabase.from.mockReset();
  mockSupabase.auth.getSession.mockReset();
});

describe('accès au panneau d’administration', () => {
  /* LA RÉGRESSION À NE PLUS JAMAIS REFAIRE : un compte ordinaire ne doit pas voir l'outillage. */
  it('refuse un compte NON administrateur', async () => {
    setupProfile({ isAdmin: false });
    renderWithProviders(<AdminLayout />);
    expect(await screen.findByText('Accès réservé aux administrateurs.')).toBeTruthy();
  });

  /* `is_admin` vaut faux par DÉFAUT tant que le profil n'a pas répondu : refuser à ce moment-là
     mettrait un vrai administrateur dehors sur une connexion lente. On attend de savoir. */
  it("n'affirme rien tant que le profil n'a pas répondu", () => {
    setupProfile({ isAdmin: true });
    renderWithProviders(<AdminLayout />);
    expect(screen.queryByText('Accès réservé aux administrateurs.')).toBeNull();
  });

  it('laisse passer un administrateur', async () => {
    setupProfile({ isAdmin: true });
    renderWithProviders(<AdminLayout />);
    // Le refus ne doit jamais apparaître, même après que le profil soit arrivé.
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByText('Accès réservé aux administrateurs.')).toBeNull();
  });

  /* Lecture du profil EN ÉCHEC : l'accès n'est jamais accordé — `isAdmin` ne peut être vrai que
     si le profil l'a dit. L'écran reste alors sur son cercle d'attente plutôt que d'afficher le
     refus ; c'est une différence de présentation, pas de droit, et le banc d'essai ne permet pas
     de la distinguer (le gabarit ne rend rien d'observable une fois passé). Non testé ici, donc,
     mais garanti par la structure : aucun chemin ne rend la pile d'administration sans `isAdmin`. */
});
