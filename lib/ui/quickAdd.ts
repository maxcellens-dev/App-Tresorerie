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

// Les segments de groupe — /(tabs)/… — ne font pas partie de l'URL, mais selon le client le
// chemin peut arriver avec : on les retire pour comparer la même chose dans tous les cas.
const logicalRoute = (pathname: string | null | undefined): string =>
  '/' + String(pathname ?? '').split('/').filter((s) => s && !s.startsWith('(')).join('/');

export function shouldShowQuickAdd(pathname: string | null | undefined): boolean {
  return QUICK_ADD_ROUTES.some((re) => re.test(logicalRoute(pathname)));
}

const UUID = '[0-9a-fA-F-]{36}';
const ACCOUNT_ROUTES = [
  new RegExp(`^/comptes/(${UUID})$`),        // la fiche (onglets Solde / Transactions / Paramètres)
  new RegExp(`^/comptes/edit/(${UUID})$`),   // ses réglages, en page dédiée
];

/**
 * LE COMPTE DANS LEQUEL ON SE TROUVE, ou `null` si l'écran n'appartient à aucun compte.
 *
 * Une saisie lancée depuis un compte doit s'ouvrir SUR ce compte. La bulle « + » du mobile le
 * savait ; le bouton « Nouvelle opération » du web bureau, lui, ouvrait toujours la saisie sur le
 * compte par défaut — on créait donc l'opération sur le mauvais compte sans s'en apercevoir. Les
 * deux menus lisent désormais la règle ici, pour qu'elle ne puisse plus diverger.
 *
 * `accountParam` : l'écran de mise à jour du solde porte son compte en paramètre (`?account=`),
 * pas dans le chemin.
 */
export function quickAddAccountId(
  pathname: string | null | undefined,
  accountParam?: string | string[] | null,
): string | null {
  const route = logicalRoute(pathname);
  for (const re of ACCOUNT_ROUTES) {
    const m = route.match(re);
    if (m) return m[1];
  }
  const param = Array.isArray(accountParam) ? accountParam[0] : accountParam;
  if (route === '/comptes/solde' && param && new RegExp(`^${UUID}$`).test(param)) return param;
  return null;
}
