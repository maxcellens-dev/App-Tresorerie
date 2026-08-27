/**
 * webLayout — boîte à outils de mise en forme pour l'affichage WEB « bureau ».
 *
 * Objectif : sur un navigateur d'ordinateur, Relyka ne doit plus ressembler à une app mobile
 * étirée (colonne de 840 px, boutons pleine largeur, barre d'onglets en bas) mais à un vrai
 * site/dashboard : barre latérale de navigation, contenu large centré, cartes en grille,
 * boutons dimensionnés par leur contenu, survols et curseurs.
 *
 * RÈGLE ABSOLUE : tout ici est conditionné à `Platform.OS === 'web'` (et le plus souvent à une
 * largeur >= DESKTOP_MIN_WIDTH). Sur mobile/tablette natif, chaque helper renvoie `null`/`{}` →
 * les styles existants s'appliquent inchangés. Aucune régression possible côté app.
 *
 * Utilisation typique dans un écran :
 *
 *   const { isDesktop } = useResponsive();
 *   ...
 *   <ScrollView contentContainerStyle={[styles.scrollContent, contentWidth(isDesktop)]}>
 *   <View style={[styles.row, gridRow(isDesktop)]}>
 *     <View style={[styles.card, gridItem(isDesktop, 2)]} />
 *   </View>
 *   <TouchableOpacity style={[styles.btn, inlineButton(isDesktop)]} />
 */
import { Platform } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';

export const IS_WEB = Platform.OS === 'web';

/* ───────────────────────── Constantes de gabarit ───────────────────────── */

/** Largeur de la barre latérale de navigation (bureau). */
export const SIDEBAR_WIDTH = 248;
/** Largeur de la barre latérale repliée (icônes seules). */
export const SIDEBAR_WIDTH_COLLAPSED = 76;
/** Hauteur de la barre supérieure (titre + profil). */
export const TOPBAR_HEIGHT = 68;

/** Largeurs maximales de contenu, par nature de page. */
export const MAX_W = {
  /** Tableaux de bord, grilles de cartes, graphiques. */
  dashboard: 1180,
  /** Listes et pages de lecture (transactions, comptes). */
  list: 1000,
  /** Réglages et pages « une ligne = un réglage » : au-delà, libellé et valeur se perdent de vue. */
  settings: 820,
  /** Formulaires : au-delà, les champs et boutons deviennent absurdement larges. */
  form: 640,
  /** Écrans d'authentification : carte centrée. */
  auth: 460,
  /** Boîtes de dialogue centrées (remplacent les feuilles du bas). */
  dialog: 560,
} as const;

export type ContentVariant = keyof typeof MAX_W;

/** Gouttière horizontale du contenu en bureau. */
export const GUTTER = 32;
/** Espacement standard entre cartes d'une grille. */
export const GRID_GAP = 20;

/* ───────────────────────── Helpers de base ───────────────────────── */

/** Renvoie `style` uniquement sur web (sinon `null`, ignoré par RN). */
export function web<T extends ViewStyle | TextStyle>(style: T): T | null {
  return IS_WEB ? style : null;
}

/** Renvoie `style` uniquement quand l'habillage bureau est actif. */
export function desktop<T extends ViewStyle | TextStyle>(isDesktop: boolean, style: T): T | null {
  return isDesktop ? style : null;
}

/** Curseur « main » sur les éléments cliquables (web seulement). */
export const pointer = web({ cursor: 'pointer' } as any);
/** Curseur « texte par défaut » — pour neutraliser un pointer hérité. */
export const cursorDefault = web({ cursor: 'default' } as any);

/** Transition douce (survol, focus). Web seulement — RN ignore ces propriétés. */
export const transition = web({
  transitionDuration: '160ms',
  transitionTimingFunction: 'cubic-bezier(.2,.7,.3,1)',
  transitionProperty: 'background-color, border-color, color, box-shadow, transform, opacity',
} as any);

/** Autorise la sélection du texte (un site web se copie-colle). */
export const selectable = web({ userSelect: 'text' } as any);

/**
 * Ombre portée « web » (box-shadow), plus fine et plus nette que l'ombre RN.
 * `level` 1 = carte au repos, 2 = carte survolée, 3 = élément flottant (dialogue, menu).
 */
export function shadow(level: 1 | 2 | 3 = 1): ViewStyle | null {
  if (!IS_WEB) return null;
  const box =
    level === 1 ? '0 1px 2px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.10)'
    : level === 2 ? '0 4px 12px rgba(0,0,0,.10), 0 2px 4px rgba(0,0,0,.06)'
    : '0 24px 48px rgba(0,0,0,.28), 0 2px 8px rgba(0,0,0,.16)';
  return { boxShadow: box } as any;
}

/* ───────────────────────── Largeur de contenu ───────────────────────── */

/**
 * Centre et plafonne le contenu d'une page en bureau.
 * À étaler sur le `contentContainerStyle` d'un ScrollView (ou le conteneur d'une FlatList).
 */
export function contentWidth(isDesktop: boolean, variant: ContentVariant = 'dashboard'): ViewStyle | null {
  if (!isDesktop) return null;
  return {
    width: '100%',
    maxWidth: MAX_W[variant],
    alignSelf: 'center',
    paddingHorizontal: GUTTER,
  };
}

/** Idem, mais sans gouttière (quand l'écran gère déjà son padding horizontal). */
export function contentWidthBare(isDesktop: boolean, variant: ContentVariant = 'dashboard'): ViewStyle | null {
  if (!isDesktop) return null;
  return { width: '100%', maxWidth: MAX_W[variant], alignSelf: 'center' };
}

/**
 * Colonne de PAGE (bureau) — à poser sur le conteneur racine d'un écran (le SafeAreaView qui porte
 * déjà le padding horizontal). C'est le geste le plus simple pour « désétirer » un écran entier :
 * en-tête, filtres et liste restent alignés dans la même colonne centrée.
 */
export function pageColumn(
  isDesktop: boolean,
  variant: ContentVariant = 'dashboard',
  paddingHorizontal: number = GUTTER,
): ViewStyle | null {
  if (!isDesktop) return null;
  return { width: '100%', maxWidth: MAX_W[variant], alignSelf: 'center', paddingHorizontal, paddingTop: 16 };
}

/** Colonne de formulaire centrée : empêche champs et boutons de s'étirer sur 1200 px. */
export function formColumn(isDesktop: boolean, variant: ContentVariant = 'form'): ViewStyle | null {
  if (!isDesktop) return null;
  return { width: '100%', maxWidth: MAX_W[variant], alignSelf: 'center' };
}

/* ───────────────────────── Écrans d'authentification ───────────────────────── */

/**
 * CARTE d'authentification (connexion, inscription, mot de passe), sur ordinateur.
 *
 * Ces écrans restaient une bande verticale pleine hauteur, aux couleurs de l'app, plantée au milieu
 * d'un fond vide : la capture d'un téléphone posée sur un écran d'ordinateur. Un site présente au
 * contraire une CARTE — largeur limitée, hauteur libre, bord et ombre qui la détachent du fond,
 * centrée dans la fenêtre. C'est ce que rend ce couple de helpers : `authPage` sur le conteneur
 * pleine page (il centre), `authCard` sur le bloc de contenu (il se détache).
 *
 * Sur mobile, les deux renvoient `null` : l'écran garde exactement sa mise en page actuelle.
 */
export function authPage(isDesktop: boolean): ViewStyle | null {
  if (!isDesktop) return null;
  // `flexGrow` (et non `flex`) : ce style sert AUSSI de `contentContainerStyle` de ScrollView, où
  // `flex: 1` bride la hauteur du contenu et empêche le défilement dès que la carte dépasse.
  return { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 };
}

export function authCard(isDesktop: boolean, colors: { card: string; cardBorder: string }): ViewStyle | null {
  if (!isDesktop) return null;
  return {
    width: '100%',
    maxWidth: MAX_W.auth,
    alignSelf: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 20,
    paddingHorizontal: 36,
    paddingVertical: 36,
    ...(shadow(3) as any),
  };
}

/* ───────────────────────── Grilles de cartes ───────────────────────── */

/**
 * Transforme une pile verticale de cartes en grille horizontale (bureau).
 * À poser sur le CONTENEUR ; chaque enfant reçoit `gridItem(isDesktop, cols)`.
 */
export function gridRow(isDesktop: boolean, gap: number = GRID_GAP): ViewStyle | null {
  if (!isDesktop) return null;
  return { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap };
}

/**
 * Largeur d'une carte dans une grille de `cols` colonnes.
 * `flexBasis` en pourcentage (moins le gap réparti) + `flexGrow` pour combler la dernière ligne.
 */
export function gridItem(isDesktop: boolean, cols: 2 | 3 | 4 = 2, gap: number = GRID_GAP): ViewStyle | null {
  if (!isDesktop) return null;
  const basis = `calc(${(100 / cols).toFixed(4)}% - ${(gap * (cols - 1)) / cols}px)`;
  return { flexBasis: basis as any, flexGrow: 1, flexShrink: 1, minWidth: 260 };
}

/** Carte qui occupe toute la largeur d'une grille (bandeau, graphique). */
export function gridSpan(isDesktop: boolean): ViewStyle | null {
  if (!isDesktop) return null;
  return { flexBasis: '100%' as any, flexGrow: 1, width: '100%' };
}

/* ───────────────────────── Boutons ───────────────────────── */

/**
 * Empêche un bouton de prendre toute la largeur : il se dimensionne sur son contenu,
 * avec une largeur minimale confortable. C'est LE correctif du « gros bouton mobile ».
 */
export function inlineButton(isDesktop: boolean, minWidth = 168): ViewStyle | null {
  if (!isDesktop) return null;
  return { alignSelf: 'flex-start', minWidth, flexGrow: 0, ...(pointer as any) };
}

/** Rangée de boutons alignés à droite (barre d'actions d'un formulaire / d'un dialogue). */
export function actionBar(isDesktop: boolean, align: 'flex-start' | 'flex-end' = 'flex-end'): ViewStyle | null {
  if (!isDesktop) return null;
  return { flexDirection: 'row', justifyContent: align, alignItems: 'center', gap: 12, flexWrap: 'wrap' };
}

/* ───────────────────────── Survol (sans changer le composant) ───────────────────────── */

/**
 * Props à ÉTALER sur un élément cliquable pour lui donner un survol de site web.
 *
 * Pourquoi pas un état React : `TouchableOpacity` n'expose pas `hovered`, et le remplacer par
 * `Pressable` partout modifierait le retour tactile sur MOBILE. Ici on pose seulement un attribut
 * `data-hover` (RNW traduit `dataSet` en `data-*`) et la feuille de style bureau de
 * `public/index.html` fait le reste — sous `@media (min-width: 1024px)`, donc invisible ailleurs.
 * Sur natif, `dataSet` n'existe pas : on n'étale rien du tout.
 *
 *   <TouchableOpacity {...hoverRow} style={styles.row}>   // ligne de liste
 *   <TouchableOpacity {...hoverCard} style={styles.card}> // carte (léger relief)
 *   <TouchableOpacity {...hoverTint} style={styles.btn}>  // bouton (éclaircissement)
 */
export const hoverRow: any = IS_WEB ? { dataSet: { hover: 'row' } } : {};
export const hoverCard: any = IS_WEB ? { dataSet: { hover: 'card' } } : {};
export const hoverTint: any = IS_WEB ? { dataSet: { hover: 'tint' } } : {};

/* ───────────────────────── Cartes ───────────────────────── */

/** Aspect « carte web » : coins un peu plus doux, ombre fine, transition au survol. */
export function webCard(isDesktop: boolean): ViewStyle | null {
  if (!isDesktop) return null;
  return { ...(shadow(1) as any), ...(transition as any) };
}

/* (`webCardHover` vivait ici : le relief au survol calculé EN JAVASCRIPT, à composer avec un hook
   `useHover` qui suivait l'état de la souris. Les deux ont été retirés — plus rien ne les appelait,
   et ce n'est plus l'approche : le survol se fait en CSS via `hoverCard` ci-dessus, qui ne coûte
   aucun rendu React. Repasser par du JS pour ça ferait re-rendre la carte à chaque va-et-vient du
   curseur.) */
