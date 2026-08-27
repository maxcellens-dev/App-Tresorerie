/**
 * OÙ LE BOUTON « + » A LE DROIT DE FLOTTER.
 *
 * Ce test existe à cause d'un bug concret : la bulle s'affichait sur des écrans de SAISIE, où elle
 * recouvre la moitié droite du bouton de validation (elle est à ~106 px du bas à droite, le bouton
 * est à ~120 px du bas sur toute la largeur). Appuyer sur « Enregistrer » dépliait alors le menu de
 * saisie rapide, et l'opération n'était jamais enregistrée — sans message. La règle d'origine était
 * une liste d'EXCLUSIONS par nom de route (/add, /edit, /solde) : tout écran de saisie nommé
 * autrement passait au travers.
 *
 * On vérifie donc les deux sens : les quatre écrans qui doivent l'avoir, et le fait qu'un écran de
 * saisie — quel que soit son nom — ne l'a pas.
 */
import { shouldShowQuickAdd } from '../lib/ui/quickAdd';

const ACCOUNT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('shouldShowQuickAdd', () => {
  it('affiche la bulle sur les quatre écrans de consultation prévus', () => {
    expect(shouldShowQuickAdd('/pilotage')).toBe(true);
    expect(shouldShowQuickAdd('/comptes')).toBe(true);
    expect(shouldShowQuickAdd(`/comptes/${ACCOUNT_ID}`)).toBe(true);
    expect(shouldShowQuickAdd('/transactions')).toBe(true);
  });

  it('tolère un chemin qui porte encore ses segments de groupe', () => {
    expect(shouldShowQuickAdd('/(tabs)/pilotage')).toBe(true);
    expect(shouldShowQuickAdd(`/(tabs)/comptes/${ACCOUNT_ID}`)).toBe(true);
  });

  it("ne l'affiche sur AUCUN écran de saisie, quel que soit son nom", () => {
    for (const route of [
      '/transactions/add',
      `/transactions/edit/${ACCOUNT_ID}`,
      '/comptes/add',
      '/comptes/solde',
      '/comptes/credit-add',          // ne contient pas « /add » : passait au travers de l'ancienne règle
      `/comptes/edit/${ACCOUNT_ID}`,
      '/projects/add',
    ]) {
      expect([route, shouldShowQuickAdd(route)]).toEqual([route, false]);
    }
  });

  it("ne l'affiche pas ailleurs dans l'app", () => {
    expect(shouldShowQuickAdd('/projection')).toBe(false);
    expect(shouldShowQuickAdd('/parametres')).toBe(false);
    expect(shouldShowQuickAdd(`/comptes/credit/${ACCOUNT_ID}`)).toBe(false);
    expect(shouldShowQuickAdd(null)).toBe(false);
    expect(shouldShowQuickAdd(undefined)).toBe(false);
  });
});
