/**
 * StreakRecoveryModal — proposé à l'arrivée sur l'app quand l'utilisateur a PERDU sa série
 * (semaines manquées au-delà de ses gels). Permet de payer en gemmes pour la retrouver et la
 * compléter (prix = prix de récupération × nombre de semaines non couvertes).
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../hooks/useGamification';
import { formatCurrency } from '../lib/gamification';
import { useAppColors } from '../hooks/useAppColors';

export default function StreakRecoveryModal() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const { state, streakLoss, restoreLostStreak, config } = useGamification(user?.id);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRefuse, setConfirmRefuse] = useState(false);

  const gems = state?.gems ?? 0;
  const currency = config?.identity.currencyName ?? 'Relyk';
  const visible = !!streakLoss && !dismissed;
  if (!visible) return null;

  const { weeksMissed, freezesUsed, newStreak, price, previousStreak } = streakLoss!;
  const enough = gems >= price;

  const onRestore = async () => {
    setBusy(true); setError(null);
    const res = await restoreLostStreak();
    setBusy(false);
    if (res.ok) setDismissed(true);
    else setError(res.reason === 'relyks insuffisants' ? `Il te manque ${formatCurrency(price - gems, currency)}.` : 'Restauration impossible.');
  };

  return (
    // Modale BLOQUANTE : ni le retour ni un appui à l'extérieur ne ferment.
    // On doit choisir explicitement « Récupérer » ou « Refuser ».
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconWrap}><Ionicons name="flame" size={32} color={COLORS.orange} /></View>
          <Text style={styles.title}>Ta série est en danger !</Text>
          <Text style={styles.text}>
            Tu reviens après <Text style={styles.bold}>{weeksMissed + freezesUsed} semaine{(weeksMissed + freezesUsed) > 1 ? 's' : ''}</Text> d'absence.
            {freezesUsed > 0 ? <Text> <Text style={styles.bold}>{freezesUsed} gel{freezesUsed > 1 ? 's' : ''}</Text> ont été utilisés automatiquement.</Text> : null}
            {' '}Il reste <Text style={styles.bold}>{weeksMissed} semaine{weeksMissed > 1 ? 's' : ''}</Text> à couvrir pour conserver ta série de <Text style={styles.bold}>{previousStreak}</Text> et la reprendre à <Text style={styles.bold}>{newStreak}</Text>.
          </Text>

          <View style={styles.priceRow}>
            <Ionicons name="diamond" size={16} color={COLORS.blue} />
            <Text style={styles.priceText}>{formatCurrency(price, currency)}</Text>
            <Text style={styles.balance}>· solde : {gems}</Text>
          </View>
          {!!error && <Text style={styles.error}>{error}</Text>}

          {enough ? (
            <TouchableOpacity style={styles.restoreBtn} onPress={onRestore} disabled={busy} activeOpacity={0.85}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.restoreText}>Conserver ma série</Text>}
            </TouchableOpacity>
          ) : (
            // Pas assez de relyks → proposer d'en acheter, sinon refuser.
            <TouchableOpacity style={styles.restoreBtn} onPress={() => router.push('/(tabs)/(secondary)/boutique?focus=gems' as any)} activeOpacity={0.85}>
              <Ionicons name="diamond" size={15} color="#fff" />
              <Text style={styles.restoreText}>  Acheter des relyks</Text>
            </TouchableOpacity>
          )}

          {!enough && <Text style={styles.balance}>Il te manque {formatCurrency(price - gems, currency)} pour conserver ta série.</Text>}

          {confirmRefuse ? (
            <View style={styles.refuseConfirm}>
              <Text style={styles.refuseText}>Perdre définitivement ta série de {previousStreak} semaine{previousStreak > 1 ? 's' : ''} ?</Text>
              <View style={styles.refuseBtns}>
                <TouchableOpacity style={styles.refuseCancel} onPress={() => setConfirmRefuse(false)} activeOpacity={0.8}>
                  <Text style={styles.refuseCancelText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.refuseConfirmBtn} onPress={() => setDismissed(true)} activeOpacity={0.8}>
                  <Text style={styles.refuseConfirmText}>Oui, perdre</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.skipBtn} onPress={() => setConfirmRefuse(true)} activeOpacity={0.7}>
              <Text style={styles.skipText}>Refuser et perdre ma série</Text>
            </TouchableOpacity>
          )}
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
    restoreBtn: { flexDirection: 'row', backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', width: '100%', marginTop: 18 },
    restoreText: { fontSize: 15, fontWeight: '800', color: '#fff' },
    skipBtn: { paddingVertical: 12, marginTop: 8 },
    skipText: { fontSize: 13, fontWeight: '600', color: c.textSecondary, textDecorationLine: 'underline' },
    refuseConfirm: { width: '100%', marginTop: 12, gap: 8, alignItems: 'center' },
    refuseText: { fontSize: 13, color: c.text, fontWeight: '600', textAlign: 'center' },
    refuseBtns: { flexDirection: 'row', gap: 10, width: '100%' },
    refuseCancel: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder },
    refuseCancelText: { fontSize: 13, fontWeight: '700', color: c.text },
    refuseConfirmBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 10, backgroundColor: c.danger },
    refuseConfirmText: { fontSize: 13, fontWeight: '800', color: '#fff' },
  });
}
