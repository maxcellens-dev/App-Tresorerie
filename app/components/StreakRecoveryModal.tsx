/**
 * StreakRecoveryModal — proposé à l'arrivée sur l'app quand l'utilisateur a PERDU sa série
 * (semaines manquées au-delà de ses gels). Permet de payer en gemmes pour la retrouver et la
 * compléter (prix = prix de récupération × nombre de semaines non couvertes).
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../hooks/useGamification';
import { formatCurrency } from '../lib/gamification';
import { useAppColors } from '../hooks/useAppColors';

export default function StreakRecoveryModal() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const { user } = useAuth();
  const { state, streakLoss, restoreLostStreak, config } = useGamification(user?.id);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gems = state?.gems ?? 0;
  const currency = config?.identity.currencyName ?? 'Relyk';
  const visible = !!streakLoss && !dismissed;
  if (!visible) return null;

  const { weeksMissed, newStreak, price } = streakLoss!;
  const enough = gems >= price;

  const onRestore = async () => {
    setBusy(true); setError(null);
    const res = await restoreLostStreak();
    setBusy(false);
    if (res.ok) setDismissed(true);
    else setError(res.reason === 'relyks insuffisants' ? `Il te manque ${formatCurrency(price - gems, currency)}.` : 'Restauration impossible.');
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setDismissed(true)}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconWrap}><Ionicons name="flame" size={32} color={COLORS.orange} /></View>
          <Text style={styles.title}>Ta série est en danger !</Text>
          <Text style={styles.text}>
            Tu as manqué <Text style={styles.bold}>{weeksMissed} semaine{weeksMissed > 1 ? 's' : ''}</Text>.
            Récupère ta série et reprends-la à <Text style={styles.bold}>{newStreak} semaine{newStreak > 1 ? 's' : ''}</Text>.
          </Text>

          <View style={styles.priceRow}>
            <Ionicons name="diamond" size={16} color={COLORS.blue} />
            <Text style={styles.priceText}>{formatCurrency(price, currency)}</Text>
            <Text style={styles.balance}>· solde : {gems}</Text>
          </View>
          {!!error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.restoreBtn, !enough && { opacity: 0.5 }]}
            onPress={onRestore}
            disabled={!enough || busy}
            activeOpacity={0.85}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.restoreText}>Récupérer ma série</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.skipBtn} onPress={() => setDismissed(true)} activeOpacity={0.7}>
            <Text style={styles.skipText}>Non merci</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 28 },
    card: { width: '100%', maxWidth: 380, backgroundColor: c.cardSolid ?? c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 20, padding: 24, alignItems: 'center' },
    iconWrap: { width: 60, height: 60, borderRadius: 30, backgroundColor: c.orange + '22', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
    title: { fontSize: 19, fontWeight: '800', color: c.text, marginBottom: 8, textAlign: 'center' },
    text: { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20 },
    bold: { fontWeight: '800', color: c.text },
    priceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 16 },
    priceText: { fontSize: 16, fontWeight: '800', color: c.text },
    balance: { fontSize: 12, color: c.textSecondary, marginLeft: 4 },
    error: { fontSize: 12, color: c.danger, marginTop: 10, textAlign: 'center' },
    restoreBtn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', width: '100%', marginTop: 18 },
    restoreText: { fontSize: 15, fontWeight: '800', color: '#fff' },
    skipBtn: { paddingVertical: 12, marginTop: 4 },
    skipText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
  });
}
