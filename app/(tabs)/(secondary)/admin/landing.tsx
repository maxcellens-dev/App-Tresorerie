/**
 * Admin — Page d'accueil (landing desktop). Édite app_config.landing : textes, images,
 * menu, fonctionnalités, statistiques, CTA et pied de page. Téléversement d'images vers
 * le bucket public « gamification » (préfixe landing/).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Switch, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../../components/ScreenGradient';
import { useAppColors } from '../../../hooks/useAppColors';
import { useNavBack } from '../../../hooks/useNavBack';
import { supabase } from '../../../lib/supabase';
import { useLandingConfig, useSaveLandingConfig, type LandingConfig, type LandingFeature, type LandingStat, type LandingLink } from '../../../hooks/useLandingConfig';

export default function AdminLanding() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const goBack = useNavBack();
  const { data: loaded } = useLandingConfig();
  const save = useSaveLandingConfig();

  const [cfg, setCfg] = useState<LandingConfig | null>(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (loaded && !cfg) setCfg(loaded); }, [loaded]);

  if (!cfg) {
    return <View style={styles.root}><SafeAreaView style={styles.safe} edges={['top']}><ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} /></SafeAreaView></View>;
  }

  const set = (patch: Partial<LandingConfig>) => setCfg({ ...cfg, ...patch });
  const setFeature = (i: number, patch: Partial<LandingFeature>) => set({ features: cfg.features.map((f, idx) => idx === i ? { ...f, ...patch } : f) });
  const setStat = (i: number, patch: Partial<LandingStat>) => set({ stats: cfg.stats.map((s, idx) => idx === i ? { ...s, ...patch } : s) });
  const setFooter = (i: number, patch: Partial<LandingLink>) => set({ footerLinks: cfg.footerLinks.map((l, idx) => idx === i ? { ...l, ...patch } : l) });

  function uploadHero() {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !supabase) { setMsg('Téléversement depuis la version web.'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true); setMsg(null);
      try {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `landing/${Date.now()}_${safe}`;
        const { error } = await supabase!.storage.from('gamification').upload(path, file, { upsert: true, contentType: file.type, cacheControl: '31536000' });
        if (error) throw error;
        const { data } = supabase!.storage.from('gamification').getPublicUrl(path);
        set({ heroImage: data.publicUrl });
        setMsg('Image téléversée.');
      } catch (e: unknown) { setMsg(e instanceof Error ? e.message : 'Échec.'); }
      finally { setUploading(false); }
    };
    input.click();
  }

  async function persist() {
    setMsg(null);
    try { await save.mutateAsync(cfg!); setMsg('Enregistré ✓'); }
    catch (e: unknown) { setMsg(e instanceof Error ? e.message : 'Erreur'); }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={goBack}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} /><Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Page d'accueil (bureau)</Text>
        <Text style={styles.sub}>Affichée sur le web en grand écran. Sur mobile, l'accueil classique reste utilisé. Les boutons mènent aux pages de connexion / inscription.</Text>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
          {/* Général */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.section}>Activer la landing desktop</Text>
              <Switch value={cfg.enabled} onValueChange={(v) => set({ enabled: v })} />
            </View>
            <Field label="Nom de la marque" value={cfg.brandName} onChange={(v) => set({ brandName: v })} styles={styles} c={COLORS} />
            <Field label="Bouton principal (S'inscrire)" value={cfg.ctaPrimaryLabel} onChange={(v) => set({ ctaPrimaryLabel: v })} styles={styles} c={COLORS} />
            <Field label="Bouton secondaire (Se connecter)" value={cfg.ctaSecondaryLabel} onChange={(v) => set({ ctaSecondaryLabel: v })} styles={styles} c={COLORS} />
          </View>

          {/* Héros */}
          <View style={styles.card}>
            <Text style={styles.section}>Héros</Text>
            <Field label="Badge (petit texte)" value={cfg.heroBadge} onChange={(v) => set({ heroBadge: v })} styles={styles} c={COLORS} />
            <Field label="Titre principal" value={cfg.heroTitle} onChange={(v) => set({ heroTitle: v })} multiline styles={styles} c={COLORS} />
            <Field label="Sous-titre" value={cfg.heroSubtitle} onChange={(v) => set({ heroSubtitle: v })} multiline styles={styles} c={COLORS} />
            <Text style={styles.fieldLabel}>Image du visuel (sinon maquette stylée)</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={[styles.input, { flex: 1 }]} value={cfg.heroImage} onChangeText={(v) => set({ heroImage: v })} placeholder="URL image" placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" autoCorrect={false} />
              <TouchableOpacity style={styles.uploadBtn} onPress={uploadHero} disabled={uploading}>
                {uploading ? <ActivityIndicator size="small" color={COLORS.emerald} /> : <Ionicons name="cloud-upload-outline" size={18} color={COLORS.emerald} />}
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>Maquette (si pas d'image) :</Text>
            <Field label="Libellé du solde" value={cfg.heroBalanceLabel} onChange={(v) => set({ heroBalanceLabel: v })} styles={styles} c={COLORS} />
            <Field label="Montant du solde" value={cfg.heroBalanceValue} onChange={(v) => set({ heroBalanceValue: v })} styles={styles} c={COLORS} />
            <Field label="Libellé transaction" value={cfg.heroTxLabel} onChange={(v) => set({ heroTxLabel: v })} styles={styles} c={COLORS} />
            <Field label="Montant transaction" value={cfg.heroTxAmount} onChange={(v) => set({ heroTxAmount: v })} styles={styles} c={COLORS} />
          </View>

          {/* Fonctionnalités */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.section}>Fonctionnalités</Text>
              <TouchableOpacity onPress={() => set({ features: [...cfg.features, { icon: 'sparkles', title: 'Titre', text: '' }] })} style={styles.addBtn}><Ionicons name="add" size={16} color={COLORS.emerald} /><Text style={styles.addText}>Ajouter</Text></TouchableOpacity>
            </View>
            <Field label="Titre de section" value={cfg.featuresTitle} onChange={(v) => set({ featuresTitle: v })} styles={styles} c={COLORS} />
            <Field label="Sous-titre de section" value={cfg.featuresSubtitle} onChange={(v) => set({ featuresSubtitle: v })} multiline styles={styles} c={COLORS} />
            {cfg.features.map((f, i) => (
              <View key={i} style={styles.subCard}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>Fonctionnalité {i + 1}</Text>
                  <TouchableOpacity onPress={() => set({ features: cfg.features.filter((_, idx) => idx !== i) })}><Ionicons name="trash-outline" size={18} color={COLORS.danger} /></TouchableOpacity>
                </View>
                <Field label="Icône (Ionicons)" value={f.icon} onChange={(v) => setFeature(i, { icon: v })} styles={styles} c={COLORS} />
                <Field label="Titre" value={f.title} onChange={(v) => setFeature(i, { title: v })} styles={styles} c={COLORS} />
                <Field label="Texte" value={f.text} onChange={(v) => setFeature(i, { text: v })} multiline styles={styles} c={COLORS} />
              </View>
            ))}
          </View>

          {/* Statistiques */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.section}>Statistiques</Text>
              <TouchableOpacity onPress={() => set({ stats: [...cfg.stats, { value: '0', label: '' }] })} style={styles.addBtn}><Ionicons name="add" size={16} color={COLORS.emerald} /><Text style={styles.addText}>Ajouter</Text></TouchableOpacity>
            </View>
            {cfg.stats.map((s, i) => (
              <View key={i} style={styles.rowItem}>
                <TextInput style={[styles.input, { width: 90 }]} value={s.value} onChangeText={(v) => setStat(i, { value: v })} placeholder="100%" placeholderTextColor={COLORS.textSecondary} />
                <TextInput style={[styles.input, { flex: 1 }]} value={s.label} onChangeText={(v) => setStat(i, { label: v })} placeholder="Libellé" placeholderTextColor={COLORS.textSecondary} />
                <TouchableOpacity onPress={() => set({ stats: cfg.stats.filter((_, idx) => idx !== i) })}><Ionicons name="trash-outline" size={18} color={COLORS.danger} /></TouchableOpacity>
              </View>
            ))}
          </View>

          {/* CTA final + footer */}
          <View style={styles.card}>
            <Text style={styles.section}>Appel à l'action final</Text>
            <Field label="Titre" value={cfg.finalTitle} onChange={(v) => set({ finalTitle: v })} styles={styles} c={COLORS} />
            <Field label="Sous-titre" value={cfg.finalSubtitle} onChange={(v) => set({ finalSubtitle: v })} multiline styles={styles} c={COLORS} />
          </View>

          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.section}>Pied de page</Text>
              <TouchableOpacity onPress={() => set({ footerLinks: [...cfg.footerLinks, { label: 'Lien', anchor: 'login' }] })} style={styles.addBtn}><Ionicons name="add" size={16} color={COLORS.emerald} /><Text style={styles.addText}>Ajouter</Text></TouchableOpacity>
            </View>
            <Field label="Texte du pied de page" value={cfg.footerText} onChange={(v) => set({ footerText: v })} multiline styles={styles} c={COLORS} />
            {cfg.footerLinks.map((l, i) => (
              <View key={i} style={styles.rowItem}>
                <TextInput style={[styles.input, { flex: 1 }]} value={l.label} onChangeText={(v) => setFooter(i, { label: v })} placeholder="Libellé" placeholderTextColor={COLORS.textSecondary} />
                <TextInput style={[styles.input, { width: 110 }]} value={l.anchor ?? l.url ?? ''} onChangeText={(v) => setFooter(i, /^https?:\/\//.test(v) ? { url: v, anchor: undefined } : { anchor: v, url: undefined })} placeholder="ancre / URL" placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" />
                <TouchableOpacity onPress={() => set({ footerLinks: cfg.footerLinks.filter((_, idx) => idx !== i) })}><Ionicons name="trash-outline" size={18} color={COLORS.danger} /></TouchableOpacity>
              </View>
            ))}
            <Text style={styles.hint}>Ancres : confidentialite, legal (pages publiques), login, register, features, stats, final — ou une URL https://…</Text>
          </View>

          <TouchableOpacity style={[styles.saveBtn, save.isPending && { opacity: 0.6 }]} onPress={persist} disabled={save.isPending}>
            {save.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveLabel}>Enregistrer la page d'accueil</Text>}
          </TouchableOpacity>
          {msg && <Text style={[styles.msg, { color: msg.includes('Erreur') || msg.includes('Échec') ? COLORS.danger : COLORS.emerald }]}>{msg}</Text>}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Field({ label, value, onChange, multiline, styles, c }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; styles: any; c: any }) {
  return (
    <>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={[styles.input, multiline && { minHeight: 64, textAlignVertical: 'top' }]} value={value} onChangeText={onChange} multiline={multiline} placeholderTextColor={c.textSecondary} />
    </>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    backText: { fontSize: 14, fontWeight: '600', color: c.text },
    title: { fontSize: 22, fontWeight: '800', color: c.text },
    sub: { fontSize: 12, color: c.textSecondary, marginBottom: 14, lineHeight: 16 },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, marginBottom: 12 },
    subCard: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, marginTop: 10 },
    section: { fontSize: 15, fontWeight: '700', color: c.text, marginBottom: 4 },
    cardTitle: { fontSize: 13, fontWeight: '700', color: c.text },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowItem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
    fieldLabel: { fontSize: 12, color: c.textSecondary, fontWeight: '600', marginTop: 8, marginBottom: 4 },
    hint: { fontSize: 11, color: c.textSecondary, marginTop: 8, fontStyle: 'italic' },
    input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: c.text, fontSize: 13, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    uploadBtn: { width: 44, borderWidth: 1.5, borderStyle: 'dashed' as any, borderColor: c.emerald, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 8 },
    addText: { color: c.emerald, fontWeight: '700', fontSize: 13 },
    saveBtn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    saveLabel: { color: '#fff', fontWeight: '700', fontSize: 15 },
    msg: { textAlign: 'center', marginTop: 10, fontWeight: '600' },
  });
}
