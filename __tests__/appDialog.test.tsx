import { renderWithProviders, screen, fireEvent, act } from './utils/renderWithProviders';
import AppDialogHost from '../components/system/AppDialogHost';
import { appChoice, appConfirm, registerDialogHost, type DialogRequest } from '../lib/ui/appDialog';

/**
 * VERROU SUR LA SORTIE DES DIALOGUES.
 *
 * Un `appChoice` ne demande pas une confirmation, il fait TRANCHER : chaque carte décrit un
 * enregistrement différent, et il n'existe pas de valeur par défaut acceptable. Le tap sur le fond
 * retombait pourtant sur le bouton 'cancel' de repli — l'opération partait avec la réponse « non »,
 * muette, alors que l'utilisateur croyait avoir annulé (cas réel : « Déjà comptée dans ce solde ? »,
 * la transaction impactait le solde sans que personne ne l'ait décidé).
 *
 * On éprouve donc les deux régimes : le dialogue qu'on peut quitter, et celui qu'on ne peut pas.
 */

/** Capture la demande envoyée à l'hôte, sans rendre quoi que ce soit. */
function captureRequest(fn: () => void): DialogRequest {
  let captured: DialogRequest | null = null;
  registerDialogHost((r) => { captured = r; });
  fn();
  registerDialogHost(null);
  return captured!;
}

const twoOptions = [
  { icon: 'checkmark-done', label: 'Oui, déjà incluse', hint: 'Solde inchangé.', tone: 'neutral' as const },
  { icon: 'add-circle', label: 'Non, c’est une nouvelle opération', hint: 'Elle s’ajoute.', tone: 'accent' as const },
];

describe('appChoice — une réponse OBLIGATOIRE', () => {
  it('demande un dialogue qu’on ne peut pas quitter sans choisir', () => {
    const req = captureRequest(() => { void appChoice({ title: 'Déjà comptée ?', options: twoOptions }); });
    expect(req.dismissible).toBe(false);
  });

  /* Le repli garde une sortie VISIBLE : si l'hôte ne savait pas rendre les cartes, un dialogue non
     quittable ET sans bouton laisserait la promesse pendante à jamais. */
  it('garde un bouton de repli résolvant la promesse', () => {
    const req = captureRequest(() => { void appChoice({ title: 'x', options: twoOptions }); });
    expect(req.buttons.some((b) => b.style === 'cancel')).toBe(true);
  });

  it('une confirmation ordinaire, elle, reste quittable', () => {
    const req = captureRequest(() => { void appConfirm({ title: 'Supprimer ?' }); });
    expect(req.dismissible).toBeUndefined(); // défaut = oui
  });
});

describe('AppDialogHost — le fond cliquable', () => {
  it('n’offre AUCUN fond cliquable sur une question à réponse obligatoire', async () => {
    renderWithProviders(<AppDialogHost />);
    let answer: number | undefined;
    await act(async () => { void appChoice({ title: 'Déjà comptée ?', options: twoOptions }).then((c) => { answer = c; }); });

    expect(screen.getByText('Déjà comptée ?')).toBeOnTheScreen();
    // Le fond n'est pas rendu du tout (cf. KeyboardAwareOverlay : pas de handler → pas de Pressable).
    expect(screen.queryByLabelText('Fermer')).toBeNull();
    expect(answer).toBeUndefined();

    // Seules les cartes ferment le dialogue — et elles disent laquelle a été choisie.
    await act(async () => { fireEvent.press(screen.getByText('Oui, déjà incluse')); });
    expect(answer).toBe(0);
  });

  it('laisse le fond fermer une confirmation ordinaire', async () => {
    renderWithProviders(<AppDialogHost />);
    let confirmed: boolean | undefined;
    await act(async () => { void appConfirm({ title: 'Supprimer ?' }).then((v) => { confirmed = v; }); });

    await act(async () => { fireEvent.press(screen.getByLabelText('Fermer')); });
    expect(confirmed).toBe(false);
  });
});
