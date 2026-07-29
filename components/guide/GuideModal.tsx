/**
 * GuideModal — le modal du guide utilisateur, posé PAR-DESSUS la page.
 *
 * Couleurs INVERSÉES (cf. hooks/useInvertedColors) : sombre si l'app est en clair, et inversement.
 * C'est volontaire — un modal aux couleurs de la page se lit comme un bloc de plus, alors qu'ici il
 * doit se lire comme une voix qui parle par-dessus l'app.
 *
 * NON FERMABLE au tap à côté, et sans croix par défaut : une étape du guide se termine par une
 * ACTION (« J'ai compris », ou l'un des choix proposés), jamais par un tap au hasard. C'est ce qui
 * garantit que l'utilisateur a bien tous ses comptes et ses récurrences avant de voir des chiffres.
 */
import React, { useMemo } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useInvertedColors } from '../../hooks/useInvertedColors';

export interface GuideStepItem {
  icon: string;
  color?: string;
  title: string;
  text?: string;
}

export interface GuideChoice {
  icon: string;
  color?: string;
  title: string;
  text?: string;
  onPress: () => void;
}

interface Props {
  visible: boolean;
  /** Sur-titre discret (ex. « Étape 1 sur 3 »). */
  eyebrow?: string;
  icon?: string;
  iconColor?: string;
  title: string;
  text?: string;
  /** Étapes illustrées, numérotées (explication visuelle). */
  steps?: GuideStepItem[];
  /** Choix d'action : chaque ligne est un bouton. */
  choices?: GuideChoice[];
  /** Bouton principal. Absent → seuls les `choices` ferment l'étape. */
  cta?: { label: string; icon?: string; onPress: () => void; disabled?: boolean };
  /** Échappatoire explicite (ex. « Plus tard »). Absente → étape obligatoire. */
  secondary?: { label: string; onPress: () => void };
  /** Petite note en pied (précision, rassurance). */
  note?: string;
}

export default function GuideModal({
  visible, eyebrow, icon, iconColor, title, text, steps, choices, cta, secondary, note,
}: Props) {
  const c = useInvertedColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const accent = iconColor ?? c.emerald;

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
          >
            {!!icon && (
              <View style={[styles.iconCircle, { backgroundColor: accent + '26', borderColor: accent + '66' }]}>
                <Ionicons name={icon as any} size={32} color={accent} />
              </View>
            )}
            {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
            <Text style={styles.title}>{title}</Text>
            {!!text && <Text style={styles.text}>{text}</Text>}

            {!!steps?.length && (
              <View style={styles.steps}>
                {steps.map((s, i) => {
                  const col = s.color ?? c.emerald;
                  return (
                    <View key={s.title} style={styles.step}>
                      <View style={[styles.stepIcon, { backgroundColor: col + '22', borderColor: col + '55' }]}>
                        <Ionicons name={s.icon as any} size={20} color={col} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.stepTitleRow}>
                          <Text style={[styles.stepNum, { color: col }]}>{i + 1}</Text>
                          <Text style={styles.stepTitle}>{s.title}</Text>
                        </View>
                        {!!s.text && <Text style={styles.stepText}>{s.text}</Text>}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {!!choices?.length && (
              <View style={styles.choices}>
                {choices.map((ch) => {
                  const col = ch.color ?? c.emerald;
                  return (
                    <TouchableOpacity
                      key={ch.title}
                      style={[styles.choice, { borderColor: col + '66', backgroundColor: col + '14' }]}
                      onPress={ch.onPress}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                    >
                      <View style={[styles.choiceIcon, { backgroundColor: col + '26' }]}>
                        <Ionicons name={ch.icon as any} size={20} color={col} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.choiceTitle}>{ch.title}</Text>
                        {!!ch.text && <Text style={styles.choiceText}>{ch.text}</Text>}
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={col} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {!!note && <Text style={styles.note}>{note}</Text>}
          </ScrollView>

          {!!cta && (
            <TouchableOpacity
              style={[styles.cta, { backgroundColor: accent }, cta.disabled && styles.ctaOff]}
              onPress={cta.onPress}
              disabled={cta.disabled}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={styles.ctaLabel}>{cta.label}</Text>
              <Ionicons name={(cta.icon ?? 'checkmark') as any} size={18} color={c.bg} />
            </TouchableOpacity>
          )}
          {!!secondary && (
            <TouchableOpacity style={styles.secondary} onPress={secondary.onPress} hitSlop={8}>
              <Text style={styles.secondaryLabel}>{secondary.label}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    /* Voile VOLONTAIREMENT léger. Il était à 0,66 : la page disparaissait derrière, alors que ces
       étapes parlent justement de ce qu'il y a dessous (la ligne « Tu devrais encore dépenser », le
       bouton de création de compte…). On garde juste assez de contraste pour que la carte se
       détache et que le reste ne capte pas l'œil. */
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center', padding: 20 },
    card: {
      width: '100%', maxWidth: 400, maxHeight: '88%',
      backgroundColor: c.cardSolid, borderRadius: 26,
      borderWidth: 1, borderColor: c.emerald + '44',
      paddingHorizontal: 22, paddingTop: 24, paddingBottom: 18, gap: 12,
    },
    body: { alignItems: 'center', gap: 10 },
    iconCircle: {
      width: 66, height: 66, borderRadius: 33, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center', marginBottom: 4,
    },
    eyebrow: { fontSize: 11.5, fontWeight: '800', color: c.emerald, textTransform: 'uppercase', letterSpacing: 1 },
    title: { fontSize: 21, fontWeight: '800', color: c.text, textAlign: 'center', letterSpacing: -0.4 },
    text: { fontSize: 14.5, color: c.textSecondary, textAlign: 'center', lineHeight: 21 },

    steps: { width: '100%', gap: 12, marginTop: 8 },
    step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    stepIcon: { width: 42, height: 42, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    stepTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    stepNum: { fontSize: 12, fontWeight: '900' },
    stepTitle: { flex: 1, fontSize: 14.5, fontWeight: '800', color: c.text },
    stepText: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18, marginTop: 2 },

    choices: { width: '100%', gap: 10, marginTop: 6 },
    choice: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 12 },
    choiceIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    choiceTitle: { fontSize: 14.5, fontWeight: '800', color: c.text },
    choiceText: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginTop: 2 },

    note: { fontSize: 12, color: c.textSecondary, textAlign: 'center', lineHeight: 17, marginTop: 6, fontStyle: 'italic' },

    cta: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      borderRadius: 16, paddingVertical: 15,
    },
    ctaOff: { opacity: 0.45 },
    ctaLabel: { fontSize: 15.5, fontWeight: '800', color: c.bg },
    secondary: { alignItems: 'center', paddingVertical: 8 },
    secondaryLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, textDecorationLine: 'underline' },
  });
}
