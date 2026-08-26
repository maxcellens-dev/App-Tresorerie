/**
 * PLAN — l'écran réel (app/(tabs)/(secondary)/premium), monté avec des réponses réalistes.
 *
 * Ce qu'on vérifie ici ne se voit qu'une fois la page assemblée : ce qu'elle AFFIRME avant d'avoir
 * la réponse du serveur, et ce qu'elle continue d'offrir dans les états inconfortables (offre
 * coupée en administration alors que des gens payent encore).
 */
import React from 'react';
import { renderWithProviders, screen, waitFor } from './utils/renderWithProviders';
import { mockSupabase } from '../jest.setup';
import PlanScreen from '../app/(tabs)/(secondary)/premium';

const USER_ID = 'user-1';

/** Réponse Supabase chaînable : `.select().eq().maybeSingle()` et `await` direct. */
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

function setupData({
  premiumEnabled = true,
  isPremium = false,
  discount = 20 as number | null,
  configFails = false,
} = {}) {
  mockSupabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: USER_ID } } }, error: null } as any);
  mockSupabase.from.mockImplementation((table: string) => {
    switch (table) {
      case 'profiles':
        return tableMock({ data: { id: USER_ID, theme_mode: 'dark', theme_preset: 'emerald', is_premium: isPremium }, error: null });
      case 'app_config':
        return tableMock(configFails
          ? { data: null, error: { message: 'réseau' } }
          : {
            data: {
              features: { premium_enabled: premiumEnabled },
              gamification: discount === null ? null : { premium_discount_pct: discount },
              theme: {}, ads: {},
            },
            error: null,
          });
      default:
        return tableMock({ data: [], error: null });
    }
  });
}

beforeEach(() => {
  mockSupabase.from.mockReset();
  mockSupabase.auth.getSession.mockReset();
});

describe('plan pas encore connu', () => {
  /* LA RÉGRESSION À NE PLUS JAMAIS REFAIRE.
     `usePlan()` rend `premiumEnabled: false` tant que rien n'est revenu — une valeur par défaut,
     pas une réponse. La page annonçait donc « L'offre Premium n'est pas encore disponible » à tout
     le monde, abonnés payants compris, et proposait « S'abonner » à qui payait déjà. */
  it('n’annonce NI offre indisponible NI abonnement tant que les réglages ne répondent pas', async () => {
    setupData({ configFails: true });
    renderWithProviders(<PlanScreen />);
    await screen.findByText('Premium');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/n'est pas encore disponible/)).toBeNull();
    expect(screen.queryByText(/Tu es Premium/)).toBeNull();
    expect(screen.queryByText('Mensuel')).toBeNull();
  });

  /* …et un chargement qui a ÉCHOUÉ n'est pas un chargement en cours : sans ce cas, la page tournait
     indéfiniment, sans un mot ni le moindre recours. */
  it('dit que la lecture a échoué et propose de réessayer', async () => {
    setupData({ configFails: true });
    renderWithProviders(<PlanScreen />);
    expect(await screen.findByText(/n'a pas pu être vérifié/)).toBeTruthy();
    expect(screen.getByText('Réessayer')).toBeTruthy();
  });

  /* La remise valait « ?? 0 » : la page promettait une « Remise boutique −0% » le temps du
     chargement — un avantage qui se contredit lui-même. */
  it('n’annonce jamais une remise de 0 %', async () => {
    setupData({ configFails: true });
    renderWithProviders(<PlanScreen />);
    await screen.findByText('Premium');
    expect(screen.queryByText(/−0%/)).toBeNull();
    expect(screen.getByText('Remise boutique')).toBeTruthy();
  });

  it('retire l’avantage « remise » quand l’administration l’a ramenée à zéro', async () => {
    setupData({ discount: 0 });
    renderWithProviders(<PlanScreen />);
    await waitFor(() => expect(screen.getByText('Gratuit')).toBeTruthy());
    expect(screen.queryByText(/Remise boutique/)).toBeNull();
  });
});

describe('utilisateur gratuit, offre ouverte', () => {
  it('montre son plan, les deux formules et la remise réelle', async () => {
    setupData({ premiumEnabled: true, isPremium: false, discount: 25 });
    renderWithProviders(<PlanScreen />);
    await waitFor(() => expect(screen.getByText('Gratuit')).toBeTruthy());
    expect(screen.getByText('Mensuel')).toBeTruthy();
    expect(screen.getByText('Annuel')).toBeTruthy();
    expect(screen.getByText('Remise boutique −25%')).toBeTruthy();
  });

  /* Sur le web il n'existe aucun tunnel d'achat : un grand bouton « S'abonner » qui répond
     systématiquement « disponible sur mobile » APRÈS le clic est un piège. On le dit avant. */
  it('ne propose pas de bouton d’achat là où l’achat est impossible', async () => {
    setupData({ premiumEnabled: true, isPremium: false });
    renderWithProviders(<PlanScreen />);
    await waitFor(() => expect(screen.getByText('Mensuel')).toBeTruthy());
    expect(screen.queryByText(/S'abonner/)).toBeNull();
    expect(screen.getByText(/se souscrit depuis l'application mobile/)).toBeTruthy();
  });
});

describe('abonné', () => {
  it('ne se voit jamais proposer de souscrire', async () => {
    setupData({ premiumEnabled: true, isPremium: true });
    renderWithProviders(<PlanScreen />);
    await waitFor(() => expect(screen.getByText(/Tu es Premium/)).toBeTruthy());
    expect(screen.queryByText('Mensuel')).toBeNull();
    // « Premium » apparaît deux fois : le titre de l'offre, et l'étiquette du plan en cours.
    expect(screen.getAllByText('Premium')).toHaveLength(2);
    expect(screen.queryByText('Gratuit')).toBeNull();
  });

  /* Couper l'offre en administration ne doit pas confisquer le bouton de RÉSILIATION à des gens
     qui sont encore facturés : le bloc « abonné » suit le droit du compte, pas l'état de l'offre. */
  it('garde l’accès à la résiliation quand l’offre est coupée globalement', async () => {
    setupData({ premiumEnabled: false, isPremium: true });
    renderWithProviders(<PlanScreen />);
    await waitFor(() => expect(screen.getByText(/Tu es Premium/)).toBeTruthy());
    expect(screen.getByText(/momentanément suspendues/)).toBeTruthy();
    expect(screen.getByText(/Gérer/)).toBeTruthy();
    // Relyka n'est distribuée que sur Google Play : aucun renvoi vers l'App Store.
    expect(screen.queryByText(/App Store/)).toBeNull();
    expect(screen.queryByText(/n'est pas encore disponible/)).toBeNull();
  });
});
