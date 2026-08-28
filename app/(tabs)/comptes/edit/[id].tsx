/**
 * Route « Modifier le compte ». Le FORMULAIRE lui-même vit dans components/AccountSettingsForm :
 * il est partagé avec l'onglet « Paramètres » de la fiche du compte, d'où l'on modifie désormais un
 * compte sans changer d'écran. Cette route reste le chemin emprunté juste après la CRÉATION d'un
 * compte (`/comptes/add` y enchaîne pour proposer le partage).
 */
import { useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../../../contexts/AuthContext';
import { useAllAccounts } from '../../../../hooks/data/useAccounts';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import AccountSettingsForm from '../../../../components/account/AccountSettingsForm';
import PageLoader from '../../../../components/layout/PageLoader';
import { useNavBack } from '../../../../hooks/platform/useNavBack';

export default function EditAccountScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  /* RETOUR — pas `router.back()` : il dépile la pile NATIVE, où la fiche du compte peut figurer
     deux fois dès qu'on y est revenu par une navigation (cf. useNavBack dans la fiche). */
  const goBack = useNavBack();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const accountsQuery = useAllAccounts(user?.id);
  const scrollRef = useRef<ScrollView>(null);

  const account = (accountsQuery.data ?? []).find((a) => a.id === id);

  // Pas encore chargé ≠ introuvable (cf. la fiche du compte) : coquille tant que la requête est en
  // vol, message d'absence uniquement quand elle a réellement abouti.
  if (!user || !account) {
    if (!accountsQuery.isSuccess) return <PageLoader />;
    return (
      <View style={styles.root}>
        <ScreenGradient />
        <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'form')]}>
          <ScreenHeader title="Modifier le compte" onBack={goBack} />
          <Text style={styles.text}>Ce compte n’existe plus.</Text>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'form')]} edges={[]}>
        <ScreenHeader title="Modifier le compte" onBack={goBack} />

        <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <AccountSettingsForm
            account={account}
            onSaved={() => router.back()}
            onError={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
          />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 40 },
    text: { color: c.text },
  });
}
