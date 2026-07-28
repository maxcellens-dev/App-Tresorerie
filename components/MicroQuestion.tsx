/**
 * MicroQuestion — la carte d'une question du profil progressif.
 *
 * Choix d'affichage assumés :
 *  • carte INLINE en tête d'écran, pas un toast ni une bulle : elle ne disparaît pas toute seule,
 *    on ne peut pas la rater, et elle n'interrompt rien (l'écran reste utilisable en dessous) ;
 *  • en-tête « Affine ton profil financier · 2 sur 4 » : l'utilisateur sait où il va et pourquoi ;
 *  • deux échappatoires toujours présentes — une VRAIE réponse (« je ne sais pas », enregistrée,
 *    la question ne revient plus) et un report (« plus tard », qui la représente au prochain
 *    lancement). Aucune formulation culpabilisante, aucune barre de complétion.
 *
 * Le pilotage (quelle question, quand) appartient à lib/progressiveProfile ; ce composant ne fait
 * que rendre ce qu'on lui donne.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Animated, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useAppColors } from '../hooks/useAppColors';
import { useProgressiveProfile, type ProgressiveEventKind } from '../hooks/useProgressiveProfile';
import { CURRENCY_SYMBOL } from '../lib/currency';
import { WEEKS_PER_MONTH } from '../lib/financialProfileEngine';
import InfoDot from './InfoDot';
import type { GlossaryTerm } from '../lib/glossary';

/** Terme de glossaire associé à chaque question (pastille « ? » dans l'en-tête). */
const TERM_BY_KEY: Record<string, GlossaryTerm> = {
  q4: 'profil_financier',
  q6: 'profil_financier',
  q8: 'marge_securite',
  q9: 'enveloppe_variable',
};

interface Props {
  /**
   * Signale une interaction à l'arrivée sur l'écran hôte. C'est ce qui fait avancer la file :
   * les déclencheurs sont des choses que l'utilisateur fait forcément en naviguant, jamais un
   * événement lointain (clôture de mois, bilan) qui pourrait ne jamais se produire.
   */
  track?: ProgressiveEventKind;
  /** Marges laissées à l'écran hôte : tous n'ont pas la même gouttière horizontale. */
  style?: StyleProp<ViewStyle>;
}

export default function MicroQuestion({ track, style }: Props = {}) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { pick, answer, snooze, saving, monthlyIncome, trackEvent } = useProgressiveProfile();
  const [amount, setAmount] = useState('');
  const focused = useIsFocused();

  useEffect(() => {
    if (track && focused) trackEvent(track);
  }, [track, focused, trackEvent]);

  // Entrée douce : la carte arrive au milieu d'un écran déjà rempli, un léger mouvement attire
  // l'œil sans interrompre. Jouée une fois par question (la clé change → l'animation rejoue).
  const enter = useRef(new Animated.Value(0)).current;
  const enterScale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });
  const questionKey = pick?.question.key;
  useEffect(() => {
    if (!questionKey) return;
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [questionKey, enter]);

  if (!pick) return null;
  const q = pick.question;

  const submitAmount = () => {
    const clean = amount.replace(/[^0-9.,]/g, '').replace(',', '.');
    const n = parseFloat(clean);
    answer(q.key, Number.isFinite(n) && n > 0 ? String(n) : q.unknownValue);
    setAmount('');
  };

  // Illustration en euros des tranches d'épargne : « Entre 10 et 20 % » → « ≈ 180 à 365 € / mois ».
  const pctHint = (label: string): string | null => {
    if (q.key !== 'q6' || monthlyIncome <= 0) return null;
    const m = label.match(/(\d+)\s*(?:et\s*(\d+))?\s*%/);
    if (!m) return null;
    const lo = Math.round((monthlyIncome * Number(m[1])) / 100);
    const hi = m[2] ? Math.round((monthlyIncome * Number(m[2])) / 100) : null;
    return hi ? `≈ ${lo} à ${hi} ${CURRENCY_SYMBOL}/mois` : `≈ ${lo} ${CURRENCY_SYMBOL}/mois`;
  };

  const monthEquivalent = (() => {
    if (q.key !== 'q9') return null;
    const n = parseFloat(amount.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return null;
    return `soit environ ${Math.round(n * WEEKS_PER_MONTH).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL} par mois`;
  })();

  return (
    <Animated.View style={[styles.card, style, { opacity: enter, transform: [{ scale: enterScale }] }]}>
      {/* Bandeau plein : c'est lui qui fait ressortir la carte au milieu d'un écran de listes.
          Une bordure fine ne suffisait pas — la question se fondait dans les autres cartes. */}
      <View style={styles.band}>
        <Ionicons name="sparkles" size={13} color={COLORS.bg} />
        <Text style={styles.bandText} numberOfLines={1}>
          {q.affectsProfile ? 'Affine ton profil financier' : 'Pour des chiffres justes'}
        </Text>
        <View style={styles.bandCount}>
          <Text style={styles.bandCountText}>{pick.step}/{pick.total}</Text>
        </View>
        <InfoDot term={TERM_BY_KEY[q.key] ?? 'profil_financier'} size={15} color={COLORS.bg} />
      </View>

      <View style={styles.inner}>
      <Text style={styles.title}>{q.title}</Text>
      <Text style={styles.why}>{q.why}</Text>
      {!!q.frame && <Text style={styles.frame}>{q.frame}</Text>}

      {q.kind === 'choice' ? (
        <View style={styles.options}>
          {(q.options ?? []).map((opt) => {
            const hint = pctHint(opt.label);
            return (
              <TouchableOpacity
                key={opt.value}
                style={styles.option}
                activeOpacity={0.75}
                disabled={saving}
                onPress={() => answer(q.key, opt.value)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionLabel}>{opt.label}</Text>
                  {!!hint && <Text style={styles.optionHint}>{hint}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <View style={styles.amountBox}>
          <Text style={styles.amountLabel}>{q.amountLabel}</Text>
          <View style={styles.amountRow}>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={(v) => setAmount(v.replace(/[^0-9.,]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={COLORS.textSecondary}
              onSubmitEditing={submitAmount}
              returnKeyType="done"
            />
            <Text style={styles.amountUnit}>
              {CURRENCY_SYMBOL}{q.amountUnit === 'week' ? ' / semaine' : ''}
            </Text>
          </View>
          {!!monthEquivalent && <Text style={styles.amountHint}>{monthEquivalent}</Text>}
          <TouchableOpacity
            style={[styles.validate, (!amount || saving) && { opacity: 0.45 }]}
            onPress={submitAmount}
            disabled={!amount || saving}
            activeOpacity={0.85}
          >
            <Text style={styles.validateLabel}>Enregistrer</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.escape}
          onPress={() => answer(q.key, q.unknownValue)}
          disabled={saving}
          activeOpacity={0.7}
        >
          <Text style={styles.escapeText}>{q.unknownLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.escape} onPress={() => snooze(q.key)} activeOpacity={0.7}>
          <Text style={styles.escapeText}>Plus tard</Text>
        </TouchableOpacity>
      </View>
      </View>
    </Animated.View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.cardSolid,
      borderWidth: 1.5, borderColor: c.blue,
      borderRadius: 20, marginBottom: 14, overflow: 'hidden',
      // Halo bleu : la carte « flotte » au-dessus des listes au lieu d'être une carte de plus.
      shadowColor: c.blue, shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.28, shadowRadius: 14, elevation: 8,
    },
    band: {
      flexDirection: 'row', alignItems: 'center', gap: 7,
      backgroundColor: c.blue, paddingHorizontal: 14, paddingVertical: 9,
    },
    bandText: {
      flex: 1, fontSize: 11, fontWeight: '800', color: c.bg,
      textTransform: 'uppercase', letterSpacing: 0.7,
    },
    bandCount: {
      backgroundColor: c.bg + '2E', borderRadius: 999,
      paddingHorizontal: 8, paddingVertical: 2,
    },
    bandCountText: { fontSize: 10.5, fontWeight: '800', color: c.bg },
    inner: { padding: 16, gap: 8 },
    title: { fontSize: 17.5, fontWeight: '800', color: c.text, lineHeight: 23, letterSpacing: -0.3 },
    why: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },
    frame: {
      fontSize: 12, color: c.textSecondary, lineHeight: 17, fontStyle: 'italic',
      backgroundColor: c.card, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7,
    },
    options: { gap: 7, marginTop: 2 },
    option: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: c.bg, borderWidth: 1, borderColor: c.blue + '33',
      borderRadius: 13, paddingHorizontal: 13, paddingVertical: 11,
    },
    optionLabel: { fontSize: 14, color: c.text, lineHeight: 19 },
    optionHint: { fontSize: 11.5, color: c.textSecondary, marginTop: 2 },
    amountBox: { gap: 8, marginTop: 2 },
    amountLabel: { fontSize: 12, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
    amountRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.card, borderWidth: 1.5, borderColor: c.blue,
      borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    },
    amountInput: { flex: 1, fontSize: 26, fontWeight: '800', color: c.text, padding: 0 },
    amountUnit: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
    amountHint: { fontSize: 12, color: c.textSecondary },
    validate: {
      backgroundColor: c.blue, borderRadius: 13, paddingVertical: 12, alignItems: 'center',
    },
    validateLabel: { fontSize: 14.5, fontWeight: '700', color: c.bg },
    footer: { flexDirection: 'row', gap: 8, marginTop: 4 },
    escape: {
      flex: 1, alignItems: 'center', paddingVertical: 10,
      borderRadius: 11, borderWidth: 1, borderColor: c.cardBorder,
    },
    escapeText: { fontSize: 12.5, fontWeight: '600', color: c.textSecondary, textAlign: 'center' },
  });
}
