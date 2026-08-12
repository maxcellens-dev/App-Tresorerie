import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, Platform } from 'react-native';
import KeyboardAwareScrollView from '../../../../components/layout/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile } from '../../../../hooks/data/useProfile';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import { useNavBack } from '../../../../hooks/platform/useNavBack';
import { useFeatureFlags, useSaveFeatureFlags } from '../../../../hooks/config/useFeatureFlags';


export default function AdminAppUpdate() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const goBack = useNavBack();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin === true;
  const { data: flags, isLoading } = useFeatureFlags();
  const save = useSaveFeatureFlags();

  // ── Mise à jour de l'app (bandeau « mise à jour disponible ») ──
  const installedVersion = Constants.expoConfig?.version ?? '—';
  const [latestVersion, setLatestVersion] = useState('');
  const [minVersion, setMinVersion] = useState('');
  const [urlAndroid, setUrlAndroid] = useState('');
  const [urlIos, setUrlIos] = useState('');
  const [updateSaved, setUpdateSaved] = useState(false);

  // ── Section « À propos » de la page Support (liens « Noter » et Instagram) ──
  const [rateAndroid, setRateAndroid] = useState('');
  const [rateIos, setRateIos] = useState('');
  const [instagram, setInstagram] = useState('');
  const [aboutSaved, setAboutSaved] = useState(false);

  useEffect(() => {
    if (!flags) return;
    setLatestVersion(flags.latest_version ?? '');
    setMinVersion(flags.min_version ?? '');
    setUrlAndroid(flags.update_url_android ?? '');
    setUrlIos(flags.update_url_ios ?? '');
    setRateAndroid(flags.about_rate_url_android ?? '');
    setRateIos(flags.about_rate_url_ios ?? '');
    setInstagram(flags.about_instagram_url ?? '');
  }, [flags]);

  const saveUpdateConfig = () => {
    // Vide → undefined : le champ est retiré de la config (JSON), donc le bandeau cesse de s'afficher.
    save.mutate({
      latest_version: latestVersion.trim() || undefined,
      min_version: minVersion.trim() || undefined,
      update_url_android: urlAndroid.trim() || undefined,
      update_url_ios: urlIos.trim() || undefined,
    }, { onSuccess: () => { setUpdateSaved(true); setTimeout(() => setUpdateSaved(false), 1500); } });
  };

  const saveAboutConfig = () => {
    // Vide → undefined : le lien disparaît de la page Support (« Noter » retombe sur la fiche Play).
    save.mutate({
      about_rate_url_android: rateAndroid.trim() || undefined,
      about_rate_url_ios: rateIos.trim() || undefined,
      about_instagram_url: instagram.trim() || undefined,
    }, { onSuccess: () => { setAboutSaved(true); setTimeout(() => setAboutSaved(false), 1500); } });
  };

  if (!isAdmin) {
    return (
      <View style={styles.root}><StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}><ScreenHeader title="Mise à jour de l'App" onBack={goBack} /><Text style={styles.text}>Accès réservé aux administrateurs.</Text></SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Mise à jour de l'App" onBack={goBack} />
        <Text style={styles.subtitle}>Le bandeau « mise à jour disponible » et les liens store de l'app.</Text>

        <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          {isLoading ? (
            <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 32 }} />
          ) : (
            <View style={styles.updateCard}>
              <Text style={styles.cardTitle}>Mise à jour de l'app</Text>
              <Text style={styles.cardDesc}>
                Affiche un bandeau « mise à jour disponible » (natif) quand la version publiée est supérieure à celle installée.
                Version installée sur cet appareil : <Text style={{ fontWeight: '800', color: COLORS.text }}>{installedVersion}</Text>.
              </Text>

              <Text style={styles.inputLabel}>Dernière version publiée (bandeau fermable)</Text>
              <TextInput style={styles.input} value={latestVersion} onChangeText={setLatestVersion} placeholder="ex. 1.0.2" placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" />

              <Text style={styles.inputLabel}>Version minimale requise (bandeau OBLIGATOIRE)</Text>
              <TextInput style={styles.input} value={minVersion} onChangeText={setMinVersion} placeholder="ex. 1.0.1 (laisser vide si non requis)" placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" />

              <Text style={styles.inputLabel}>Lien store Android (optionnel)</Text>
              <TextInput style={styles.input} value={urlAndroid} onChangeText={setUrlAndroid} placeholder="https://play.google.com/store/apps/details?id=…" placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" autoCorrect={false} />

              <Text style={styles.inputLabel}>Lien store iOS (optionnel)</Text>
              <TextInput style={styles.input} value={urlIos} onChangeText={setUrlIos} placeholder="https://apps.apple.com/app/…" placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" autoCorrect={false} />

              <TouchableOpacity style={[styles.saveBtn, save.isPending && { opacity: 0.6 }]} onPress={saveUpdateConfig} disabled={save.isPending} activeOpacity={0.85}>
                {save.isPending
                  ? <ActivityIndicator color={COLORS.bg} size="small" />
                  : <Text style={styles.saveBtnText}>{updateSaved ? 'Enregistré ✓' : 'Enregistrer la version'}</Text>}
              </TouchableOpacity>
              <Text style={styles.updateHint}>
                Astuce : à chaque publication sur le store, mettez « Dernière version publiée » au numéro de la nouvelle version. Les utilisateurs encore sur l'ancienne verront le bandeau à leur prochaine ouverture.
              </Text>
            </View>
          )}

          {!isLoading && (
            <View style={styles.updateCard}>
              <Text style={styles.cardTitle}>À propos (page Support)</Text>
              <Text style={styles.cardDesc}>
                Les deux boutons de la section « À propos » : noter l'app sur le store, et suivre le compte Instagram.
                Un champ laissé vide masque le bouton correspondant (sauf « Noter » sur Android, qui retombe sur la fiche Play).
              </Text>

              <Text style={styles.inputLabel}>Lien « Noter » Android</Text>
              <TextInput style={styles.input} value={rateAndroid} onChangeText={setRateAndroid} placeholder="https://play.google.com/store/apps/details?id=…" placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" autoCorrect={false} />

              <Text style={styles.inputLabel}>Lien « Noter » iOS</Text>
              <TextInput style={styles.input} value={rateIos} onChangeText={setRateIos} placeholder="https://apps.apple.com/app/id…?action=write-review" placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" autoCorrect={false} />

              <Text style={styles.inputLabel}>Lien Instagram</Text>
              <TextInput style={styles.input} value={instagram} onChangeText={setInstagram} placeholder="https://www.instagram.com/…" placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" autoCorrect={false} />

              <TouchableOpacity style={[styles.saveBtn, save.isPending && { opacity: 0.6 }]} onPress={saveAboutConfig} disabled={save.isPending} activeOpacity={0.85}>
                {save.isPending
                  ? <ActivityIndicator color={COLORS.bg} size="small" />
                  : <Text style={styles.saveBtnText}>{aboutSaved ? 'Enregistré ✓' : 'Enregistrer les liens'}</Text>}
              </TouchableOpacity>
              <Text style={styles.updateHint}>
                Le lien « Noter » iOS gagne à pointer directement vers le formulaire d'avis : ajoutez « ?action=write-review » à la fin de l'adresse de la fiche.
              </Text>
            </View>
          )}
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    subtitle: { fontSize: 13, color: c.textSecondary, marginBottom: 16 },
    cardTitle: { fontSize: 15, fontWeight: '700', color: c.text },
    cardDesc: { fontSize: 12, color: c.textSecondary, marginTop: 3, lineHeight: 16 },
    text: { color: c.text, padding: 20 },
    updateCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 16, marginBottom: 12 },
    inputLabel: { fontSize: 12, fontWeight: '600', color: c.textSecondary, marginTop: 12, marginBottom: 5 },
    input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 13, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    saveBtn: { backgroundColor: c.emerald, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 16 },
    saveBtnText: { color: c.bg, fontWeight: '800', fontSize: 14 },
    updateHint: { fontSize: 11, color: c.textSecondary, marginTop: 10, lineHeight: 15, fontStyle: 'italic' },
  });
}
