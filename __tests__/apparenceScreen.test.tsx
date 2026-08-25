/**
 * APPARENCE — l'écran réel, monté avec des données réalistes.
 *
 * Les règles sont testées à part (apparence.test.ts). Ici on vérifie ce qui ne se voit qu'une fois
 * l'écran assemblé : ce qu'il ÉCRIT sans qu'on lui ait rien demandé, et ce qu'il AFFICHE quand les
 * réponses ne sont pas encore arrivées. C'est là que se cachait la perte de la couleur
 * personnalisée : aucune erreur, aucun clic — juste une page qui s'ouvre.
 */
import React from 'react';
import { renderWithProviders, screen, waitFor } from './utils/renderWithProviders';
import { mockSupabase } from '../jest.setup';
import AppearanceScreen from '../app/(tabs)/(secondary)/apparence';

const USER_ID = 'user-1';
const CUSTOM = '#FF5733';

/** Écritures parties vers `profiles` pendant le test (remplies par le faux client ci-dessous). */
const writes: { table: string; payload: any }[] = [];

/** Réponse Supabase chaînable : `.select().eq().maybeSingle()`, `.update()` et `await` direct. */
function tableMock(table: string, result: any) {
  const builder: any = {
    select: () => builder, eq: () => builder, in: () => builder, order: () => builder, limit: () => builder,
    // `update` DOIT exister : sans elle, une écriture lèverait « update is not a function » et le
    // test passerait pour la mauvaise raison — en croyant qu'aucune écriture n'est partie.
    update: (payload: any) => { writes.push({ table, payload }); return builder; },
    upsert: (payload: any) => { writes.push({ table, payload }); return builder; },
    maybeSingle: async () => result,
    single: async () => result,
    then: (ok: any, ko: any) => Promise.resolve(result).then(ok, ko),
  };
  return builder;
}

/** `premiumEnabled` pilote le drapeau global ; `flagsFail` simule une lecture qui n'aboutit pas. */
function setupData({ premiumEnabled = true, flagsFail = false } = {}) {
  mockSupabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: USER_ID } } }, error: null } as any);
  mockSupabase.from.mockImplementation((table: string) => {
    switch (table) {
      case 'profiles':
        return tableMock(table, { data: { id: USER_ID, theme_mode: 'dark', theme_preset: CUSTOM, is_premium: true }, error: null });
      case 'app_config':
        return tableMock(table, flagsFail
          ? { data: null, error: { message: 'réseau' } }
          : { data: { features: { premium_enabled: premiumEnabled }, theme: {}, gamification: null }, error: null });
      case 'user_gamification':
        return tableMock(table, { data: { profile_id: USER_ID, streak: 0, gems: 0 }, error: null });
      default: // user_badges, user_inventory…
        return tableMock(table, { data: [], error: null });
    }
  });
}

/** Ce qui est réellement parti en écriture sur le profil. */
const profileWrites = () => writes.filter((w) => w.table === 'profiles');

beforeEach(() => {
  writes.length = 0;
  mockSupabase.from.mockReset();
  mockSupabase.auth.getSession.mockReset();
});

describe('ouverture de la page', () => {
  it('affiche ses trois rayons', async () => {
    setupData();
    renderWithProviders(<AppearanceScreen />);
    expect(await screen.findByText("Mode d'affichage")).toBeTruthy();
    expect(screen.getByText("Couleur d'accent")).toBeTruthy();
    expect(screen.getByText('Couleur personnalisée')).toBeTruthy();
  });

  /* LA RÉGRESSION À NE PLUS JAMAIS REFAIRE.
     La page remettait l'accent par défaut dès qu'elle croyait l'abonnement terminé — et elle le
     croyait tant que les drapeaux d'offre n'étaient pas revenus. Ouvrir la page suffisait donc à
     effacer, EN BASE, la couleur d'un abonné. */
  it('n’écrit RIEN toute seule quand un abonné ouvre la page avec une couleur personnalisée', async () => {
    setupData({ premiumEnabled: true });
    renderWithProviders(<AppearanceScreen />);
    await screen.findByText("Mode d'affichage");
    await waitFor(() => expect(screen.getByDisplayValue(CUSTOM)).toBeTruthy());
    expect(profileWrites()).toHaveLength(0);
  });

  it('n’écrit rien non plus quand les réglages d’offre ne répondent pas', async () => {
    setupData({ flagsFail: true });
    renderWithProviders(<AppearanceScreen />);
    await screen.findByText("Mode d'affichage");
    await new Promise((r) => setTimeout(r, 50));
    expect(profileWrites()).toHaveLength(0);
  });

  /* Le champ était rempli une seule fois, avant l'arrivée du profil : il affichait « #000000 » à
     quelqu'un dont l'accent est un rouge personnalisé. */
  it('montre dans le champ la couleur réellement appliquée', async () => {
    setupData();
    renderWithProviders(<AppearanceScreen />);
    await screen.findByText("Mode d'affichage");
    await waitFor(() => expect(screen.getByDisplayValue(CUSTOM)).toBeTruthy());
    expect(screen.queryByDisplayValue('#000000')).toBeNull();
  });
});
