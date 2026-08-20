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
import { View, Text, StyleSheet, Pressable, TouchableOpacity, Modal, ScrollView } from 'react-native';
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
  const entry = glossaryEntry(term);
  if (!entry) return null;

  const accent = (COLORS as any)[entry.color === 'green' ? 'emerald' : (entry.color ?? 'blue')] ?? COLORS.emerald;

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

          <Text style={styles.text}>{entry.text}</Text>
          {!!entry.hint && <Text style={styles.hint}>{entry.hint}</Text>}

          {/* Le profil est la seule notion de l'app qui SITUE : dire « tu es Premiers placements »
              n'apprend rien sans l'échelle qui le précède et celle qui le suit. */}
          {term === 'profil_financier' && <ProfileScale styles={styles} />}

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
function ProfileScale({ styles }: { styles: any }) {
  const COLORS = useAppColors();
  const { user } = useAuth();
  const { data: fp } = useFinancialProfile(user?.id);
  const currentRaw = (fp as any)?.profile_id as string | undefined;
  const current = currentRaw ? resolveProfileId(currentRaw) : null;

  const ladder = FINANCIAL_PROFILE_IDS.filter((id) => id !== 'P0' || current === 'P0');
  const currentRank = current ? ladder.indexOf(current) : -1;

  /* ── ON S'OUVRE SUR SON PROPRE PALIER ────────────────────────────────────────────────────────
     La liste commençait en haut, au plus fragile : quelqu'un en « Patrimoine établi » ouvrait la
     fiche et voyait six paliers qui ne le concernent pas, sans rien qui indique où il se trouve —
     il fallait faire défiler pour se découvrir. Or c'est LA question qu'on se pose en ouvrant.
     On mesure la position réelle de la ligne (`onLayout`) plutôt que de l'estimer : la ligne
     courante est plus haute que les autres (elle porte sa description), donc « index × hauteur »
     tomberait à côté. */
  const scrollRef = useRef<ScrollView>(null);
  const scrolledRef = useRef(false);
  const onCurrentLayout = (y: number) => {
    if (scrolledRef.current) return;
    scrolledRef.current = true;
    // Une poignée de pixels au-dessus : on voit qu'il existe quelque chose avant, donc que ça défile.
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 46), animated: false }));
  };

  /** Le bas de la liste est-il atteint ? Pilote le voile qui signale « ça continue ». */
  const [atEnd, setAtEnd] = useState(false);
  const [atStart, setAtStart] = useState(true);

  return (
    <View style={styles.scale}>
      <Text style={styles.scaleTitle}>Les paliers, du plus fragile au plus solide</Text>
      <View>
        <ScrollView
          ref={scrollRef}
          style={styles.scaleList}
          // L'ascenseur natif est le repère le plus universel : on le LAISSE visible.
          showsVerticalScrollIndicator
          persistentScrollbar
          scrollEventThrottle={16}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            setAtStart(contentOffset.y <= 4);
            setAtEnd(contentOffset.y + layoutMeasurement.height >= contentSize.height - 4);
          }}
        >
          {ladder.map((id, i) => {
            const info = PROFILE_INFO[id];
            if (!info) return null;
            const isCurrent = id === current;
            const passed = currentRank >= 0 && i < currentRank;
            const tint = (COLORS as any)[info.color] ?? info.color ?? COLORS.textSecondary;
            return (
              <View
                key={id}
                onLayout={isCurrent ? (e) => onCurrentLayout(e.nativeEvent.layout.y) : undefined}
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
        </ScrollView>

        {/* VOILES DE DÉBORDEMENT — le signal que la liste continue. Sans eux, une liste tronquée net
            se lit comme une liste complète : rien ne distingue « il n'y a que ça » de « la suite est
            cachée ». Ils disparaissent dès qu'on atteint le bord correspondant. */}
        {!atStart && (
          <LinearGradient
            pointerEvents="none"
            colors={[COLORS.cardSolid, COLORS.cardSolid + '00']}
            style={[styles.scaleFade, { top: 0 }]}
          />
        )}
        {!atEnd && (
          <LinearGradient
            pointerEvents="none"
            colors={[COLORS.cardSolid + '00', COLORS.cardSolid]}
            style={[styles.scaleFade, { bottom: 0 }]}
          />
        )}
      </View>
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
    text: { fontSize: 14.5, lineHeight: 21, color: c.text },
    hint: { fontSize: 12.5, lineHeight: 18, color: c.textSecondary },
    btn: { borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
    btnLabel: { fontSize: 15, fontWeight: '700' },
    // Échelle des profils (fiche « Ton profil financier » uniquement).
    scale: { gap: 8 },
    scaleTitle: { fontSize: 12, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
    /* Hauteur BORNÉE et liste défilante : dix paliers ne tiennent pas dans une fiche, et une carte
       plus haute que l'écran sortirait du cadre sans qu'on puisse la refermer. */
    scaleList: { maxHeight: 232 },
    scaleRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 7, paddingHorizontal: 9,
      borderRadius: 11, borderWidth: 1, borderColor: 'transparent', marginBottom: 3,
    },
    scaleFade: { position: 'absolute', left: 0, right: 0, height: 22 },
    scaleEmoji: { fontSize: 15, width: 20, textAlign: 'center' },
    scaleName: { fontSize: 13.5, color: c.text },
    scaleDesc: { fontSize: 11.5, lineHeight: 16, color: c.textSecondary, marginTop: 2 },
  });
}
