import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile } from '../../../../hooks/useProfile';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useNavBack } from '../../../../hooks/useNavBack';
import { useFeatureFlags, useSaveFeatureFlags } from '../../../../hooks/useFeatureFlags';
import { useSetPremium } from '../../../../hooks/usePlan';


export default function AdminFeatures() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
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
      <View style={styles.root}><StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}><Text style={styles.text}>Accès réservé aux administrateurs.</Text></SafeAreaView>
      </View>
    );
  }

  const closureOn = Boolean(flags?.monthly_closure_enabled);
  const premiumOn = Boolean(flags?.premium_enabled);
  const adsOn = Boolean(flags?.ads_enabled);
  const reportingOn = Boolean(flags?.reporting_enabled);
  const recoContextOn = flags?.reco_context_enabled !== false; // défaut activé
  const persoSharingOn = Boolean(flags?.perso_account_sharing_enabled);
  const quickAddOn = flags?.quick_add_enabled !== false; // défaut activé
  const quickAddMode = (flags?.quick_add_mode ?? 'tabbar') as 'tabbar' | 'bubble';

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
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Fonctionnalités</Text>
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
              label="Messages des recommandations"
              desc="Phrase motivante sous chaque reco (projection investissement à 10/20 ans, économie possible…). Désactivé = recos sans ce message."
              value={recoContextOn}
              onToggle={() => save.mutate({ reco_context_enabled: !recoContextOn })}
            />
            <Toggle
              label="Partage de comptes perso"
              desc="Permet d'inviter un autre utilisateur en consultation ou écriture sur un compte perso. N'affecte pas les comptes joints dédiés. Désactivé = le bouton « Partager » est masqué et aucun nouveau partage perso n'est possible ; les partages déjà créés continuent de fonctionner."
              value={persoSharingOn}
              onToggle={() => save.mutate({ perso_account_sharing_enabled: !persoSharingOn })}
            />
            <Toggle
              label="Bouton de saisie rapide"
              desc="Affiche le bouton « + » de saisie rapide (virement / dépense / recette). Désactivé = aucun bouton."
              value={quickAddOn}
              onToggle={() => save.mutate({ quick_add_enabled: !quickAddOn })}
            />
            {quickAddOn && (
              <View style={[styles.card, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
                <Text style={styles.cardTitle}>Mode d'affichage du bouton « + »</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {([['tabbar', 'Barre d\'onglets'], ['bubble', 'Bulle (Pilotage)']] as const).map(([val, lbl]) => (
                    <TouchableOpacity
                      key={val}
                      style={[{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: COLORS.cardBorder, alignItems: 'center' }, quickAddMode === val && { backgroundColor: COLORS.emerald + '18', borderColor: COLORS.emerald }]}
                      onPress={() => save.mutate({ quick_add_mode: val })}
                      disabled={save.isPending}
                    >
                      <Text style={{ fontSize: 13, fontWeight: quickAddMode === val ? '700' : '600', color: quickAddMode === val ? COLORS.emerald : COLORS.textSecondary }}>{lbl}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.cardDesc}>
                  Barre d'onglets : gros bouton surélevé entre les onglets (l'utilisateur choisit gauche/droite/masqué). Bulle : bouton volant en bas à droite, uniquement sur l'écran Pilotage (l'utilisateur peut juste l'afficher/masquer).
                </Text>
              </View>
            )}
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
