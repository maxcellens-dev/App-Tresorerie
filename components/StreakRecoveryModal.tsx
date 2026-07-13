/**
 * StreakRecoveryModal — proposé à l'arrivée sur l'app quand l'utilisateur n'est pas venu pendant
 * une ou plusieurs semaines ENTIÈRES (au-delà de ses gels). Il peut racheter les semaines manquées
 * en relyks (prix = prix unitaire × semaines non couvertes) ou refuser.
 *
 * Le choix est APPLIQUÉ en base dans les deux cas : refuser remet la série à zéro (elle repartira
 * à 1 avec la semaine en cours). Sans ça, la modale reviendrait à chaque ouverture.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../hooks/useGamification';
import { formatCurrency } from '../lib/gamification';
import { useAppColors } from '../hooks/useAppColors';

export default function StreakRecoveryModal() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const { user, isImpersonating } = useAuth();
  const { state, streakLoss, restoreLostStreak, declineLostStreak, config } = useGamification(user?.id);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRefuse, setConfirmRefuse] = useState(false);

  const gems = state?.gems ?? 0;
  const currency = config?.identity.currencyName ?? 'Relyk';

  // Parti acheter des relyks : dès qu'il en a assez (retour de la boutique), on rouvre la
  // proposition — sinon il faudrait relancer l'app pour pouvoir enfin racheter sa série.
  const [shopping, setShopping] = useState(false);
  const price = streakLoss?.price ?? 0;
  useEffect(() => {
    if (shopping && streakLoss && gems >= price) { setDismissed(false); setShopping(false); }
  }, [shopping, gems, price, streakLoss]);

  // En consultation admin : pas de proposition de récupération de série sur le compte cible.
  const visible = !isImpersonating && !!streakLoss && !dismissed;
  if (!visible) return null;

  const { weeksMissed, missed, freezesUsed, newStreak, previousStreak } = streakLoss!;
  const enough = gems >= price;
  const s = (n: number) => (n > 1 ? 's' : '');

  const onRestore = async () => {
    setBusy(true); setError(null);
    const res = await restoreLostStreak();
    setBusy(false);
    if (res.ok) setDismissed(true);
    else setError(res.reason === 'relyks insuffisants' ? `Il te manque ${formatCurrency(price - gems, currency)}.` : 'Rachat impossible.');
  };

  // Refuser = perdre la série POUR DE BON : on l'applique en base tout de suite.
  const onDecline = async () => {
    setBusy(true);
    await declineLostStreak();
    setBusy(false);
    setDismissed(true);
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
            Tu n'as pas ouvert l'app pendant <Text style={styles.bold}>{missed} semaine{s(missed)} entière{s(missed)}</Text>.
            {freezesUsed > 0 ? <Text> <Text style={styles.bold}>{freezesUsed} gel{s(freezesUsed)}</Text> {freezesUsed > 1 ? 'seront utilisés' : 'sera utilisé'} automatiquement.</Text> : null}
            {' '}Rachète <Text style={styles.bold}>{weeksMissed} semaine{s(weeksMissed)}</Text> pour garder ta série de <Text style={styles.bold}>{previousStreak}</Text> : avec la semaine en cours, elle passera à <Text style={styles.bold}>{newStreak}</Text>.
          </Text>
          <Text style={styles.warn}>Si tu refuses, ta série repart de zéro (à 1 cette semaine).</Text>

          <View style={styles.priceRow}>
            <Ionicons name="diamond" size={16} color={COLORS.blue} />
            <Text style={styles.priceText}>{formatCurrency(price, currency)}</Text>
            <Text style={styles.balance}>· solde : {gems}</Text>
          </View>
          {!!error && <Text style={styles.error}>{error}</Text>}

          {enough ? (
            <TouchableOpacity style={styles.restoreBtn} onPress={onRestore} disabled={busy} activeOpacity={0.85}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.restoreText}>Racheter et garder ma série</Text>}
            </TouchableOpacity>
          ) : (
            // Pas assez de relyks → proposer d'en acheter. On REFERME la modale en partant : elle est
            // rendue au-dessus de toute l'app (Modal natif) et masquerait la boutique. La série reste
            // « en danger » côté base (aucune décision prise) → la proposition revient à la prochaine
            // ouverture, avec les relyks fraîchement achetés.
            <TouchableOpacity style={styles.restoreBtn} onPress={() => { setShopping(true); setDismissed(true); router.push('/(tabs)/(secondary)/boutique?focus=gems' as any); }} activeOpacity={0.85}>
              <Ionicons name="diamond" size={15} color="#fff" />
              <Text style={styles.restoreText}>  Acheter des relyks</Text>
            </TouchableOpacity>
          )}

          {!enough && <Text style={styles.balance}>Il te manque {formatCurrency(price - gems, currency)} pour racheter ta série.</Text>}

          {confirmRefuse ? (
            <View style={styles.refuseConfirm}>
              <Text style={styles.refuseText}>
                Perdre définitivement ta série de {previousStreak} semaine{s(previousStreak)} ? Elle repartira à 1 cette semaine (ton record reste conservé).
              </Text>
              <View style={styles.refuseBtns}>
                <TouchableOpacity style={styles.refuseCancel} onPress={() => setConfirmRefuse(false)} activeOpacity={0.8} disabled={busy}>
                  <Text style={styles.refuseCancelText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.refuseConfirmBtn} onPress={onDecline} activeOpacity={0.8} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.refuseConfirmText}>Oui, perdre</Text>}
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
    warn: { fontSize: 12, color: c.textSecondary, textAlign: 'center', marginTop: 8, fontStyle: 'italic' },
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
