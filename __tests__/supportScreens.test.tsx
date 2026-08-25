/**
 * ASSISTANCE — ce qui se passe quand ça se passe MAL.
 *
 * Le cas nominal d'un formulaire de contact ne prouve pas grand-chose : c'est aux moments de
 * friction que le support se juge. Quelqu'un écrit un long message dans le train, appuie deux fois
 * parce que rien ne bouge, perd le réseau au mauvais moment. Chaque test ci-dessous rejoue une de
 * ces situations — toutes se terminaient auparavant par un message perdu, un doublon, ou un écran
 * qui affirmait le contraire de la réalité.
 */
import React from 'react';
import { renderWithProviders, screen, fireEvent, waitFor, act } from './utils/renderWithProviders';
import { mockSupabase } from '../jest.setup';
import AssistanceScreen from '../app/(tabs)/(secondary)/assistance';

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

/** `requestsFail` : la lecture des demandes échoue (réseau coupé). */
function setup({ requestsFail = false } = {}) {
  mockSupabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: USER_ID } } }, error: null } as any);
  mockSupabase.from.mockImplementation((table: string) => {
    switch (table) {
      case 'profiles':
        return tableMock({ data: { id: USER_ID, email: 'moi@exemple.test' }, error: null });
      case 'support_requests':
        return tableMock(requestsFail ? { data: null, error: { message: 'réseau' } } : { data: [], error: null });
      case 'app_config':
        return tableMock({ data: { features: {}, theme: {} }, error: null });
      default:
        return tableMock({ data: [], error: null });
    }
  });
}

/** Ouvre la fenêtre « Contacter l'assistance » et saisit un message. */
async function openAndType(message: string) {
  fireEvent.press(await screen.findByText("Contacter l'assistance"));
  const field = await screen.findByPlaceholderText('Décris ta demande en détail…');
  fireEvent.changeText(field, message);
  return field;
}

beforeEach(() => {
  mockSupabase.from.mockReset();
  mockSupabase.auth.getSession.mockReset();
  mockSupabase.rpc.mockReset();
});

describe('écrire à l’assistance', () => {
  it('tutoie, comme le reste de l’application', async () => {
    setup();
    renderWithProviders(<AssistanceScreen />);
    expect(await screen.findByText(/Écris-nous directement depuis l'app/)).toBeTruthy();
    // Les formulations au vouvoiement de l'ancienne page ne doivent plus exister.
    expect(screen.queryByText(/Échangez directement/)).toBeNull();
  });

  /* LE MESSAGE ÉCRIT NE DOIT JAMAIS DISPARAÎTRE. Le champ était vidé AVANT la réponse du serveur :
     un envoi qui échouait emportait le texte avec lui, sans un mot d'explication. */
  it('conserve le message et explique quand l’envoi échoue', async () => {
    setup();
    mockSupabase.rpc.mockRejectedValue(new Error('Network request failed'));
    renderWithProviders(<AssistanceScreen />);

    const field = await openAndType('Mon compte ne se synchronise plus depuis hier.');
    fireEvent.press(screen.getByText('Envoyer la demande'));

    expect(await screen.findByText(/L'envoi a échoué/)).toBeTruthy();
    expect(field.props.value).toBe('Mon compte ne se synchronise plus depuis hier.');
  });

  /* Deux appuis rapprochés créaient DEUX demandes identiques — que l'équipe devait ensuite
     démêler, et l'utilisateur voyait double dans sa liste.
     ⚠️ PORTÉE DE CE TEST : l'environnement de test rend l'écran entre deux `press`, ce qu'un
     double-tap réel ne laisse pas faire. Il vérifie donc la PROPRIÉTÉ (un seul envoi), pas le
     mécanisme qui la garantit sur un vrai téléphone — celui-ci est le verrou synchrone de
     `useSubmitLock`, couvert par sa propre suite (submitLock.test.ts). */
  it('n’envoie qu’une seule demande même sur deux appuis rapides', async () => {
    setup();
    let resolveRpc: (v: any) => void = () => {};
    mockSupabase.rpc.mockImplementation(() => new Promise<any>((r) => { resolveRpc = r; }) as any);
    renderWithProviders(<AssistanceScreen />);

    await openAndType('Bonjour, une question.');
    const button = screen.getByText('Envoyer la demande');
    // Trois appuis dans le MÊME tour de boucle : c'est exactement ce que produit un double-tap.
    fireEvent.press(button);
    fireEvent.press(button);
    fireEvent.press(button);

    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalled());
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(1);
    await act(async () => { resolveRpc({ data: { id: 'r1', subject: 'x', status: 'open' } as any, error: null }); });
  });

  it('demande de confirmation au serveur, sans écrire les drapeaux elle-même', async () => {
    setup();
    mockSupabase.rpc.mockResolvedValue({ data: { id: 'r1', subject: 'Sujet', status: 'open' } as any, error: null });
    renderWithProviders(<AssistanceScreen />);

    await openAndType('Un souci avec mes projets.');
    fireEvent.press(screen.getByText('Envoyer la demande'));

    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'create_support_request',
      expect.objectContaining({ p_body: 'Un souci avec mes projets.' }),
    ));
  });
});

describe('mes demandes', () => {
  /* « Aucune demande en cours » est une AFFIRMATION. Affichée alors que la lecture a échoué, elle
     fait croire à quelqu'un qui attend une réponse que sa demande a disparu. */
  it('ne dit pas « aucune demande » quand la lecture a échoué', async () => {
    setup({ requestsFail: true });
    renderWithProviders(<AssistanceScreen />);
    expect(await screen.findByText(/n'ont pas pu être chargées/)).toBeTruthy();
    expect(screen.queryByText('Aucune demande en cours.')).toBeNull();
  });
});
