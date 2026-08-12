/**
 * PilotageWelcome — l'accueil du tableau de bord TANT QU'IL N'A RIEN À DIRE.
 *
 * Un tableau de bord sans données n'est pas un tableau de bord : c'est une grille de zéros qui donne
 * l'impression que l'app ne marche pas, et qui n'indique nulle part par où commencer. Tant que
 * l'installation n'est pas assez avancée pour que le Relyka soit calculable, on remplace donc TOUT
 * le contenu du Pilotage par cet accueil, dont le bouton porte la PROCHAINE action à faire.
 *
 * « Assez avancée » veut dire deux choses, dans cet ordre : des comptes (sinon aucun solde), puis
 * au moins une opération récurrente (sinon l'app ne sait ni ce qui rentre ni ce qui part). Les deux
 * réglages qui suivent — dépenses variables, marge de sécurité — se renseignent, eux, PAR-DESSUS le
 * tableau de bord : ils affinent un Relyka qui existe déjà, et on doit voir la ligne qu'ils pilotent.
 */
import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useInvertedColors } from '../../hooks/theme/useInvertedColors';

/** L'étape en cours, telle que le parcours la voit (cf. contexts/GuideContext). */
export type WelcomeStep = 'accounts' | 'checking' | 'savings' | 'recurring';

interface Props {
  step: WelcomeStep;
  /** Version compacte : une carte posée en tête du tableau de bord (au lieu de le remplacer).
   *  Sert HORS parcours, à un compte qui a des soldes mais aucune opération. */
  compact?: boolean;
  firstName?: string | null;
  onPress: () => void;
}

/** Ce que chaque étape raconte, et ce vers quoi elle envoie. */
const STEP_COPY: Record<WelcomeStep, { title: string; text: string; cta: string; icon: string }> = {
  accounts: {
    title: 'Commence par \ncréer tes comptes',
    text: 'Relyka ne devine rien : il part des soldes réels de tes comptes.\n\nAjoute-les avec le montant affiché aujourd’hui par ta banque, et ton tableau de bord se remplira tout seul.',
    cta: 'Créer mes comptes',
    icon: 'wallet-outline',
  },
  checking: {
    title: 'Il te manque \nun compte courant',
    text: 'C’est le compte sur lequel ton argent arrive et tes charges partent. Sans lui, impossible de savoir ce qu’il te reste.',
    cta: 'Ajouter mon compte courant',
    icon: 'card-outline',
  },
  savings: {
    title: 'Et ton épargne ?',
    text: 'Livret A, LDDS, PEA… c’est ce qui permet de calculer ton matelas de sécurité : combien de mois tu tiendrais sans rentrée d’argent.',
    cta: 'Ajouter mon épargne',
    icon: 'leaf-outline',
  },
  recurring: {
    title: 'Il manque \ntes opérations',
    text: 'Tes comptes sont là, mais Relyka ne sait ni ce qui rentre, ni ce qui part. Enregistre ton salaire et tes charges fixes en récurrentes : tu ne les saisis qu’une fois.',
    cta: 'Saisir mes opérations',
    icon: 'repeat',
  },
};

/** Les quatre jalons du démarrage, dans l'ordre. Sert à situer l'étape en cours. */
const MILESTONES: { icon: string; label: string; steps: WelcomeStep[] }[] = [
  { icon: 'wallet-outline', label: 'Tes comptes', steps: ['accounts', 'checking', 'savings'] },
  { icon: 'repeat', label: 'Ce qui revient chaque mois', steps: ['recurring'] },
  { icon: 'options-outline', label: 'Tes deux repères', steps: [] },
  { icon: 'sparkles', label: 'Ton Relyka et ton profil', steps: [] },
];

export default function PilotageWelcome({ step, compact, firstName, onPress }: Props) {
  const APP = useAppColors();
  const INV = useInvertedColors();
  // La carte compacte est une CONSIGNE de démarrage, au même titre que les modaux du guide : elle
  // est donc en couleurs inversées pour trancher sur la page. Le plein écran, lui, EST la page.
  const COLORS = compact ? INV : APP;
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);

  const copy = STEP_COPY[step];
  const isAccounts = step !== 'recurring';
  const accent = isAccounts ? COLORS.emerald : COLORS.orange;
  const hello = firstName ? `Bienvenue ${firstName},` : 'Bienvenue,';
  // Index du jalon en cours : tout ce qui précède est acquis.
  const currentMilestone = Math.max(0, MILESTONES.findIndex((m) => m.steps.includes(step)));

  if (compact) {
    return (
      <TouchableOpacity style={[styles.card, { borderColor: accent + '55' }]} onPress={onPress} activeOpacity={0.85} accessibilityRole="button">
        <View style={[styles.cardIcon, { backgroundColor: accent + '1F' }]}>
          <Ionicons name={copy.icon as any} size={20} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{copy.title.replace(/\n/g, '')}</Text>
          <Text style={styles.cardText}>{copy.text}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={accent} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={[styles.halo, { backgroundColor: accent + '14', borderColor: accent + '2A' }]}>
        <View style={[styles.circle, { backgroundColor: accent + '22', borderColor: accent + '55' }]}>
          <Ionicons name={copy.icon as any} size={38} color={accent} />
        </View>
      </View>

      <Text style={styles.hello}>{hello}</Text>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.text}>{copy.text}</Text>

      {/* Ce qui se débloque ensuite : on montre la contrepartie, pas seulement la corvée. */}
      <View style={styles.steps}>
        {MILESTONES.map((m, i) => {
          const done = i < currentMilestone;
          const current = i === currentMilestone;
          return (
            <View key={m.label} style={styles.step}>
              <View style={[
                styles.stepDot,
                current && { borderColor: accent, backgroundColor: accent + '1F' },
                done && { borderColor: COLORS.emerald, backgroundColor: COLORS.emerald + '1F' },
              ]}>
                <Ionicons
                  name={(done ? 'checkmark' : m.icon) as any}
                  size={13}
                  color={done ? COLORS.emerald : current ? accent : COLORS.textSecondary}
                />
              </View>
              <Text style={[styles.stepLabel, current && { color: COLORS.text, fontWeight: '700' }]}>{m.label}</Text>
            </View>
          );
        })}
      </View>

      <TouchableOpacity style={[styles.cta, { backgroundColor: accent }]} onPress={onPress} activeOpacity={0.85} accessibilityRole="button">
        <Ionicons name="add" size={20} color={COLORS.bg} />
        <Text style={styles.ctaLabel}>{copy.cta}</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: { alignItems: 'center', paddingHorizontal: 26, paddingTop: 36, paddingBottom: 24, gap: 10 },
    halo: {
      width: 118, height: 118, borderRadius: 59, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center', marginBottom: 12,
    },
    circle: { width: 84, height: 84, borderRadius: 42, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

    hello: { fontSize: 19, fontWeight: '700', color: c.textSecondary, textAlign: 'center' },
    title: { fontSize: 27, fontWeight: '800', color: c.text, textAlign: 'center', letterSpacing: -0.7, lineHeight: 33 },
    text: { fontSize: 14.5, color: c.textSecondary, textAlign: 'center', lineHeight: 21, marginTop: 4 },

    steps: { width: '100%', gap: 9, marginTop: 22, marginBottom: 6 },
    step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    stepDot: {
      width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder,
      alignItems: 'center', justifyContent: 'center',
    },
    stepLabel: { flex: 1, fontSize: 13.5, color: c.textSecondary },

    cta: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      borderRadius: 16, paddingVertical: 16, paddingHorizontal: 24, width: '100%', marginTop: 14,
    },
    ctaLabel: { fontSize: 16, fontWeight: '800', color: c.bg },

    card: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      // Fond OPAQUE (cardSolid) : en couleurs inversées, une carte translucide laisserait
      // transparaître la page et perdrait tout son contraste.
      backgroundColor: c.cardSolid, borderWidth: 1, borderRadius: 18,
      paddingHorizontal: 14, paddingVertical: 13, marginBottom: 14, marginHorizontal: 4,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
    },
    cardIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    cardTitle: { fontSize: 14.5, fontWeight: '800', color: c.text },
    cardText: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginTop: 2 },
  });
}
