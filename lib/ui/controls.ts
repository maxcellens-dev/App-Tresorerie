/**
 * CONTRÔLES — le vocabulaire visuel unique des boutons, segments et pastilles.
 *
 * POURQUOI CE MODULE : chaque écran redéfinissait ses boutons dans son propre `makeStyles`. Il en
 * résultait une quinzaine de variantes du même geste — rayons de 8, 10, 12, 14 et 20, hauteurs de
 * 40 à 52, et surtout des couleurs ÉCRITES EN DUR (`#475569` pour la bordure de « Brouillon »,
 * `#94a3b8` pour son texte) qui ne suivaient ni le thème clair, ni la couleur d'accent choisie par
 * l'utilisateur, ni le Style Editor de l'admin. Deux boutons côte à côte n'avaient donc pas la même
 * hauteur, et l'un des deux restait gris ardoise sur un thème crème.
 *
 * Ici : UNE échelle de tailles, UN jeu de variantes, ZÉRO couleur littérale. Tout vient du thème,
 * donc tout suit l'accent, le mode clair/sombre et les réglages d'apparence.
 *
 * ── Le vocabulaire ────────────────────────────────────────────────────────────────────────────
 *  • `primary`   — l'action qui fait avancer (Enregistrer, Continuer). UNE SEULE par écran.
 *  • `secondary` — l'alternative légitime (Brouillon, Modifier). Contour, pas d'aplat.
 *  • `ghost`     — l'échappatoire (Annuler, Plus tard). Ni fond ni contour.
 *  • `danger`    — la destruction (Supprimer). Contour rouge ; l'aplat est réservé à la
 *                  confirmation finale, pour que « Supprimer » ne crie pas avant d'être confirmé.
 *
 * Le SEGMENT (`segmentStyles`) est le style d'onglets validé sur les fiches compte et les projets
 * partagés : barre discrète, onglet actif en teinte d'accent à 12 %, texte accentué. Il sert
 * partout où l'on choisit UNE option parmi peu — onglets, filtres exclusifs, cadence mois/an.
 */
import { Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { readableOn, type AppColors } from '../../theme/palette';

/** Curseur main sur le web : un élément cliquable doit se signaler comme tel. */
export const pressableWeb = Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {};

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Une seule échelle de tailles — trois valeurs, pas quinze.
 *
 * Les hauteurs sont FIXES (`minHeight`) plutôt que déduites d'un padding : c'est ce qui garantit
 * qu'un bouton à une ligne et un bouton dont le libellé passe à deux lignes gardent la même
 * hauteur dans une même rangée. Avant, « Envoyer l'invitation / Ajouter membre » était plus haut
 * que son voisin pour la seule raison qu'il est plus long.
 */
export const BUTTON_SIZES: Record<ButtonSize, { minHeight: number; paddingHorizontal: number; fontSize: number; radius: number; gap: number; icon: number; tracking: number }> = {
  sm: { minHeight: 36, paddingHorizontal: 14, fontSize: 13,   radius: 10, gap: 6, icon: 15, tracking: 0 },
  md: { minHeight: 46, paddingHorizontal: 18, fontSize: 14.5, radius: 12, gap: 7, icon: 17, tracking: 0.1 },
  lg: { minHeight: 54, paddingHorizontal: 20, fontSize: 15.5, radius: 14, gap: 8, icon: 19, tracking: 0.2 },
};

export interface ButtonVisual {
  container: ViewStyle;
  label: TextStyle;
  /** Couleur à passer aux icônes et à l'indicateur de chargement. */
  tint: string;
  /** Superposition d'appui — voir `AppButton` (assombrit/éclaircit sans changer la teinte). */
  pressOverlay: string;
}

/**
 * Le rendu d'un bouton, dérivé du thème.
 *
 * ── CE QUI FAIT LE « FINI » ──────────────────────────────────────────────────────────────────
 *  • une hauteur fixe par taille, donc des rangées parfaitement alignées ;
 *  • une OMBRE PORTÉE TEINTÉE sur l'action principale — pas un gris générique : l'ombre reprend la
 *    couleur d'accent, ce qui donne l'impression que le bouton éclaire la surface sous lui plutôt
 *    que d'y être collé. C'est ce détail qui sépare un aplat d'un vrai bouton ;
 *  • un `secondary` REMPLI d'accent très dilué et non un simple contour : deux boutons côte à côte
 *    se lisent alors comme une paire (plein / atténué) et non comme un bouton plus un cadre vide ;
 *  • une légère graisse de lettrage (`letterSpacing`) sur les grandes tailles, qui empêche un
 *    libellé en gras de paraître compressé.
 */
export function buttonVisual(
  c: AppColors,
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  /**
   * Teinte SÉMANTIQUE, quand le bouton parle d'un domaine qui a déjà sa couleur dans l'app :
   * vert pour l'épargne, violet pour l'investissement, bleu pour un compte courant. On remplace
   * alors l'accent — et l'accent SEULEMENT : la forme, la hauteur et l'ombre ne bougent pas.
   * À n'utiliser que là où la couleur porte un sens ; partout ailleurs, l'accent du thème.
   */
  tone?: string,
): ButtonVisual {
  const s = BUTTON_SIZES[size];
  const accent = tone || c.primary;
  const base: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s.gap,
    minHeight: s.minHeight,
    paddingVertical: 8,
    paddingHorizontal: s.paddingHorizontal,
    borderRadius: s.radius,
    borderWidth: 1,
    borderColor: 'transparent',
    ...pressableWeb,
  };
  const label: TextStyle = {
    fontSize: s.fontSize, fontWeight: '700', textAlign: 'center', letterSpacing: s.tracking,
  };
  /* En thème CLAIR, un appui doit assombrir ; en thème sombre, éclaircir. Une seule couleur de
     voile ne peut pas faire les deux — on la choisit donc sur le mode actif. */
  const overlay = c.mode === 'light' ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.12)';

  switch (variant) {
    case 'secondary':
      return {
        container: { ...base, backgroundColor: accent + '14', borderColor: accent + '3D' },
        label: { ...label, color: accent },
        tint: accent,
        pressOverlay: overlay,
      };
    case 'ghost':
      return {
        container: { ...base, backgroundColor: 'transparent', borderColor: 'transparent' },
        label: { ...label, color: c.textSecondary, fontWeight: '600' },
        tint: c.textSecondary,
        pressOverlay: overlay,
      };
    case 'danger':
      return {
        container: { ...base, backgroundColor: c.danger + '14', borderColor: c.danger + '4D' },
        label: { ...label, color: c.danger },
        tint: c.danger,
        pressOverlay: overlay,
      };
    default:
      return {
        container: {
          ...base,
          backgroundColor: accent,
          borderColor: accent,
          // Ombre TEINTÉE par l'accent — jamais un gris : c'est elle qui décolle le bouton du fond.
          shadowColor: accent,
          shadowOpacity: c.mode === 'light' ? 0.3 : 0.45,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3,
        },
        /* L'encre du libellé se DÉDUIT de l'aplat. `c.onAccent` est calculé pour l'accent du
           thème : sur une teinte sémantique libre (le violet de l'investissement, le vert de
           l'épargne), il peut ne plus contraster du tout. `readableOn` tranche entre blanc et
           quasi-noir sur la couleur réelle. */
        label: { ...label, color: tone ? readableOn(tone) : c.onAccent, fontWeight: '800' },
        tint: tone ? readableOn(tone) : c.onAccent,
        pressOverlay: 'rgba(0,0,0,0.12)',
      };
  }
}

/** Opacité d'un contrôle indisponible — la même partout, pour que « désactivé » se reconnaisse. */
export const DISABLED_OPACITY = 0.45;

/**
 * SEGMENT — choisir UNE option parmi peu (onglets, filtres exclusifs, cadence).
 *
 * C'est le style adopté sur les onglets des fiches compte et des projets partagés : la barre se
 * fond dans la page, seul l'élément actif se détache par une teinte d'accent à 12 % et un texte
 * accentué. Pas d'aplat saturé : un onglet actif n'est pas un bouton d'action, il ne doit pas
 * rivaliser avec le vrai bouton de l'écran.
 */
export function segmentStyles(c: AppColors) {
  return {
    bar: {
      flexDirection: 'row',
      gap: 4,
      padding: 4,
      backgroundColor: c.background,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
    } as ViewStyle,
    item: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      paddingVertical: 9,
      paddingHorizontal: 4,
      borderRadius: 9,
      ...pressableWeb,
    } as ViewStyle,
    itemActive: { backgroundColor: c.primary + '1F' } as ViewStyle,
    label: { fontSize: 12.5, fontWeight: '600', color: c.textSecondary, flexShrink: 1 } as TextStyle,
    labelActive: { color: c.primary, fontWeight: '800' } as TextStyle,
  };
}

/**
 * ONGLETS DE PAGE — soulignés, posés sur une ligne de base.
 *
 * À ne pas confondre avec le SEGMENT ci-dessus, et la différence n'est pas décorative :
 *  • le segment sert à CHOISIR une valeur (un réglage, un filtre, une cadence) — il a la forme d'un
 *    contrôle, encadré, avec un état sélectionné plein ;
 *  • les onglets de page servent à NAVIGUER entre deux contenus de même niveau. Ils n'ont pas de
 *    cadre : ce sont des titres, et le trait sous l'actif dit simplement où l'on est.
 *
 * C'est le style des onglets « Comptes / Crédits » de la page Comptes, sorti de cet écran pour
 * servir partout où l'on partage une page entre deux vues.
 */
export function pageTabStyles(c: AppColors) {
  return {
    bar: {
      flexDirection: 'row',
      gap: 22,
      /* ── LE CONTRAT DE POSITION VIT ICI, PAS CHEZ L'APPELANT ──────────────────────────────────
         Deux pages ont porté ces onglets, chacune avec son propre retrait de colonne et sa propre
         marge : elles ne sont jamais tombées à la même hauteur, et chaque tentative de recaler
         l'une sur l'autre par un calcul (« la vue d'ensemble fait 151, donc j'ajoute 45 ») était
         fausse dès que le contenu du dessus changeait de taille.
         La règle est donc structurelle, et elle tient en deux points :
           1. l'appelant fournit un retrait horizontal de 16 et RIEN au-dessus — les onglets sont le
              PREMIER élément de la page ;
           2. le composant possède ses décalages : 8 px de retrait pour les libellés (le trait, lui,
              part du bord du contenu) et 14 px au-dessus.
         Tant que les deux points sont tenus, l'alignement est garanti sans aucune arithmétique. */
      paddingLeft: 8,
      marginTop: 14,
      marginBottom: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.cardBorder,
    } as ViewStyle,
    item: {
      paddingBottom: 8,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
      ...pressableWeb,
    } as ViewStyle,
    itemActive: { borderBottomColor: c.text } as ViewStyle,
    label: { fontSize: 17, fontWeight: '700', color: c.textSecondary } as TextStyle,
    labelActive: { color: c.text, fontWeight: '800' } as TextStyle,
  };
}

/**
 * PASTILLE — filtre non exclusif ou sélection dans une liste qui défile.
 *
 * Différente du segment : les pastilles n'ont pas de barre englobante et ne se partagent pas la
 * largeur. Une pastille active reprend exactement le contraste du segment actif (teinte à 12 % +
 * bordure d'accent), pour qu'un même état se lise pareil dans les deux composants.
 *
 * `tone` permet de teinter une pastille par la sémantique du domaine (couleur de type de compte,
 * couleur de catégorie) sans casser l'unité : seule la teinte change, jamais la géométrie.
 */
export function chipStyles(c: AppColors) {
  return {
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as ViewStyle,
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 13,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.cardBorder,
      backgroundColor: 'transparent',
      ...pressableWeb,
    } as ViewStyle,
    chipActive: { borderColor: c.primary + '66', backgroundColor: c.primary + '1F' } as ViewStyle,
    label: { fontSize: 13, fontWeight: '600', color: c.textSecondary } as TextStyle,
    labelActive: { color: c.primary, fontWeight: '700' } as TextStyle,
  };
}

/** Teinte une pastille par une couleur de domaine (type de compte, catégorie), géométrie inchangée. */
export function chipTone(active: boolean, tone: string, c: AppColors): { container: ViewStyle; label: TextStyle } {
  return {
    container: active
      ? { borderColor: tone + '66', backgroundColor: tone + '1F' }
      : { borderColor: c.cardBorder, backgroundColor: 'transparent' },
    label: { color: active ? tone : c.textSecondary, fontWeight: active ? '700' : '600' },
  };
}
