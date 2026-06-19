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
import ScreenGradient from '../../../../components/ScreenGradient';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useNavBack } from '../../../../hooks/useNavBack';
import { supabase } from '../../../../lib/supabase';
import { useAdsConfig, useSaveAdsConfig, bannerPlacements, AD_PLACEMENTS, type AdBanner } from '../../../../hooks/useAdsConfig';

// Emplacements regroupés par page (ordre stable) → sélection compacte.
type Placement = (typeof AD_PLACEMENTS)[number];
const PLACEMENT_GROUPS: [string, Placement[]][] = (() => {
  const map = new Map<string, Placement[]>();
  for (const p of AD_PLACEMENTS) {
    const arr = map.get(p.group) ?? [];
    arr.push(p);
    map.set(p.group, arr);
  }
  return Array.from(map.entries());
})();

export default function AdminAds() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const goBack = useNavBack();
  const { data: loaded } = useAdsConfig();
  const save = useSaveAdsConfig();

  const [banners, setBanners] = useState<AdBanner[] | null>(null);
  const [rotation, setRotation] = useState('6');
  const [opacity, setOpacity] = useState('100');
  const [disabled, setDisabled] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Emplacements repliés par défaut (résumé sur 1 ligne) → carte bannière compacte.
  const [openPlacements, setOpenPlacements] = useState<Record<string, boolean>>({});

  // Résumé court des emplacements sélectionnés, groupé par page : « Comptes (2) · Pilotage ».
  const placementSummary = (b: AdBanner) => {
    const sel = bannerPlacements(b);
    const byGroup = new Map<string, number>();
    for (const p of AD_PLACEMENTS) {
      if (sel.includes(p.value)) byGroup.set(p.group, (byGroup.get(p.group) ?? 0) + 1);
    }
    return Array.from(byGroup.entries()).map(([g, n]) => (n > 1 ? `${g} (${n})` : g)).join(' · ');
  };

  useEffect(() => {
    if (loaded && banners === null) {
      setBanners(loaded.banners);
      setRotation(String(loaded.rotation_seconds ?? 6));
      setOpacity(String(loaded.opacity ?? 100));
      setDisabled(loaded.disabled ?? false);
    }
  }, [loaded]);

  if (banners === null) {
    return <View style={styles.root}><SafeAreaView style={styles.safe} edges={['top']}><ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} /></SafeAreaView></View>;
  }

  const update = (i: number, patch: Partial<AdBanner>) => setBanners(banners.map((b, idx) => idx === i ? { ...b, ...patch } : b));
  const add = () => setBanners([...banners, { id: `ad_${Date.now()}`, label: 'Nouvelle bannière', text: '', url: '', placements: ['pilotage'] }]);
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
    try { await save.mutateAsync({ banners, rotation_seconds: Math.max(2, Number(rotation) || 6), opacity: Math.max(0, Math.min(100, Math.round(Number(opacity)) || 100)), disabled }); setMsg('Enregistré ✓'); }
    catch (e: unknown) { setMsg(e instanceof Error ? e.message : 'Erreur'); }
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={goBack}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} /><Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Publicités (bannières maison)</Text>
        <Text style={styles.sub}>Affichées dans les zones de pub si le flag « Publicités » est activé (et masquées pour les Premium). Plusieurs bannières au même emplacement défilent en fondu enchaîné.</Text>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
          {/* Masquage global — retire toutes les pubs sans rien supprimer */}
          <TouchableOpacity
            style={[styles.card, styles.globalToggle, disabled && { borderColor: COLORS.danger }]}
            activeOpacity={0.8}
            onPress={() => setDisabled((v) => !v)}
          >
            <Ionicons name={disabled ? 'eye-off' : 'eye'} size={20} color={disabled ? COLORS.danger : COLORS.emerald} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{disabled ? 'Publicités masquées' : 'Publicités affichées'}</Text>
              <Text style={styles.hintInline}>{disabled ? 'Toutes les bannières sont retirées (rien n\'est supprimé).' : 'Touchez pour masquer toutes les bannières d\'un coup.'}</Text>
            </View>
            <View style={[styles.switchTrack, disabled && { backgroundColor: COLORS.danger }]}>
              <View style={[styles.switchThumb, disabled && { alignSelf: 'flex-start' }]} />
            </View>
          </TouchableOpacity>

          {/* Durée d'affichage avant fondu */}
          <View style={styles.card}>
            <Text style={styles.label}>Durée d'affichage avant changement (secondes)</Text>
            <TextInput style={styles.input} value={rotation} onChangeText={setRotation} keyboardType="numeric" placeholder="6" placeholderTextColor={COLORS.textSecondary} />
          </View>

          {/* Opacité globale des bannières */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={[styles.label, { marginTop: 0 }]}>Opacité des bannières</Text>
              <Text style={styles.opacityValue}>{Math.max(0, Math.min(100, Math.round(Number(opacity)) || 0))} %</Text>
            </View>
            {Platform.OS === 'web' ? (
              <input
                type="range" min={0} max={100} step={1}
                value={Math.max(0, Math.min(100, Number(opacity) || 0))}
                onChange={(e: any) => setOpacity(String(e.target.value))}
                style={{ width: '100%', cursor: 'pointer', accentColor: COLORS.emerald, height: 6, marginTop: 8 } as any}
              />
            ) : (
              <TextInput style={styles.input} value={opacity} onChangeText={setOpacity} keyboardType="numeric" placeholder="100" placeholderTextColor={COLORS.textSecondary} />
            )}
            <Text style={styles.hintInline}>Appliquée à toutes les bannières (100 % = opaque).</Text>
          </View>

          {banners.map((b, i) => (
            <View key={b.id} style={[styles.card, b.hidden && styles.cardHidden]}>
              <View style={styles.rowBetween}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <Text style={styles.cardTitle}>Bannière {i + 1}</Text>
                  {b.hidden && <Text style={styles.hiddenTag}>Masquée</Text>}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <TouchableOpacity onPress={() => update(i, { hidden: !b.hidden })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name={b.hidden ? 'eye-off-outline' : 'eye-outline'} size={18} color={b.hidden ? COLORS.danger : COLORS.emerald} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => remove(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Ionicons name="trash-outline" size={18} color={COLORS.danger} /></TouchableOpacity>
                </View>
              </View>
              {/* En-tête repliable : résumé des emplacements sur 1 ligne (compact). */}
              <TouchableOpacity style={styles.placementToggle} onPress={() => setOpenPlacements((s) => ({ ...s, [b.id]: !s[b.id] }))} activeOpacity={0.7}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Emplacements</Text>
                  <Text style={styles.placementSummary} numberOfLines={1}>{placementSummary(b) || 'Aucun'}</Text>
                </View>
                <Ionicons name={openPlacements[b.id] ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
              {openPlacements[b.id] && (
                <>
                  {/* Groupé par page → chaque puce = une position dans la page. */}
                  {PLACEMENT_GROUPS.map(([group, items]) => (
                    <View key={group} style={styles.placementGroup}>
                      <Text style={styles.placementGroupLabel}>{group}</Text>
                      <View style={styles.placementRow}>
                        {items.map((p) => {
                          const current = bannerPlacements(b);
                          const active = current.includes(p.value);
                          const toggle = () => {
                            const next = active ? current.filter((x) => x !== p.value) : [...current, p.value];
                            // On garde toujours au moins une page ciblée.
                            update(i, { placements: next.length ? next : [p.value], placement: undefined });
                          };
                          return (
                            <TouchableOpacity key={p.value} onPress={toggle}
                              style={[styles.placementChip, active && { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald }]}>
                              <Ionicons name={active ? 'checkbox' : 'square-outline'} size={13} color={active ? COLORS.bg : COLORS.textSecondary} />
                              <Text style={[styles.placementChipText, active && { color: COLORS.bg }]}>{p.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  ))}
                  <Text style={styles.hintInline}>Plusieurs bannières sur un même emplacement défilent en fondu (rotation).</Text>
                </>
              )}
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
    cardHidden: { opacity: 0.55 },
    globalToggle: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    switchTrack: { width: 44, height: 26, borderRadius: 13, backgroundColor: c.emerald, padding: 3, justifyContent: 'center' },
    switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: 'flex-end' },
    hiddenTag: { fontSize: 10, fontWeight: '800', color: c.danger, textTransform: 'uppercase', letterSpacing: 0.5, borderWidth: 1, borderColor: c.danger, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    cardTitle: { fontSize: 14, fontWeight: '700', color: c.text },
    opacityValue: { fontSize: 14, fontWeight: '800', color: c.emerald },
    label: { fontSize: 12, color: c.textSecondary, fontWeight: '600', marginTop: 8, marginBottom: 4 },
    input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: c.text, fontSize: 13, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    uploadBtn: { width: 44, borderWidth: 1.5, borderStyle: 'dashed' as any, borderColor: c.emerald, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    placementToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
    placementSummary: { fontSize: 12.5, color: c.text, fontWeight: '600', marginTop: 2 },
    placementGroup: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
    placementGroupLabel: { width: 78, fontSize: 11, color: c.textSecondary, fontWeight: '700', paddingTop: 7 },
    placementRow: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    placementChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
    placementChipText: { fontSize: 11, color: c.text, fontWeight: '600' },
    hintInline: { fontSize: 11, color: c.textSecondary, marginTop: 6, fontStyle: 'italic' },
    addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginBottom: 8 },
    addText: { color: c.emerald, fontWeight: '700', fontSize: 13 },
    saveBtn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    saveLabel: { color: '#fff', fontWeight: '700', fontSize: 15 },
    msg: { textAlign: 'center', marginTop: 10, fontWeight: '600' },
  });
}
