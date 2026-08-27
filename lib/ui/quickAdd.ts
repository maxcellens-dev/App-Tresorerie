/**
 * OÙ LE BOUTON « + » (QuickAddButton) A LE DROIT DE FLOTTER — une liste FERMÉE de quatre écrans :
 * le Pilotage (l'accueil), la liste des Comptes, la fiche d'un compte, la liste des Transactions.
 *
 * ── POURQUOI CETTE RÈGLE VIT ICI, ET DANS CE SENS ───────────────────────────────────────────────
 * Elle était écrite à l'envers, dans le composant : « partout sous /pilotage, /comptes ou
 * /transactions, SAUF les chemins contenant /add, /edit ou /solde ». Une liste d'EXCLUSIONS par nom
 * de route laisse passer tout ce qui ne s'appelle pas comme ça — /comptes/transfer et
 * /comptes/credit-add sont des écrans de SAISIE, et la bulle s'y affichait.
 *
 * Ce n'est pas cosmétique : la bulle flotte à ~106 px du bas, collée à droite ; le bouton de
 * validation d'un écran de saisie occupe toute la largeur à ~120 px du bas. Elle recouvrait donc sa
 * moitié droite, et l'appui dépliait le menu de saisie rapide au lieu de valider — l'opération
 * n'était jamais enregistrée, sans le moindre message. C'est ce qui rendait le virement ouvert
 * depuis une fiche de compte impossible à enregistrer, alors que le MÊME virement passait très bien
 * par le bouton « + » (dont l'écran, lui, s'appelle « add » et était donc exclu).
 *
 * Une liste fermée n'a pas ce défaut : un nouvel écran n'y entre que si on l'y met. Et elle vit
 * dans lib/ pour être vérifiable sans monter le composant (cf. __tests__/quickAddVisibility).
 */

/** Chemins où la bulle « + » s'affiche. Tout le reste ne l'a pas. */
const QUICK_ADD_ROUTES = [
  /^\/pilotage$/,
  /^\/comptes$/,
  /^\/comptes\/[0-9a-fA-F-]{36}$/,   // la FICHE d'un compte, pas ses écrans de saisie
  /^\/transactions$/,
];

export function shouldShowQuickAdd(pathname: string | null | undefined): boolean {
  // Les segments de groupe — /(tabs)/… — ne font pas partie de l'URL, mais selon le client le
  // chemin peut arriver avec : on les retire pour comparer la même chose dans tous les cas.
  const route = '/' + String(pathname ?? '').split('/').filter((s) => s && !s.startsWith('(')).join('/');
  return QUICK_ADD_ROUTES.some((re) => re.test(route));
}
