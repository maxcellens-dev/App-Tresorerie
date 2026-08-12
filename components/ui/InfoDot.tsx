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
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { glossaryEntry, type GlossaryTerm } from '../../lib/ui/glossary';
import { sheetWidth } from '../../lib/ui/appLayout';

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

          <TouchableOpacity style={[styles.btn, { backgroundColor: accent }]} onPress={onClose} activeOpacity={0.85}>
            <Text style={[styles.btnLabel, { color: COLORS.bg }]}>J'ai compris</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
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
  });
}
