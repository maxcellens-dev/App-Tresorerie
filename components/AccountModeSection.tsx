// Mode d'usage d'un compte partagé/joint (périmètre quotidien), réglé par CHAQUE participant.
//   • Contribution : le compte sert aux charges communes ; vos virements vers lui = dépenses, ses
//     prélèvements internes sont invisibles pour votre budget.
//   • Suivi partagé : vous suivez le compte au quotidien ; ses dépenses comptent dans votre budget
//     à hauteur de votre part.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { useAuth } from '../contexts/AuthContext';
import { useMySharedMode, useSetSharedMode } from '../hooks/useSharedMode';
import { effectiveSharedMode, type SharedMode } from '../lib/perimeter';
import type { Account } from '../types/database';

const OPTIONS: { mode: SharedMode; icon: string; title: string; desc: string }[] = [
  {
    mode: 'contribution', icon: 'home-outline',
    title: 'Pour les charges communes',
    desc: 'Loyer, crédits, copro… Vos virements vers ce compte comptent comme des dépenses ; ce qui s’y passe ensuite n’encombre pas votre budget.',
  },
  {
    mode: 'tracked', icon: 'cart-outline',
    title: 'Au quotidien',
    desc: 'Courses, sorties… Ses dépenses et recettes comptent dans votre budget, à hauteur de votre part.',
  },
];

export default function AccountModeSection({ account }: { account: Account }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { user } = useAuth();

  // N'a de sens que pour un compte partagé/joint (au moins un autre participant).
  const isShared = !!account.is_joint || (!!(account as any).profile_id && (account as any).profile_id !== user?.id);
  const isReadOnly = (account as any)._role === 'read';

  const { data: mode, isLoading } = useMySharedMode(account.id, user?.id);
  const setMode = useSetSharedMode();

  if (!isShared || isReadOnly) return null;

  const current = mode ?? null; // null = non répondu (interprété « Suivi partagé »)
  const effective = effectiveSharedMode(mode);

  const choose = (m: SharedMode) => {
    if (m === current) return;
    setMode.mutate({ accountId: account.id, mode: m }, {
      onError: (e: any) => Alert.alert('Mode du compte', e?.message ?? 'Impossible de changer le mode.'),
    });
  };

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Comment utilisez-vous ce compte ?</Text>
      <Text style={styles.subtitle}>
        Cela n’affecte que la façon de compter dans VOTRE budget — jamais le solde du compte ni vos transactions.
      </Text>

      {OPTIONS.map((opt) => {
        const selected = current === null ? opt.mode === effective && false : current === opt.mode;
        const active = current === opt.mode;
        return (
          <TouchableOpacity
            key={opt.mode}
            style={[styles.card, active && { borderColor: COLORS.emerald, backgroundColor: COLORS.emerald + '12' }]}
            activeOpacity={0.85}
            onPress={() => choose(opt.mode)}
            disabled={setMode.isPending}
          >
            <View style={[styles.iconWrap, { backgroundColor: (active ? COLORS.emerald : COLORS.textSecondary) + '22' }]}>
              <Ionicons name={opt.icon as any} size={20} color={active ? COLORS.emerald : COLORS.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{opt.title}</Text>
              <Text style={styles.cardDesc}>{opt.desc}</Text>
            </View>
            <Ionicons
              name={active ? 'radio-button-on' : 'radio-button-off'}
              size={20}
              color={active ? COLORS.emerald : COLORS.textSecondary}
            />
          </TouchableOpacity>
        );
      })}

      {current === null && (
        <Text style={styles.hint}>
          Non défini pour l’instant → traité comme « Suivi partagé » (comportement actuel). Choisissez pour préciser.
        </Text>
      )}
      {(isLoading || setMode.isPending) && <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 8 }} />}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    section: { marginTop: 18 },
    title: { fontSize: 15, fontWeight: '800', color: c.text },
    subtitle: { fontSize: 12, color: c.textSecondary, marginTop: 3, marginBottom: 10, lineHeight: 17 },
    card: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 12, marginBottom: 8,
      backgroundColor: c.card,
    },
    iconWrap: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    cardTitle: { fontSize: 13.5, fontWeight: '700', color: c.text },
    cardDesc: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
    hint: { fontSize: 11.5, color: c.textSecondary, fontStyle: 'italic', marginTop: 2 },
  });
}
