/**
 * PilotageWelcome — l'accueil du tableau de bord TANT QU'IL N'A RIEN À DIRE.
 *
 * Un tableau de bord sans données n'est pas un tableau de bord : c'est une grille de zéros qui donne
 * l'impression que l'app ne marche pas, et qui n'indique nulle part par où commencer. Tant qu'aucun
 * compte n'existe, on remplace donc TOUT le contenu du Pilotage par un accueil qui ne dit qu'une
 * chose : va créer tes comptes (variante `accounts`).
 *
 * Une fois les comptes créés, les chiffres ont un sens et le tableau de bord reprend sa place — mais
 * sans aucune opération il reste incomplet : la variante `transactions` (compacte, posée en tête)
 * envoie alors saisir les premières.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { useInvertedColors } from '../hooks/useInvertedColors';

interface Props {
  variant: 'accounts' | 'transactions';
  /** Version compacte : une carte posée en tête du tableau de bord (au lieu de le remplacer). */
  compact?: boolean;
  firstName?: string | null;
  onPress: () => void;
}

export default function PilotageWelcome({ variant, compact, firstName, onPress }: Props) {
  const APP = useAppColors();
  const INV = useInvertedColors();
  // La carte compacte est une CONSIGNE de démarrage, au même titre que les modaux du guide : elle
  // est donc en couleurs inversées pour trancher sur la page. Le plein écran, lui, EST la page.
  const COLORS = compact ? INV : APP;
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);

  const isAccounts = variant === 'accounts';
  const accent = isAccounts ? COLORS.emerald : COLORS.orange;
  const hello = firstName ? `Bienvenue ${firstName},` : 'Bienvenue,';

  const title = isAccounts ? 'Commence par \ncréer tes comptes' : 'Il manque tes opérations';
  const text = isAccounts
    ? 'Relyka ne devine rien : \nil part des soldes réels de tes comptes. \n\nAjoute-les avec le montant affiché aujourd’hui par ta banque, et ton tableau de bord se remplira tout seul.'
    : 'Tes comptes sont là, mais aucune opération n’est encore enregistrée : Relyka ne sait ni ce qui rentre, ni ce qui part. Commence par ton salaire et tes charges fixes.';
  const cta = isAccounts ? 'Créer mes comptes' : 'Saisir mes opérations';

  if (compact) {
    return (
      <TouchableOpacity style={[styles.card, { borderColor: accent + '55' }]} onPress={onPress} activeOpacity={0.85} accessibilityRole="button">
        <View style={[styles.cardIcon, { backgroundColor: accent + '1F' }]}>
          <Ionicons name="swap-vertical" size={20} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardText}>{text}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={accent} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={[styles.halo, { backgroundColor: accent + '14', borderColor: accent + '2A' }]}>
        <View style={[styles.circle, { backgroundColor: accent + '22', borderColor: accent + '55' }]}>
          <Ionicons name="wallet-outline" size={38} color={accent} />
        </View>
      </View>

      <Text style={styles.hello}>{hello}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.text}>{text}</Text>

      {/* Ce qui se débloque ensuite : on montre la contrepartie, pas seulement la corvée. */}
      <View style={styles.steps}>
        {[
          { icon: 'wallet-outline', label: 'Tes comptes', done: false },
          { icon: 'repeat', label: 'Ce qui revient chaque mois', done: false },
          { icon: 'sparkles', label: 'Ton Relyka et tes conseils', done: false },
        ].map((s, i) => (
          <View key={s.label} style={styles.step}>
            <View style={[styles.stepDot, i === 0 && { borderColor: accent, backgroundColor: accent + '1F' }]}>
              <Ionicons name={s.icon as any} size={13} color={i === 0 ? accent : COLORS.textSecondary} />
            </View>
            <Text style={[styles.stepLabel, i === 0 && { color: COLORS.text, fontWeight: '700' }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity style={[styles.cta, { backgroundColor: accent }]} onPress={onPress} activeOpacity={0.85} accessibilityRole="button">
        <Ionicons name="add" size={20} color={COLORS.bg} />
        <Text style={styles.ctaLabel}>{cta}</Text>
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
