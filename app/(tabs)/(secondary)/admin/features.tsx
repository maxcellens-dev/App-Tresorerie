import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile } from '../../../../hooks/data/useProfile';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import { useNavBack } from '../../../../hooks/platform/useNavBack';
import { useFeatureFlags, useSaveFeatureFlags } from '../../../../hooks/config/useFeatureFlags';
import { useSetPremium } from '../../../../hooks/config/usePlan';


export default function AdminFeatures() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin === true;
  const { data: flags, isLoading } = useFeatureFlags();
  const save = useSaveFeatureFlags();
  const setPremium = useSetPremium(user?.id);
  const myPremium = Boolean((profile as any)?.is_premium);

  if (!isAdmin) {
    return (
      <View style={styles.root}><StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}><ScreenHeader title="Fonctionnalités" onBack={goBack} /><Text style={styles.text}>Accès réservé aux administrateurs.</Text></SafeAreaView>
      </View>
    );
  }

  /* Cette page ne garde QUE les interrupteurs sur lesquels une décision reste ouverte. Publicités,
     Reporting, messages des recos et bouton de saisie rapide en sont sortis : ces fonctionnalités
     sont en place et le resteront — les laisser ici, c'était entretenir des chemins de code morts
     et des valeurs par défaut qui finissaient par diverger d'un écran à l'autre. */
  const closureOn = Boolean(flags?.monthly_closure_enabled);
  const premiumOn = Boolean(flags?.premium_enabled);
  const persoSharingOn = Boolean(flags?.perso_account_sharing_enabled);

  type FeatTab = 'general' | 'ai';
  const [tab, setTab] = useState<FeatTab>('general');

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
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Fonctionnalités" onBack={goBack} />
        <Text style={styles.subtitle}>Activez/désactivez des fonctionnalités expérimentales pour tous les utilisateurs.</Text>

        <View style={styles.tabs}>
          {([['general', 'Général'], ['ai', 'Conseils IA']] as [typeof tab, string][]).map(([t, lbl]) => (
            <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}>
              <Text style={[styles.tabTxt, tab === t && styles.tabTxtOn]}>{lbl}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          {isLoading ? (
            <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 32 }} />
          ) : tab === 'ai' ? (
            <>
              <View style={styles.card}>
                <Ionicons name="information-circle-outline" size={20} color={COLORS.emerald} />
                <Text style={[styles.cardDesc, { flex: 1, marginTop: 0 }]}>
                  Le bouton « Conseils IA » est toujours visible dans le menu. C'est l'ACCÈS qui change : réservé aux abonnés Premium par défaut, ou ouvert à tous via « Ouvrir à tous » dans la configuration avancée.
                </Text>
              </View>
              <TouchableOpacity style={styles.linkCard} onPress={() => router.push('/(tabs)/(secondary)/admin/ai' as any)}>
                <Ionicons name="sparkles-outline" size={20} color={COLORS.emerald} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Configuration avancée</Text>
                  <Text style={styles.cardDesc}>Ouverture à tous, modèles, prompts, quotas, consentement, tickets.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </>
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
              label="Partage de comptes perso"
              desc="Permet d'inviter un autre utilisateur en consultation ou écriture sur un compte perso. N'affecte pas les comptes joints dédiés. Désactivé = le bouton « Partager » est masqué et aucun nouveau partage perso n'est possible ; les partages déjà créés continuent de fonctionner."
              value={persoSharingOn}
              onToggle={() => save.mutate({ perso_account_sharing_enabled: !persoSharingOn })}
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
    subtitle: { fontSize: 13, color: c.textSecondary, marginBottom: 16 },
    tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
    tab: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
    tabOn: { backgroundColor: c.emerald + '18', borderColor: c.emerald },
    tabTxt: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    tabTxtOn: { color: c.emerald, fontWeight: '700' },
    linkCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 16, marginBottom: 12 },
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
