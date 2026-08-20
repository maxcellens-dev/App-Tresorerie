import { renderWithProviders, screen, fireEvent, waitFor } from './utils/renderWithProviders';
import { mockSupabase, mockRouter } from '../jest.setup';
import RegisterScreen from '../app/register';

/**
 * PREUVE DU HARNAIS (cf. docs/PLAN_REFACTOR_TESTS.md, étape B3) — et verrou sur une régression réelle.
 *
 * Un utilisateur s'est retrouvé avec un compte introuvable : l'écran annonçait « vérifie ton mail »
 * alors que le serveur n'avait rien créé. Les quatre cas ci-dessous couvrent chacune des issues
 * possibles de l'inscription, y compris celles qui ne lèvent AUCUNE erreur.
 */
const fill = (email = 'nouveau@exemple.fr', password = 'Correct-Horse-42!') => {
  fireEvent.press(screen.getByText('Continuer avec un e-mail'));
  fireEvent.changeText(screen.getByPlaceholderText('toi@exemple.fr'), email);
  fireEvent.changeText(screen.getByPlaceholderText('••••••••••••'), password);
};
const submit = () => fireEvent.press(screen.getByText('S’inscrire par e-mail'));

describe('Écran d\'inscription', () => {
  it('s\'affiche', () => {
    renderWithProviders(<RegisterScreen />);
    expect(screen.getByText('Créer un compte')).toBeOnTheScreen();
  });

  it('refuse un mot de passe trop faible SANS appeler le serveur', async () => {
    renderWithProviders(<RegisterScreen />);
    fill('nouveau@exemple.fr', '123');
    submit();
    await waitFor(() => expect(mockSupabase.auth.signUp).not.toHaveBeenCalled());
  });

  it('annonce « vérifie ta boîte mail » quand le compte est réellement créé', async () => {
    // Pas de session + un utilisateur AVEC identité = inscription en attente de confirmation.
    mockSupabase.auth.signUp.mockResolvedValue({
      data: { session: null, user: { id: 'u1', identities: [{ id: 'i1' }] } }, error: null,
    });
    renderWithProviders(<RegisterScreen />);
    fill();
    submit();
    await waitFor(() => expect(screen.getByText('Vérifie ta boîte mail')).toBeOnTheScreen());
    expect(screen.getByText(/nouveau@exemple\.fr/)).toBeOnTheScreen();
  });

  it('dit qu\'un compte existe déjà — sans erreur serveur, identités vides', async () => {
    /* Protection contre l'énumération d'adresses : `signUp` renvoie un utilisateur FACTICE, sans
       identité, et AUCUNE erreur. C'est le cas qui envoyait l'utilisateur attendre un e-mail
       fantôme. */
    mockSupabase.auth.signUp.mockResolvedValue({
      data: { session: null, user: { id: 'u1', identities: [] } }, error: null,
    });
    renderWithProviders(<RegisterScreen />);
    fill('deja@exemple.fr');
    submit();
    await waitFor(() => expect(screen.getByText('Un compte existe déjà avec cette adresse.')).toBeOnTheScreen());
    expect(screen.queryByText('Vérifie ta boîte mail')).toBeNull();
  });

  it('n\'annonce JAMAIS la confirmation quand le serveur n\'a rien créé', async () => {
    // Ni session ni utilisateur : l'inscription a été annulée côté serveur (quota d'envoi, etc.).
    mockSupabase.auth.signUp.mockResolvedValue({ data: { session: null, user: null }, error: null });
    renderWithProviders(<RegisterScreen />);
    fill();
    submit();
    await waitFor(() => expect(screen.getByText(/n'a pas abouti/)).toBeOnTheScreen());
    expect(screen.queryByText('Vérifie ta boîte mail')).toBeNull();
  });

  it('traduit un dépassement de quota en disant que le compte n\'existe pas', async () => {
    mockSupabase.auth.signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 47 seconds.' },
    });
    renderWithProviders(<RegisterScreen />);
    fill();
    submit();
    await waitFor(() => expect(screen.getByText(/n'a PAS été créé/)).toBeOnTheScreen());
  });

  it('propose d\'aller se connecter depuis l\'écran de confirmation', async () => {
    mockSupabase.auth.signUp.mockResolvedValue({
      data: { session: null, user: { id: 'u1', identities: [{ id: 'i1' }] } }, error: null,
    });
    renderWithProviders(<RegisterScreen />);
    fill();
    submit();
    await waitFor(() => expect(screen.getByText('Aller à la connexion')).toBeOnTheScreen());
    fireEvent.press(screen.getByText('Aller à la connexion'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/login');
  });
});
