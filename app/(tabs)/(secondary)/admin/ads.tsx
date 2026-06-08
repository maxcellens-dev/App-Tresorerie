/**
 * Admin — Publicités (bannières maison). Gère les bannières affichées dans les zones de pub
 * (activées via le flag « Publicités »). Texte ou image (téléversée), lien optionnel.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../../components/ScreenGradient';
import { useAppColors } from '../../../hooks/useAppColors';
import { supabase } from '../../../lib/supabase';
import { useAdsConfig, useSaveAdsConfig, AD_PLACEMENTS, type AdBanner } from '../../../hooks/useAdsConfig';

export default function AdminAds() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { data: loaded } = useAdsConfig();
  const save = useSaveAdsConfig();

  const [banners, setBanners] = useState<AdBanner[] | null>(null);
  const [rotation, setRotation] = useState('6');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (loaded && banners === null) {
      setBanners(loaded.banners);
      setRotation(String(loaded.rotation_seconds ?? 6));
    }
  }, [loaded]);

  if (banners === null) {
    return <View style={styles.root}><SafeAreaView style={styles.safe} edges={['top']}><ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} /></SafeAreaView></View>;
  }

  const update = (i: number, patch: Partial<AdBanner>) => setBanners(banners.map((b, idx) => idx === i ? { ...b, ...patch } : b));
  const add = () => setBanners([...banners, { id: `ad_${Date.now()}`, label: 'Nouvelle bannière', text: '', url: '', placement: 'pilotage' }]);
  const remove = (i: number) => setBanners(banners.filter((_, idx) => idx !== i));

  function uploadImage(i: number) {
    if (!banners) return;
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !supabase) { setMsg('Téléversement depuis la version web.'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploadingId(banners[i].id); setMsg(null);
      try {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `ads/${Date.now()}_${safe}`;
        const { error } = await supabase!.storage.from('gamification').upload(path, file, { upsert: true, contentType: file.type, cacheControl: '31536000' });
        if (error) throw error;
        const { data } = supabase!.storage.from('gamification').getPublicUrl(path);
        update(i, { image: data.publicUrl });
        setMsg('Image téléversée.');
      } catch (e: unknown) { setMsg(e instanceof Error ? e.message : 'Échec.'); }
      finally { setUploadingId(null); }
    };
    input.click();
  }

  async function persist() {
    if (!banners) return;
    setMsg(null);
    try { await save.mutateAsync({ banners, rotation_seconds: Math.max(2, Number(rotation) || 6) }); setMsg('Enregistré ✓'); }
    catch (e: unknown) { setMsg(e instanceof Error ? e.message : 'Erreur'); }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} /><Text style={styles.backText}>Admin</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Publicités (bannières maison)</Text>
        <Text style={styles.sub}>Affichées dans les zones de pub si le flag « Publicités » est activé (et masquées pour les Premium). Plusieurs bannières au même emplacement défilent en fondu enchaîné.</Text>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
          {/* Durée d'affichage avant fondu */}
          <View style={styles.card}>
            <Text style={styles.label}>Durée d'affichage avant changement (secondes)</Text>
            <TextInput style={styles.input} value={rotation} onChangeText={setRotation} keyboardType="numeric" placeholder="6" placeholderTextColor={COLORS.textSecondary} />
          </View>

          {banners.map((b, i) => (
            <View key={b.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>Bannière {i + 1}</Text>
                <TouchableOpacity onPress={() => remove(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Ionicons name="trash-outline" size={18} color={COLORS.danger} /></TouchableOpacity>
              </View>
              <Text style={styles.label}>Emplacement (page)</Text>
              <View style={styles.placementRow}>
                {AD_PLACEMENTS.map((p) => {
                  const active = (b.placement ?? 'pilotage') === p.value;
                  return (
                    <TouchableOpacity key={p.value} onPress={() => update(i, { placement: p.value })}
                      style={[styles.placementChip, active && { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald }]}>
                      <Text style={[styles.placementChipText, active && { color: COLORS.bg }]}>{p.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.label}>Texte (si pas d'image)</Text>
              <TextInput style={styles.input} value={b.text ?? ''} onChangeText={(v) => update(i, { text: v })} placeholder="Découvrez notre partenaire…" placeholderTextColor={COLORS.textSecondary} />
              <Text style={styles.label}>Lien au clic (optionnel)</Text>
              <TextInput style={styles.input} value={b.url ?? ''} onChangeText={(v) => update(i, { url: v })} placeholder="https://…" placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" autoCorrect={false} />
              <Text style={styles.label}>Image (optionnel)</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput style={[styles.input, { flex: 1 }]} value={b.image ?? ''} onChangeText={(v) => update(i, { image: v })} placeholder="URL image" placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" autoCorrect={false} />
                <TouchableOpacity style={styles.uploadBtn} onPress={() => uploadImage(i)} disabled={uploadingId === b.id}>
                  {uploadingId === b.id ? <ActivityIndicator size="small" color={COLORS.emerald} /> : <Ionicons name="cloud-upload-outline" size={18} color={COLORS.emerald} />}
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <TouchableOpacity style={styles.addBtn} onPress={add}><Ionicons name="add" size={16} color={COLORS.emerald} /><Text style={styles.addText}>Ajouter une bannière</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.saveBtn, save.isPending && { opacity: 0.6 }]} onPress={persist} disabled={save.isPending}>
            {save.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveLabel}>Enregistrer</Text>}
          </TouchableOpacity>
          {msg && <Text style={[styles.msg, { color: msg.includes('Erreur') || msg.includes('Échec') ? COLORS.danger : COLORS.emerald }]}>{msg}</Text>}
        </ScrollView>
      </SafeAreaView>
    </View>
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
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    cardTitle: { fontSize: 14, fontWeight: '700', color: c.text },
    label: { fontSize: 12, color: c.textSecondary, fontWeight: '600', marginTop: 8, marginBottom: 4 },
    input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: c.text, fontSize: 13, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    uploadBtn: { width: 44, borderWidth: 1.5, borderStyle: 'dashed' as any, borderColor: c.emerald, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    placementRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
    placementChip: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
    placementChipText: { fontSize: 11, color: c.text, fontWeight: '600' },
    addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginBottom: 8 },
    addText: { color: c.emerald, fontWeight: '700', fontSize: 13 },
    saveBtn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    saveLabel: { color: '#fff', fontWeight: '700', fontSize: 15 },
    msg: { textAlign: 'center', marginTop: 10, fontWeight: '600' },
  });
}
