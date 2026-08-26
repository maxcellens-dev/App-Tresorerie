/**
 * CATÉGORIES — l'écran réel, monté avec des données réalistes.
 *
 * Ce qu'on protège ici ne se voit qu'une fois l'écran assemblé : ce qu'il ÉCRIT TOUT SEUL à
 * l'ouverture. La page amorce le jeu de catégories par défaut quand le compte n'en a aucune ; la
 * condition d'origine était « pas en chargement et liste vide ». Or une lecture EN ÉCHEC laisse
 * elle aussi la liste vide : ouvrir la page hors réseau rejouait donc tout le jeu par défaut
 * PAR-DESSUS celui déjà en base — et la table n'a aucune contrainte d'unicité, donc chaque
 * catégorie se retrouvait en double, définitivement.
 */
import React from 'react';
import { renderWithProviders, screen, waitFor } from './utils/renderWithProviders';
import { mockSupabase } from '../jest.setup';
import CategoriesScreen from '../app/(tabs)/(secondary)/categories';

const USER_ID = 'user-1';

/** Insertions parties vers `categories` pendant le test. */
const inserts: any[] = [];

/** Réponse Supabase chaînable : select/eq/order/in… puis `await` direct ou `.single()`. */
function tableMock(table: string, result: any) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    update: () => builder,
    delete: () => builder,
    insert: (payload: any) => { if (table === 'categories') inserts.push(payload); return builder; },
    upsert: () => builder,
    maybeSingle: async () => result,
    single: async () => result,
    then: (ok: any, ko: any) => Promise.resolve(result).then(ok, ko),
  };
  return builder;
}

/** `categoriesFail` : la lecture des catégories n'aboutit pas (réseau, jeton pas prêt). */
function setupData({ categoriesFail = false, uid = USER_ID }: { categoriesFail?: boolean; uid?: string } = {}) {
  mockSupabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: uid } } }, error: null } as any);
  mockSupabase.from.mockImplementation((table: string) => {
    switch (table) {
      case 'profiles':
        return tableMock(table, { data: { id: uid, theme_mode: 'dark', is_admin: false }, error: null });
      case 'categories':
        return tableMock(table, categoriesFail
          ? { data: null, error: { message: 'réseau indisponible' } }
          : { data: [], error: null });
      case 'base_categories':
        // Référentiel admin : deux catégories de base, de quoi rendre un amorçage visible.
        return tableMock(table, { data: [{ id: 'b1', name: 'Logement', type: 'expense', parent_id: null, is_variable: false, sort_order: 10 }], error: null });
      default:
        return tableMock(table, { data: [], error: null });
    }
  });
}

beforeEach(() => {
  inserts.length = 0;
  mockSupabase.from.mockReset();
  mockSupabase.auth.getSession.mockReset();
});

describe('amorçage automatique des catégories par défaut', () => {
  /* LA RÉGRESSION À NE PLUS JAMAIS REFAIRE : une lecture ratée ne doit RIEN écrire. */
  it("n'écrit aucune catégorie quand la lecture échoue", async () => {
    setupData({ categoriesFail: true });
    renderWithProviders(<CategoriesScreen />);
    await screen.findByText('Catégories');
    await new Promise((r) => setTimeout(r, 60));
    expect(inserts).toHaveLength(0);
  });

  it("le dit au lieu d'annoncer « aucune catégorie »", async () => {
    setupData({ categoriesFail: true });
    renderWithProviders(<CategoriesScreen />);
    expect(await screen.findByText(/n'ont pas pu être chargées/i)).toBeTruthy();
    expect(screen.queryByText('Aucune catégorie de dépense.')).toBeNull();
    // Et surtout : le bouton qui recréerait un second jeu complet n'est pas proposé.
    expect(screen.queryByText('Charger les catégories par défaut')).toBeNull();
  });

  it('amorce bien quand la lecture réussit et que le compte est réellement vide', async () => {
    setupData({ categoriesFail: false });
    renderWithProviders(<CategoriesScreen />);
    await screen.findByText('Catégories');
    await waitFor(() => expect(inserts.length).toBeGreaterThan(0));
    expect(inserts[0]).toMatchObject({ profile_id: USER_ID, name: 'Logement' });
  });

  /* TROIS écrans sèment les catégories par défaut (le guide de démarrage, cette page, le Plan de
     trésorerie) et chacun avait son propre drapeau « une seule fois », aveugle aux deux autres.
     Deux d'entre eux montés avant la relecture → deux jeux complets, donc tout en double et sans
     contrainte d'unicité en base pour l'empêcher. Le verrou vit désormais DANS la mutation
     (hooks/data/useCategories) : peu importe qui la déclenche, elle ne part qu'une fois. */
  it("ne sème pas deux fois quand deux écrans le demandent en même temps", async () => {
    // Compte DISTINCT : le verrou est par compte et vit toute la session (c'est voulu).
    setupData({ categoriesFail: false, uid: 'user-concurrent' });
    renderWithProviders(<CategoriesScreen />);
    await screen.findByText('Catégories');
    await waitFor(() => expect(inserts.length).toBeGreaterThan(0));
    const afterFirst = inserts.length;

    // Un second écran monte pendant que la relecture n'a pas encore ramené les catégories.
    renderWithProviders(<CategoriesScreen />);
    await screen.findAllByText('Catégories');
    await new Promise((r) => setTimeout(r, 80));
    expect(inserts.length).toBe(afterFirst);
  });
});
