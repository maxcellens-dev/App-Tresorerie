/**
 * InfoDot — pastille « ? » + fiche courte, à accoler à tout terme propriétaire.
 *
 * Principe (§1 du chantier découverte) : on explique une notion LÀ OÙ elle apparaît, au moment où
 * l'utilisateur la lit ou doit la renseigner pour la première fois — pas dans un tutoriel d'accueil
 * qu'on oublie. Le contenu vient de `lib/glossary.ts` : un terme = une fiche = un seul endroit.
 *
 * Rendu via `<Modal>` et NON via `RootPortal` : la pastille vit très souvent DANS un autre modal
 * (le détail « Ton Relyka », la vue de découverte, une feuille de réglage). Un portail racine reste
 * dans la fenêtre principale et se retrouve donc DESSOUS — la fiche s'ouvrait derrière le modal
 * hôte, illisible. Les Modals, eux, s'empilent correctement. La règle « RootPortal » du projet vise
 * les calques POSITIONNÉS À LA MESURE (surlignages du guide), ce qui n'est pas le cas ici : la
 * fiche est centrée.
 *
 * Usage :
 *   <Text>Ta marge de sécurité <InfoDot term="marge_securite" /></Text>
 *   <InfoDot term="relyka" size={18} color={COLORS.emerald} />
 */
import { useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, TouchableOpacity, Modal, ScrollView, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { glossaryEntry, type GlossaryTerm } from '../../lib/ui/glossary';
import { sheetWidth } from '../../lib/ui/appLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useFinancialProfile } from '../../hooks/pilotage/useFinancialProfile';
import { FINANCIAL_PROFILE_IDS, PROFILE_INFO, resolveProfileId } from '../../lib/finance/financialProfileEngine';

interface Props {
  term: GlossaryTerm;
  /** Diamètre de la pastille (défaut 15). */
  size?: number;
  /** Couleur de la pastille — défaut : gris secondaire (discret). */
  color?: string;
  /** Décalage vertical fin pour l'aligner sur la ligne de texte. */
  style?: any;
  /**
   * À poser quand la pastille est rendue À L'INTÉRIEUR d'une carte elle-même cliquable.
   *
   * Sur react-native-web, `accessibilityRole="button"` produit un vrai `<button>` : imbriqué dans
   * un autre, le HTML est invalide et la navigation au clavier casse. On renonce alors au rôle
   * pour laisser la carte porter l'action principale — le libellé de la pastille reste annoncé.
   */
  insidePressable?: boolean;
}

export default function InfoDot({ term, size = 15, color, style, insidePressable }: Props) {
  const COLORS = useAppColors();
  const [open, setOpen] = useState(false);
  const entry = glossaryEntry(term);
  const tint = color ?? COLORS.textSecondary;

  if (!entry) return null;

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        /* Le rôle « bouton » est OMIS quand la pastille vit à l'intérieur d'une carte cliquable :
           react-native-web rendrait alors un <button> dans un <button>, ce que le HTML interdit
           (et qui casse la navigation au clavier). Le libellé, lui, reste annoncé. */
        accessibilityRole={insidePressable ? undefined : 'button'}
        accessibilityLabel={`Qu'est-ce que « ${entry.title} » ?`}
        style={[
          {
            width: size, height: size, borderRadius: size / 2,
            borderWidth: 1, borderColor: tint,
            alignItems: 'center', justifyContent: 'center',
            opacity: 0.75,
          },
          style,
        ]}
      >
        <Text style={{ fontSize: size * 0.66, lineHeight: size, fontWeight: '800', color: tint }}>?</Text>
      </TouchableOpacity>

      {open && <GlossarySheet term={term} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Fiche du glossaire — utilisable seule (sans pastille) quand l'ouverture est déclenchée
 * autrement : lien texte, première visite d'un écran, bouton d'un encart pédagogique.
 */
export function GlossarySheet({ term, onClose }: { term: GlossaryTerm; onClose: () => void }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { height: windowHeight } = useWindowDimensions();
  const entry = glossaryEntry(term);

  /* ── UNE SEULE SURFACE DÉFILANTE, ET ELLE EST GRANDE ─────────────────────────────────────────
     L'échelle des profils vivait dans sa PROPRE zone défilante, haute de 232 px, à l'intérieur
     d'une carte qui ne défilait pas. Deux conséquences, et la seconde est la pire :
       • il fallait viser une bande étroite au milieu du modal pour faire défiler dix paliers dont
         le contenu fait presque le double — geste minuscule, course minuscule ;
       • tout ce qui est AUTOUR (définition, précision, bouton) était figé : sur un écran court, la
         carte pouvait dépasser la fenêtre sans que rien ne puisse la ramener.
     Le corps de la fiche est donc devenu la zone défilante — toute la hauteur disponible, une seule
     course, un seul geste. L'en-tête et le bouton restent épinglés : « Fermer » et « J'ai compris »
     ne doivent jamais partir hors d'atteinte, quel que soit le contenu.

     La hauteur est bornée à la FENÊTRE (et non à une constante) : la réserve couvre l'en-tête, le
     bouton, les marges de la carte et celles du voile. Une fiche courte ne l'atteint jamais et
     s'affiche exactement comme avant — rien ne défile s'il n'y a rien à défiler. */
  const bodyRef = useRef<ScrollView>(null);
  /** Hauteur visible et hauteur du contenu : c'est leur écart qui dit s'il y a matière à défiler. */
  const sizes = useRef<{ vh?: number; ch?: number }>({});
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  /* Où se trouve le palier de l'utilisateur, une fois mesuré (cf. ProfileScale). */
  const currentRow = useRef<{ top?: number; height?: number }>({});
  const revealed = useRef(false);

  /**
   * AMENER SON PALIER À L'ÉCRAN — le moins possible.
   *
   * La version précédente positionnait la liste SUR le palier courant à l'ouverture. C'était juste
   * tant que seule la liste défilait ; avec une surface unique, ça ferait sauter par-dessus la
   * définition — on ouvrirait une fiche explicative au milieu de son contenu.
   * On ne défile donc que si la ligne est réellement hors du cadre, et seulement de ce qu'il faut
   * pour la révéler : sur un grand écran, rien ne bouge du tout.
   */
  const tryReveal = () => {
    const { vh } = sizes.current;
    const { top, height } = currentRow.current;
    if (revealed.current || vh == null || top == null || height == null) return;
    revealed.current = true;
    const hidden = top + height + 16 - vh;   // 16 px de respiration sous la ligne
    if (hidden <= 0) return;                 // déjà visible : on ne touche à rien
    requestAnimationFrame(() => bodyRef.current?.scrollTo({ y: hidden, animated: false }));
  };

  const onMeasured = () => {
    const { vh, ch } = sizes.current;
    if (vh != null && ch != null) { setAtEnd(ch <= vh + 4); setAtStart(true); }
    tryReveal();
  };

  if (!entry) return null;

  const accent = (COLORS as any)[entry.color === 'green' ? 'emerald' : (entry.color ?? 'blue')] ?? COLORS.emerald;
  /* Réserve : en-tête (38) + bouton (46) + intervalles (36) + marges de la carte (44) + voile (48). */
  const bodyMaxHeight = Math.max(140, windowHeight - 212);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <View style={[styles.icon, { backgroundColor: accent + '1F', borderColor: accent + '4D' }]}>
              <Ionicons name={(entry.icon ?? 'help-circle-outline') as any} size={20} color={accent} />
            </View>
            <Text style={[styles.title, { color: accent }]} numberOfLines={2}>{entry.title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10} style={{ padding: 2 }} accessibilityLabel="Fermer">
              <Ionicons name="close" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <View>
            <ScrollView
              ref={bodyRef}
              style={{ maxHeight: bodyMaxHeight }}
              contentContainerStyle={styles.body}
              // L'ascenseur natif est le repère le plus universel : on le LAISSE visible.
              showsVerticalScrollIndicator
              persistentScrollbar
              // Android : la fiche s'ouvre souvent DANS un autre modal ou au-dessus d'une page
              // défilante — sans ça, le geste peut repartir au parent au lieu de rester ici.
              nestedScrollEnabled
              scrollEventThrottle={16}
              onLayout={(e) => { sizes.current.vh = e.nativeEvent.layout.height; onMeasured(); }}
              onContentSizeChange={(_w, h) => { sizes.current.ch = h; onMeasured(); }}
              onScroll={(e) => {
                const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
                setAtStart(contentOffset.y <= 4);
                setAtEnd(contentOffset.y + layoutMeasurement.height >= contentSize.height - 4);
              }}
            >
              <Text style={styles.text}>{entry.text}</Text>
              {!!entry.hint && <Text style={styles.hint}>{entry.hint}</Text>}

              {/* Le profil est la seule notion de l'app qui SITUE : dire « tu es Placements lancés »
                  n'apprend rien sans l'échelle qui le précède et celle qui le suit. */}
              {term === 'profil_financier' && (
                <ProfileScale
                  styles={styles}
                  onLocateCurrent={(top, height) => { currentRow.current = { top, height }; tryReveal(); }}
                />
              )}
            </ScrollView>

            {/* VOILES DE DÉBORDEMENT — le signal que le contenu continue. Sans eux, un contenu tronqué
                net se lit comme un contenu complet : rien ne distingue « il n'y a que ça » de « la
                suite est cachée ». Ils disparaissent dès qu'on atteint le bord correspondant. */}
            {!atStart && (
              <LinearGradient
                pointerEvents="none"
                colors={[COLORS.cardSolid, COLORS.cardSolid + '00']}
                style={[styles.bodyFade, { top: 0 }]}
              />
            )}
            {!atEnd && (
              <LinearGradient
                pointerEvents="none"
                colors={[COLORS.cardSolid + '00', COLORS.cardSolid]}
                style={[styles.bodyFade, { bottom: 0 }]}
              />
            )}
          </View>

          <TouchableOpacity style={[styles.btn, { backgroundColor: accent }]} onPress={onClose} activeOpacity={0.85}>
            <Text style={[styles.btnLabel, { color: COLORS.bg }]}>J'ai compris</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * L'ÉCHELLE COMPLÈTE DES PROFILS, avec le sien mis en évidence.
 *
 * La fiche disait ce que fait le profil, jamais où l'on se situe. « Premiers placements » ne veut
 * rien dire tout seul : c'est un rang, et un rang ne s'entend que dans une suite. Voir les dix
 * paliers, et le sien au milieu, répond à la seule question qu'on se pose vraiment — d'où je viens,
 * et qu'est-ce qui vient après.
 *
 * P0 (Découverte) est écarté quand on n'y est pas : il ne classe rien, il dit qu'il manque des
 * données. L'afficher comme un barreau de l'échelle laisserait croire à un palier « en dessous du
 * plus bas ».
 */
function ProfileScale({
  styles,
  onLocateCurrent,
}: {
  styles: any;
  /** Position de la ligne « toi » DANS le corps défilant, une fois mesurée (cf. GlossarySheet). */
  onLocateCurrent?: (top: number, height: number) => void;
}) {
  const COLORS = useAppColors();
  const { user } = useAuth();
  const { data: fp } = useFinancialProfile(user?.id);
  const currentRaw = (fp as any)?.profile_id as string | undefined;
  const current = currentRaw ? resolveProfileId(currentRaw) : null;

  const ladder = FINANCIAL_PROFILE_IDS.filter((id) => id !== 'P0' || current === 'P0');
  const currentRank = current ? ladder.indexOf(current) : -1;

  /* ── OÙ SE TROUVE SON PROPRE PALIER ──────────────────────────────────────────────────────────
     La liste commençait en haut, au plus fragile : quelqu'un en « Patrimoine établi » ouvrait la
     fiche et voyait six paliers qui ne le concernent pas, sans rien qui indique où il se trouve —
     il fallait faire défiler pour se découvrir. Or c'est LA question qu'on se pose en ouvrant.

     On MESURE la ligne (`onLayout`) plutôt que de l'estimer : la ligne courante est plus haute que
     les autres (elle porte sa description), donc « index × hauteur » tomberait à côté.

     ⚠️ DEUX MESURES, PAS UNE. `layout.y` est relatif au PARENT direct — la liste n'étant plus sa
     propre zone défilante, il faut y ajouter l'offset de ce bloc dans le corps de la fiche. C'est
     le prix de la surface unique, et il se paie ici plutôt que par un `measureLayout` (interdit :
     il lève sur react-native-web) ou par une estimation qui dériverait au premier changement de
     police. Les deux mesures arrivent dans un ordre non garanti : on n'annonce qu'une fois les
     deux connues. */
  const geo = useRef<{ blockTop?: number; rowTop?: number; rowHeight?: number }>({});
  const announced = useRef(false);
  const announce = () => {
    const { blockTop, rowTop, rowHeight } = geo.current;
    if (announced.current || blockTop == null || rowTop == null || rowHeight == null) return;
    announced.current = true;
    onLocateCurrent?.(blockTop + rowTop, rowHeight);
  };

  return (
    <View
      style={styles.scale}
      onLayout={(e) => { geo.current.blockTop = e.nativeEvent.layout.y; announce(); }}
    >
      <Text style={styles.scaleTitle}>Les paliers, du plus fragile au plus solide</Text>
      {ladder.map((id, i) => {
        const info = PROFILE_INFO[id];
        if (!info) return null;
        const isCurrent = id === current;
        const passed = currentRank >= 0 && i < currentRank;
        const tint = (COLORS as any)[info.color] ?? info.color ?? COLORS.textSecondary;
        return (
          <View
            key={id}
            onLayout={isCurrent ? (e) => {
              geo.current.rowTop = e.nativeEvent.layout.y;
              geo.current.rowHeight = e.nativeEvent.layout.height;
              announce();
            } : undefined}
            style={[styles.scaleRow, isCurrent && { backgroundColor: tint + '1A', borderColor: tint + '59' }]}
          >
            <Text style={styles.scaleEmoji}>{info.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.scaleName, isCurrent && { color: tint, fontWeight: '800' }]}>
                {info.name}{isCurrent ? ' — toi' : ''}
              </Text>
              {isCurrent && <Text style={styles.scaleDesc}>{info.description}</Text>}
            </View>
            {/* Repère discret : ce qui est derrière soi, et ce qui reste devant. */}
            {passed && <Ionicons name="checkmark" size={14} color={COLORS.textSecondary} />}
          </View>
        );
      })}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center', justifyContent: 'center', padding: 24,
    },
    card: {
      ...sheetWidth,
      maxWidth: 380,
      backgroundColor: c.cardSolid,
      borderRadius: 24, borderWidth: 1, borderColor: c.cardBorder,
      padding: 22, gap: 12,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
    title: { flex: 1, fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
    /* LE CORPS DÉFILANT — tout ce qui n'est ni l'en-tête ni le bouton. `gap` reprend celui que la
       carte appliquait à ces enfants avant qu'ils ne descendent d'un cran. */
    body: { gap: 12, paddingBottom: 2 },
    bodyFade: { position: 'absolute', left: 0, right: 0, height: 22 },
    text: { fontSize: 14.5, lineHeight: 21, color: c.text },
    hint: { fontSize: 12.5, lineHeight: 18, color: c.textSecondary },
    btn: { borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
    btnLabel: { fontSize: 15, fontWeight: '700' },
    // Échelle des profils (fiche « Ton profil financier » uniquement).
    scale: { gap: 8 },
    scaleTitle: { fontSize: 12, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
    scaleRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 7, paddingHorizontal: 9,
      borderRadius: 11, borderWidth: 1, borderColor: 'transparent', marginBottom: 3,
    },
    scaleEmoji: { fontSize: 15, width: 20, textAlign: 'center' },
    scaleName: { fontSize: 13.5, color: c.text },
    scaleDesc: { fontSize: 11.5, lineHeight: 16, color: c.textSecondary, marginTop: 2 },
  });
}
