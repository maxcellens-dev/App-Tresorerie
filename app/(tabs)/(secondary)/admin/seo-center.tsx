/**
 * Admin — SEO Center.
 * Édite la configuration complète du référencement (app_config.seo), organisée en sections :
 * Général, Indexation (robots), Open Graph, Twitter/X, Réseaux sociaux, Vérification, Organisation
 * (JSON-LD) et surcharges par page. Aperçu « résultat Google » en direct.
 * Appliquée au <head> côté web par le composant SeoHead.
 */
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Switch, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import { useNavBack } from '../../../../hooks/platform/useNavBack';
import { useSeoConfig, useSaveSeoConfig } from '../../../../hooks/config/useSeo';
import { SEO_DEFAULTS, resolveSeoConfig, seoTitleFor, seoDescriptionFor, type SeoConfig } from '../../../../lib/platform/seo';

type TextField = { kind: 'text'; path: string; label: string; placeholder?: string; multiline?: boolean; help?: string };
type SwitchField = { kind: 'switch'; path: string; label: string; help?: string };
type Field = TextField | SwitchField;
type Section = { key: string; title: string; icon: string; fields: Field[] };

const SECTIONS: Section[] = [
  { key: 'general', title: 'Général', icon: 'globe-outline', fields: [
    { kind: 'text', path: 'siteName', label: 'Nom du site', help: 'La ligne affichée AU-DESSUS de l’URL dans Google (à la place de « relyka.app »). Google la lit dans les données structurées WebSite de la page d’accueil — servies en dur dans public/index.html et réappliquées ici au runtime. Compter plusieurs jours à plusieurs semaines avant que Google la reprenne.' },
    { kind: 'text', path: 'titleDefault', label: 'Titre par défaut' },
    { kind: 'text', path: 'titleTemplate', label: 'Gabarit de titre', placeholder: '%s · Relyka' },
    { kind: 'text', path: 'description', label: 'Description', multiline: true },
    { kind: 'text', path: 'keywords', label: 'Mots-clés (séparés par des virgules)', multiline: true },
    { kind: 'text', path: 'canonicalBase', label: 'URL de base (canonical)', placeholder: 'https://relyka.app' },
    { kind: 'text', path: 'language', label: 'Langue', placeholder: 'fr' },
    { kind: 'text', path: 'author', label: 'Auteur' },
    { kind: 'text', path: 'themeColor', label: 'Couleur du thème', placeholder: '#0D2E2A' },
  ] },
  { key: 'robots', title: 'Indexation (robots)', icon: 'search-outline', fields: [
    { kind: 'switch', path: 'index', label: 'Indexer le site', help: 'Décoché → noindex (le site n\'apparaît pas dans Google).' },
    { kind: 'switch', path: 'follow', label: 'Suivre les liens', help: 'Décoché → nofollow.' },
  ] },
  { key: 'og', title: 'Open Graph (partage)', icon: 'share-social-outline', fields: [
    { kind: 'text', path: 'ogType', label: 'Type', placeholder: 'website' },
    { kind: 'text', path: 'ogImage', label: 'Image de partage (URL absolue)' },
    { kind: 'text', path: 'ogImageAlt', label: 'Texte alternatif de l\'image' },
  ] },
  { key: 'twitter', title: 'Twitter / X', icon: 'logo-twitter', fields: [
    { kind: 'text', path: 'twitterCard', label: 'Type de carte', placeholder: 'summary_large_image' },
    { kind: 'text', path: 'twitterSite', label: 'Compte du site', placeholder: '@relyka' },
    { kind: 'text', path: 'twitterCreator', label: 'Compte de l\'auteur' },
  ] },
  { key: 'social', title: 'Réseaux sociaux', icon: 'people-outline', fields: [
    { kind: 'text', path: 'social.twitter', label: 'Twitter / X (URL)' },
    { kind: 'text', path: 'social.facebook', label: 'Facebook (URL)' },
    { kind: 'text', path: 'social.instagram', label: 'Instagram (URL)' },
    { kind: 'text', path: 'social.linkedin', label: 'LinkedIn (URL)' },
    { kind: 'text', path: 'social.youtube', label: 'YouTube (URL)' },
  ] },
  { key: 'verify', title: 'Vérification de propriété', icon: 'shield-checkmark-outline', fields: [
    { kind: 'text', path: 'verifyGoogle', label: 'Google Search Console (code)' },
    { kind: 'text', path: 'verifyBing', label: 'Bing Webmaster (code)' },
  ] },
  { key: 'org', title: 'Organisation (JSON-LD)', icon: 'business-outline', fields: [
    { kind: 'text', path: 'orgName', label: 'Nom de l\'organisation' },
    { kind: 'text', path: 'orgLogo', label: 'Logo (URL absolue)' },
  ] },
  { key: 'pages', title: 'Surcharges par page', icon: 'documents-outline', fields: [
    { kind: 'text', path: 'pages.landing.title', label: 'Accueil — titre' },
    { kind: 'text', path: 'pages.landing.description', label: 'Accueil — description', multiline: true },
    { kind: 'text', path: 'pages.app.title', label: 'App — titre' },
    { kind: 'text', path: 'pages.app.description', label: 'App — description', multiline: true },
  ] },
];

function getPath(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj: any, path: string, value: any): any {
  const keys = path.split('.');
  const next = { ...obj };
  let cur = next;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = { ...(cur[keys[i]] ?? {}) };
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
  return next;
}

export default function AdminSeoCenter() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const goBack = useNavBack();
  const { data: cfg } = useSeoConfig();
  const save = useSaveSeoConfig();

  const [draft, setDraft] = useState<SeoConfig>(SEO_DEFAULTS);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ general: true });

  useEffect(() => { if (cfg && !dirty) setDraft(cfg); }, [cfg, dirty]);

  const setText = (path: string, v: string) => { setDirty(true); setDraft((d) => setPath(d, path, v)); };
  const setBool = (path: string, v: boolean) => { setDirty(true); setDraft((d) => setPath(d, path, v)); };

  const saveAll = () => {
    // Nettoie les surcharges de page vides (ne pas stocker { title:'', description:'' }).
    const clean = resolveSeoConfig(draft);
    const pages: SeoConfig['pages'] = {};
    Object.entries(draft.pages ?? {}).forEach(([k, v]) => {
      const t = (v?.title ?? '').trim(); const de = (v?.description ?? '').trim();
      if (t || de) pages[k] = { ...(t ? { title: t } : {}), ...(de ? { description: de } : {}) };
    });
    save.mutate({ ...clean, pages }, { onSuccess: () => { setDirty(false); setSavedAt(Date.now()); } });
  };

  const previewTitle = seoTitleFor(draft);
  const previewDesc = seoDescriptionFor(draft);
  const previewUrl = (draft.canonicalBase || 'https://relyka.app').replace(/\/$/, '');

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="SEO Center" onBack={goBack} />
        <ScrollView contentContainerStyle={{ paddingBottom: 80 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.p}>Configuration du référencement, appliquée au site web. Sur mobile, ces réglages n'ont aucun effet.</Text>

          {/* Aperçu résultat Google */}
          <View style={styles.previewCard}>
            <Text style={styles.previewTag}>Aperçu Google</Text>
            <Text style={styles.previewUrl} numberOfLines={1}>{previewUrl}</Text>
            <Text style={styles.previewTitle} numberOfLines={2}>{previewTitle}</Text>
            <Text style={styles.previewDesc} numberOfLines={3}>{previewDesc}</Text>
          </View>

          {SECTIONS.map((sec) => {
            const isOpen = open[sec.key] ?? false;
            return (
              <View key={sec.key} style={styles.section}>
                <TouchableOpacity style={styles.sectionHead} onPress={() => setOpen((o) => ({ ...o, [sec.key]: !isOpen }))} activeOpacity={0.7}>
                  <Ionicons name={sec.icon as any} size={17} color={COLORS.emerald} />
                  <Text style={styles.sectionTitle}>{sec.title}</Text>
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={17} color={COLORS.textSecondary} />
                </TouchableOpacity>
                {isOpen && (
                  <View style={styles.sectionBody}>
                    {sec.fields.map((f) => f.kind === 'switch' ? (
                      <View key={f.path} style={styles.switchRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.label}>{f.label}</Text>
                          {!!f.help && <Text style={styles.help}>{f.help}</Text>}
                        </View>
                        <Switch
                          value={!!getPath(draft, f.path)}
                          onValueChange={(v) => setBool(f.path, v)}
                          trackColor={{ true: COLORS.emerald, false: COLORS.cardBorder }}
                          thumbColor="#fff"
                        />
                      </View>
                    ) : (
                      <View key={f.path} style={styles.fieldGroup}>
                        <Text style={styles.label}>{f.label}</Text>
                        {!!f.help && <Text style={styles.help}>{f.help}</Text>}
                        <TextInput
                          style={[styles.input, f.multiline && styles.inputMultiline]}
                          value={String(getPath(draft, f.path) ?? '')}
                          onChangeText={(v) => setText(f.path, v)}
                          placeholder={f.placeholder}
                          placeholderTextColor={COLORS.textSecondary}
                          multiline={f.multiline}
                          autoCapitalize="none"
                        />
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}

          <TouchableOpacity
            style={[styles.saveBtn, (!dirty || save.isPending) && styles.saveBtnDisabled]}
            onPress={saveAll}
            disabled={!dirty || save.isPending}
          >
            {save.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="checkmark" size={18} color="#fff" />}
            <Text style={styles.saveBtnTxt}>{save.isPending ? 'Enregistrement…' : 'Enregistrer'}</Text>
          </TouchableOpacity>
          {!dirty && savedAt != null && !save.isPending && <Text style={styles.savedTxt}>Modifications enregistrées ✓</Text>}
          {save.isError && <Text style={styles.errorTxt}>Échec de l'enregistrement — réessaie.</Text>}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    p: { fontSize: 13, color: c.textSecondary, marginTop: 6, lineHeight: 19, marginBottom: 12 },
    previewCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 14, marginBottom: 16 },
    previewTag: { fontSize: 10.5, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
    previewUrl: { fontSize: 12, color: c.textSecondary },
    previewTitle: { fontSize: 17, fontWeight: '600', color: c.mode === 'light' ? '#1a0dab' : '#8ab4f8', marginTop: 2 },
    previewDesc: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18, marginTop: 3 },
    section: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, marginBottom: 10, overflow: 'hidden', backgroundColor: c.card },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
    sectionTitle: { flex: 1, fontSize: 14.5, fontWeight: '800', color: c.text },
    sectionBody: { paddingHorizontal: 14, paddingBottom: 12, gap: 10 },
    fieldGroup: { gap: 6 },
    label: { fontSize: 13, fontWeight: '600', color: c.text },
    help: { fontSize: 11.5, color: c.textSecondary, marginTop: 2 },
    input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: c.text, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    inputMultiline: { minHeight: 64, textAlignVertical: 'top' },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
    saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 13, marginTop: 14 },
    saveBtnDisabled: { opacity: 0.5 },
    saveBtnTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },
    savedTxt: { fontSize: 12.5, color: c.emerald, fontWeight: '600', textAlign: 'center', marginTop: 8 },
    errorTxt: { fontSize: 12.5, color: c.red, fontWeight: '600', textAlign: 'center', marginTop: 8 },
  });
}
