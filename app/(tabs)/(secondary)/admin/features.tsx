import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile } from '../../../hooks/useProfile';
import { useAppColors } from '../../../hooks/useAppColors';
import { useNavBack } from '../../../hooks/useNavBack';
import { useFeatureFlags, useSaveFeatureFlags } from '../../../hooks/useFeatureFlags';
import { useSetPremium } from '../../../hooks/usePlan';


export default function AdminFeatures() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin ?? user?.email === 'maxcellens@gmail.com';
  const { data: flags, isLoading } = useFeatureFlags();
  const save = useSaveFeatureFlags();
  const setPremium = useSetPremium(user?.id);
  const myPremium = Boolean((profile as any)?.is_premium);

  if (!isAdmin) {
    return (
      <View style={styles.root}><StatusBar style="light" />
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}><Text style={styles.text}>Accès réservé aux administrateurs.</Text></SafeAreaView>
      </View>
    );
  }

  const closureOn = Boolean(flags?.monthly_closure_enabled);
  const premiumOn = Boolean(flags?.premium_enabled);
  const adsOn = Boolean(flags?.ads_enabled);
  const reportingOn = Boolean(flags?.reporting_enabled);

  const Toggle = ({ label, desc, value, onToggle }: { label: string; desc: string; value: boolean; onToggle: () => void }) => (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{label}</Text>
        <Text style={styles.cardDesc}>{desc}</Text>
      </View>
      <TouchableOpacity style={[styles.switch, value && styles.switchOn]} onPress={onToggle} activeOpacity={0.8} disabled={save.isPending}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Fonctionnalités</Text>
        <Text style={styles.subtitle}>Activez/désactivez des fonctionnalités expérimentales pour tous les utilisateurs.</Text>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          {isLoading ? (
            <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 32 }} />
          ) : (
            <>
            <Toggle
              label="Clôture mensuelle"
              desc="Bannière de clôture en fin de mois, verrou des transactions passées et bilan de fin de mois. Désactivé = aucun impact."
              value={closureOn}
              onToggle={() => save.mutate({ monthly_closure_enabled: !closureOn })}
            />
            <Toggle
              label="Offre Premium"
              desc="Active l'abonnement Premium (zéro pub, remise boutique, conseiller). Désactivé = tout le monde en gratuit, aucune UI premium."
              value={premiumOn}
              onToggle={() => save.mutate({ premium_enabled: !premiumOn })}
            />
            <Toggle
              label="Publicités"
              desc="Affiche les zones de publicité (bannières maison gérées en admin) aux utilisateurs non-premium. Désactivé = aucune pub."
              value={adsOn}
              onToggle={() => save.mutate({ ads_enabled: !adsOn })}
            />
            <Toggle
              label="Reporting"
              desc="Donne accès à la page Reporting (statistiques utilisateur) depuis le menu. Désactivé = page masquée pour les utilisateurs (les admins y accèdent toujours)."
              value={reportingOn}
              onToggle={() => save.mutate({ reporting_enabled: !reportingOn })}
            />
            <Toggle
              label="Mon compte : Premium (test)"
              desc="Active le droit Premium sur VOTRE compte pour tester (remise boutique, zéro pub). Sera normalement géré par le paiement."
              value={myPremium}
              onToggle={() => setPremium.mutate(!myPremium)}
            />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    backLabel: { fontSize: 16, color: c.text, marginLeft: 4 },
    title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 6 },
    subtitle: { fontSize: 13, color: c.textSecondary, marginBottom: 16 },
    card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 16, marginBottom: 12 },
    cardTitle: { fontSize: 15, fontWeight: '700', color: c.text },
    cardDesc: { fontSize: 12, color: c.textSecondary, marginTop: 3, lineHeight: 16 },
    switch: { width: 50, height: 30, borderRadius: 15, backgroundColor: c.cardBorder, padding: 3, justifyContent: 'center' },
    switchOn: { backgroundColor: c.emerald },
    knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
    knobOn: { alignSelf: 'flex-end' },
    text: { color: c.text, padding: 20 },
  });
}
