/**
 * Jauge + check-list de robustesse d'un mot de passe. Rendu piloté par lib/passwordPolicy
 * (source unique). Réutilisable : inscription, réinitialisation, changement dans les Paramètres.
 *
 * `colors` = palette de l'écran hôte (useBrandColors sur l'auth, useAppColors dans l'app).
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { evaluatePassword } from '../lib/passwordPolicy';

export default function PasswordStrength({ value, colors: c }: { value: string; colors: any }) {
  const evalr = useMemo(() => evaluatePassword(value), [value]);
  if (!value) return null;

  // 0/1 → danger, 2 → warning, 3 → success atténué, 4 → success.
  const barColor = evalr.score <= 1 ? c.danger : evalr.score === 2 ? c.warning : c.success;
  const filled = Math.max(1, evalr.score);

  return (
    <View style={styles.wrap}>
      <View style={styles.bars}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[styles.bar, { backgroundColor: i < filled ? barColor : c.cardBorder }]}
          />
        ))}
      </View>
      <Text style={[styles.strengthLabel, { color: barColor }]}>{evalr.label}</Text>

      <View style={styles.checks}>
        {evalr.checks.map((chk) => (
          <View key={chk.id} style={styles.checkRow}>
            <Ionicons
              name={chk.ok ? 'checkmark-circle' : 'ellipse-outline'}
              size={15}
              color={chk.ok ? c.success : c.textSecondary}
            />
            <Text style={[styles.checkTxt, { color: chk.ok ? c.text : c.textSecondary }]}>{chk.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: -8, marginBottom: 18 },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 5, borderRadius: 3 },
  strengthLabel: { fontSize: 12, fontWeight: '700', marginTop: 6 },
  checks: { marginTop: 8, gap: 4 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  checkTxt: { fontSize: 12.5, lineHeight: 17 },
});
