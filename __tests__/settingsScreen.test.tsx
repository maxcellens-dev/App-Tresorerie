/**
 * PARAMÈTRES — l'écran réel, monté avec des données réalistes.
 *
 * Ce que ces tests protègent : un réglage qui ne part PAS doit se voir. La page appliquait le
 * changement dans le cache avant l'appel réseau (pour que l'interrupteur réagisse tout de suite) ;
 * quand l'écriture échouait, la mise à jour optimiste faisait marche arrière toute seule et
 * l'interrupteur revenait à sa position d'origine — sans un mot. On croyait à un bug de l'app, on
 * recommençait, et rien ne s'enregistrait davantage.
 */
import React from 'react';
import { renderWithProviders, screen, fireEvent, waitFor } from './utils/renderWithProviders';
import { mockSupabase } from '../jest.setup';
import { CalculatorProvider } from '../contexts/CalculatorContext';
import SettingsScreen from '../app/(tabs)/(secondary)/parametres';

const USER_ID = 'user-1';

/** Réponse Supabase chaînable. `updateResult` pilote ce que rend une écriture sur `profiles`. */
function tableMock(table: string, result: any, updateResult?: any) {
  const builder: any = {
    select: () => builder,
    eq: () => (builder.__updating ? { then: (ok: any, ko: any) => Promise.resolve(updateResult ?? { error: null }).then(ok, ko) } : builder),
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    update: () => { builder.__updating = true; return builder; },
    upsert: () => builder,
    maybeSingle: async () => result,
    single: async () => result,
    then: (ok: any, ko: any) => Promise.resolve(result).then(ok, ko),
  };
  return builder;
}

/** `writeFails` : toute écriture de profil est refusée par le serveur. */
function setupData({ writeFails = false }: { writeFails?: boolean } = {}) {
  mockSupabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: USER_ID } } }, error: null } as any);
  mockSupabase.from.mockImplementation((table: string) => {
    switch (table) {
      case 'profiles':
        return tableMock(
          table,
          { data: { id: USER_ID, theme_mode: 'dark', email_opt_in: true, currency_code: 'EUR' }, error: null },
          writeFails ? { error: { message: 'réseau indisponible' } } : { error: null },
        );
      case 'app_config':
        return tableMock(table, { data: { features: {}, theme: {} }, error: null });
      default:
        return tableMock(table, { data: null, error: null });
    }
  });
}

const renderSettings = () =>
  renderWithProviders(
    <CalculatorProvider>
      <SettingsScreen />
    </CalculatorProvider>,
  );

beforeEach(() => {
  mockSupabase.from.mockReset();
  mockSupabase.auth.getSession.mockReset();
});

describe('page Paramètres', () => {
  it('affiche ses sections', async () => {
    setupData();
    renderSettings();
    expect(await screen.findByText('Paramètres')).toBeTruthy();
    expect(screen.getByText('Devise de référence')).toBeTruthy();
    expect(screen.getByText('Notifications')).toBeTruthy();
  });

  it("ne dit rien quand tout se passe bien", async () => {
    setupData({ writeFails: false });
    renderSettings();
    await screen.findByText('Paramètres');
    fireEvent(screen.getByLabelText('E-mails d’information'), 'valueChange', false);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/n'a pas pu être enregistré/i)).toBeNull();
  });

  /* LA RÉGRESSION À NE PLUS JAMAIS REFAIRE : un réglage refusé par le serveur repartait en arrière
     en silence. */
  it("dit que le réglage n'est pas parti quand l'écriture échoue", async () => {
    setupData({ writeFails: true });
    renderSettings();
    await screen.findByText('Paramètres');
    fireEvent(screen.getByLabelText('E-mails d’information'), 'valueChange', false);
    await waitFor(() => expect(screen.getByText(/n'a pas pu être enregistré/i)).toBeTruthy());
  });

  /* « Relancer les recommandations » cochait sa confirmation en dur, sans attendre l'écriture :
     elle s'affichait même quand rien n'était parti — et ne s'éteignait plus jamais. */
  it("ne confirme pas la relance des recommandations quand elle échoue", async () => {
    setupData({ writeFails: true });
    renderSettings();
    await screen.findByText('Paramètres');
    fireEvent.press(screen.getByText('Relancer les recommandations'));
    await waitFor(() => expect(screen.getByText(/n'ont pas pu être relancées/i)).toBeTruthy());
  });
});
