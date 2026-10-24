/**
 * Admin — Gamification & Identité.
 * Édite la config app_config.gamification : identité (libellés/icônes), série, remise premium,
 * et la liste des badges (libellé, description, métrique, icône Ionicons OU image téléversée,
 * seuils + relyks de récompense). Téléversement d'icônes vers le bucket « gamification ».
 */
import { gardenFormStyles } from '../../../../lib/garden/legacyStyles';
import GardenRulesEditor from '../../../../components/admin/GardenRulesEditor';
import React, { useMemo, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Switch, Platform } from 'react-native';
import KeyboardAwareScrollView from '../../../../components/layout/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import CurrencyIcon from '../../../../components/gamification/CurrencyIcon';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import { useNavBack } from '../../../../hooks/platform/useNavBack';
import { supabase } from '../../../../lib/platform/supabase';
import { useGamificationConfig, useSaveGamificationConfig } from '../../../../hooks/engagement/useGamificationConfig';
import { isImageIcon, currencyPlural, type GamificationConfig, type BadgeDef, type BadgeMetric } from '../../../../lib/engagement/gamification';
import { GARDEN_FONTS as GF } from '../../../../lib/garden/fontFamilies';

const METRICS: { value: BadgeMetric; label: string }[] = [
  { value: 'streak_weeks', label: 'Semaines connectées (cumul)' },
  { value: 'login_streak_days', label: 'Jours consécutifs connecté' },
  { value: 'account_age_days', label: 'Ancienneté (jours)' },
  { value: 'gems_earned', label: 'Relyks gagnées (cumul)' },
  { value: 'closures_count', label: 'Clôtures effectuées' },
  { value: 'surplus_months_streak', label: 'Mois consécutifs en excédent' },
  { value: 'invest_followed', label: 'Recos investir suivies' },
  { value: 'onboarding_done', label: 'Guide terminé (1/0)' },
  { value: 'profile_photo', label: 'Photo de profil (1/0)' },
  { value: 'manual', label: 'Manuel (code dédié)' },
];

export default function AdminGamification() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const goBack = useNavBack();
  const { data: loaded } = useGamificationConfig();
  const saveConfig = useSaveGamificationConfig();

  const [cfg, setCfg] = useState<GamificationConfig | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<'identite' | 'streak' | 'badges' | 'jardin'>('identite');
  const [catFilter, setCatFilter] = useState<string>('__all__');

  useEffect(() => { if (loaded && !cfg) setCfg(loaded); }, [loaded]);

  if (!cfg) {
    return (
      <View style={styles.root}><ScreenGradient /><SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Gamification" onBack={goBack} />
        <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} />
      </SafeAreaView></View>
    );
  }

  const setIdentity = (patch: Partial<GamificationConfig['identity']>) => setCfg({ ...cfg, identity: { ...cfg.identity, ...patch } });
  const setStreak = (patch: Partial<GamificationConfig['streak']>) => setCfg({ ...cfg, streak: { ...cfg.streak, ...patch } });
  const updateBadge = (i: number, patch: Partial<BadgeDef>) => setCfg({ ...cfg, badges: cfg.badges.map((b, idx) => idx === i ? { ...b, ...patch } : b) });
  const addBadge = () => {
    const category = catFilter !== '__all__' ? catFilter : 'Divers';
    setCfg({ ...cfg, badges: [...cfg.badges, { key: `badge_${Date.now()}`, category, metric: 'manual', label: 'Nouveau succès', description: '', icon: 'trophy', threshold: 1, gems: 20 }] });
  };
  const removeBadge = (i: number) => setCfg({ ...cfg, badges: cfg.badges.filter((_, idx) => idx !== i) });

  /** Sélecteur d'image générique → téléverse dans le bucket « gamification » et renvoie l'URL. */
  function pickImage(uploadKey: string, onUrl: (url: string) => void) {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !supabase) { setMsg('Téléversement depuis la version web.'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/svg+xml,image/webp,image/gif';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploadingKey(uploadKey); setMsg(null);
      try {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `icons/${Date.now()}_${safe}`;
        const { error } = await supabase!.storage.from('gamification').upload(path, file, { upsert: true, contentType: file.type, cacheControl: '31536000' });
        if (error) throw error;
        const { data } = supabase!.storage.from('gamification').getPublicUrl(path);
        onUrl(data.publicUrl);
        setMsg('Image téléversée.');
      } catch (e: unknown) {
        setMsg(e instanceof Error ? e.message : 'Échec du téléversement.');
      } finally { setUploadingKey(null); }
    };
    input.click();
  }
  const uploadIcon = (badgeIndex: number) => pickImage(cfg!.badges[badgeIndex].key, (url) => updateBadge(badgeIndex, { icon: url }));

  async function save() {
    if (!cfg) return;
    setMsg(null);
    try { await saveConfig.mutateAsync(cfg); setMsg('Enregistré ✓'); }
    catch (e: unknown) { setMsg(e instanceof Error ? e.message : 'Erreur'); }
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Gamification" onBack={goBack} />

        {/* Onglets par catégorie de réglages */}
        <View style={styles.tabsRow}>
          {([['identite', 'Identité'], ['streak', 'Série & boutique'], ['badges', 'Succès'], ['jardin', 'Jardin']] as const).map(([key, label]) => (
            <TouchableOpacity key={key} style={[styles.tabBtn, tab === key && styles.tabBtnActive]} onPress={() => setTab(key)} activeOpacity={0.85}>
              <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <KeyboardAwareScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Identité */}
          {tab === 'identite' && (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.section}>Identité</Text>
              <Switch value={cfg.identity.enabled} onValueChange={(v) => setIdentity({ enabled: v })} />
            </View>
            <Field label="Nom de la monnaie (au singulier)" value={cfg.identity.currencyName} onChange={(v) => setIdentity({ currencyName: v })} styles={styles} c={COLORS} />
            <Text style={styles.hint}>Le « s » du pluriel est ajouté à l'affichage. Les anciens noms (graine, noisette, gemme) sont remplacés par « Relyk » (féminin : une relyk).</Text>
            {/* L'icône de la monnaie n'est plus réglable : c'est la pièce Relyk partout (l'ancien
                champ n'était plus lu par l'app — on ne laisse pas un réglage sans effet). */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
              <CurrencyIcon size={34} />
              <Text style={[styles.hint, { flex: 1, marginTop: 0 }]}>Icône de la monnaie : la pièce Relyk, utilisée dans toute l'app.</Text>
            </View>
            <Field label="Libellé de la série" value={cfg.identity.streakLabel} onChange={(v) => setIdentity({ streakLabel: v })} styles={styles} c={COLORS} />
            <IconField label="Icône de série (🔥 = flamme 3D, ou emoji, Ionicons, image)" value={cfg.identity.streakIcon}
              onChange={(v) => setIdentity({ streakIcon: v })} onUpload={() => pickImage('streakIcon', (url) => setIdentity({ streakIcon: url }))}
              uploading={uploadingKey === 'streakIcon'} styles={styles} c={COLORS} />
          </View>
          )}

          {/* Série + premium */}
          {tab === 'streak' && (() => {
            const cur = currencyPlural(cfg.identity.currencyName);
            const updateItem = (key: string, patch: Partial<GamificationConfig['shop'][number]>) =>
              setCfg({ ...cfg, shop: cfg.shop.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
            const setItemGems = (item: GamificationConfig['shop'][number], v: string) =>
              updateItem(item.key, { payload: { ...(item.payload ?? {}), gems: Number(v) || 0 } });
            return (
            <>
            <View style={styles.card}>
              <Text style={styles.section}>Série & boutique</Text>
              <Field label={`${cur} par semaine validée`} value={String(cfg.streak.weeklyGems)} keyboard onChange={(v) => setStreak({ weeklyGems: Number(v) || 0 })} styles={styles} c={COLORS} />
              <Field label="Remise premium boutique (%)" value={String(cfg.premium_discount_pct)} keyboard onChange={(v) => setCfg({ ...cfg, premium_discount_pct: Number(v) || 0 })} styles={styles} c={COLORS} />
              <View style={[styles.rowBetween, { marginTop: 12 }]}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.fieldLabel}>Onglet « Relyka » dans la boutique</Text>
                  <Text style={styles.hint}>Masqué → seul l'onglet « App » s'affiche, sans barre d'onglets.</Text>
                </View>
                <Switch value={cfg.relyka_tab_enabled} onValueChange={(v) => setCfg({ ...cfg, relyka_tab_enabled: v })} />
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.section}>Prix des articles</Text>
              <Text style={styles.hint}>Prix en {cur} de chaque article. Pour les recharges (argent réel) et le cadeau du jour, définissez la quantité de {cur} accordée.</Text>
              {cfg.shop.map((item) => {
                const isQty = item.type === 'gems_iap' || item.type === 'daily_gems';
                return (
                  <View key={item.key} style={styles.shopPriceRow}>
                    <Text style={styles.shopPriceLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                    <Text style={styles.shopPriceUnit}>{isQty ? 'Qté' : cur}</Text>
                    <TextInput
                      style={styles.shopPriceInput}
                      value={String(isQty ? (Number((item.payload as any)?.gems) || 0) : item.price)}
                      onChangeText={(v) => (isQty ? setItemGems(item, v) : updateItem(item.key, { price: Number(v) || 0 }))}
                      keyboardType="numeric"
                      placeholderTextColor={COLORS.textSecondary}
                    />
                  </View>
                );
              })}
            </View>
            </>
            );
          })()}

          {/* Règles du jardin : seuils d'apparition (lib/garden/gardenRules) */}
          {tab === 'jardin' && <GardenRulesEditor value={cfg.garden} onChange={(garden) => setCfg({ ...cfg, garden })} />}

          {/* Badges */}
          {tab === 'badges' && (() => {
            const categories = Array.from(new Set(cfg.badges.map((b) => b.category || 'Divers')));
            const filtered = cfg.badges
              .map((b, i) => ({ b, i }))
              .filter(({ b }) => catFilter === '__all__' || (b.category || 'Divers') === catFilter);
            return (
          <>
          {/* Filtre par catégorie */}
          <View style={styles.catRow}>
            <TouchableOpacity onPress={() => setCatFilter('__all__')} style={[styles.catChip, catFilter === '__all__' && styles.catChipActive]}>
              <Text style={[styles.catChipText, catFilter === '__all__' && styles.catChipTextActive]}>Toutes</Text>
            </TouchableOpacity>
            {categories.map((cat) => (
              <TouchableOpacity key={cat} onPress={() => setCatFilter(cat)} style={[styles.catChip, catFilter === cat && styles.catChipActive]}>
                <Text style={[styles.catChipText, catFilter === cat && styles.catChipTextActive]}>{cat}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.rowBetween}>
            <Text style={[styles.section, { marginLeft: 4 }]}>Succès ({filtered.length})</Text>
            <TouchableOpacity onPress={addBadge} style={styles.addBtn}><Ionicons name="add" size={16} color={COLORS.emerald} /><Text style={styles.addBtnText}>Ajouter</Text></TouchableOpacity>
          </View>

          {filtered.map(({ b, i }) => (
            <View key={b.key} style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={[styles.badgePreview, { backgroundColor: COLORS.emerald + '22' }]}>
                  {isImageIcon(b.icon) ? <Text style={{ fontFamily: GF.body, fontSize: 9, color: COLORS.textSecondary }}>IMG</Text> : <Ionicons name={(b.icon || 'trophy') as any} size={20} color={COLORS.emerald} />}
                </View>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Supprimer le succès" onPress={() => removeBadge(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Ionicons name="trash-outline" size={18} color={COLORS.danger} /></TouchableOpacity>
              </View>
              <Field label="Titre" value={b.label} onChange={(v) => updateBadge(i, { label: v })} styles={styles} c={COLORS} />
              <Field label="Description" value={b.description} onChange={(v) => updateBadge(i, { description: v })} styles={styles} c={COLORS} />
              <Field label="Catégorie" value={b.category} onChange={(v) => updateBadge(i, { category: v })} styles={styles} c={COLORS} />
              {/* Métrique */}
              <Text style={styles.fieldLabel}>Métrique de déblocage</Text>
              <View style={styles.metricRow}>
                {METRICS.map((m) => (
                  <TouchableOpacity key={m.value} onPress={() => updateBadge(i, { metric: m.value })}
                    style={[styles.metricChip, b.metric === m.value && { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald }]}>
                    <Text style={[styles.metricChipText, b.metric === m.value && { color: COLORS.bg }]}>{m.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* Icône */}
              <Text style={styles.fieldLabel}>Icône : image téléversée (sinon, l'image 3D de la famille du succès — souche, flamme, arrosoir…)</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput style={[styles.input, { flex: 1 }]} value={b.icon} onChangeText={(v) => updateBadge(i, { icon: v })} placeholder="trophy, flame, ribbon… ou URL" placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" autoCorrect={false} />
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Téléverser l'icône du succès" style={styles.uploadBtn} onPress={() => uploadIcon(i)} disabled={uploadingKey === b.key}>
                  {uploadingKey === b.key ? <ActivityIndicator size="small" color={COLORS.emerald} /> : <Ionicons name="cloud-upload-outline" size={18} color={COLORS.emerald} />}
                </TouchableOpacity>
              </View>
              {/* Déblocage : seuil unique + récompense */}
              <Text style={styles.fieldLabel}>Déblocage (seuil → récompense)</Text>
              <View style={styles.levelRow}>
                <Text style={[styles.levelName, { color: COLORS.textSecondary }]}>Seuil</Text>
                <TextInput style={styles.miniInput} value={String(b.threshold ?? 0)} onChangeText={(v) => updateBadge(i, { threshold: Number(v) || 0 })} keyboardType="numeric" placeholder="seuil" placeholderTextColor={COLORS.textSecondary} />
                <CurrencyIcon size={14} />
                <TextInput style={styles.miniInput} value={String(b.gems ?? 0)} onChangeText={(v) => updateBadge(i, { gems: Number(v) || 0 })} keyboardType="numeric" placeholder="récompense" placeholderTextColor={COLORS.textSecondary} />
              </View>
            </View>
          ))}
          </>
            );
          })()}

          <TouchableOpacity style={[styles.saveBtn, saveConfig.isPending && { opacity: 0.6 }]} onPress={save} disabled={saveConfig.isPending}>
            {saveConfig.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveLabel}>Enregistrer la gamification</Text>}
          </TouchableOpacity>
          {msg && <Text style={[styles.msg, { color: msg.includes('Erreur') || msg.includes('Échec') ? COLORS.danger : COLORS.emerald }]}>{msg}</Text>}
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </View>
  );
}

function IconField({ label, value, onChange, onUpload, uploading, styles, c }: { label: string; value: string; onChange: (v: string) => void; onUpload: () => void; uploading: boolean; styles: any; c: any }) {
  return (
    <>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput style={[styles.input, { flex: 1 }]} value={value} onChangeText={onChange} placeholder="🔥, flame ou URL" placeholderTextColor={c.textSecondary} autoCapitalize="none" autoCorrect={false} />
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Téléverser l'image" style={styles.uploadBtn} onPress={onUpload} disabled={uploading}>
          {uploading ? <ActivityIndicator size="small" color={c.emerald} /> : <Ionicons name="cloud-upload-outline" size={18} color={c.emerald} />}
        </TouchableOpacity>
      </View>
    </>
  );
}

function Field({ label, value, onChange, keyboard, styles, c }: { label: string; value: string; onChange: (v: string) => void; keyboard?: boolean; styles: any; c: any }) {
  return (
    <>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChange} keyboardType={keyboard ? 'numeric' : 'default'} placeholderTextColor={c.textSecondary} autoCapitalize="none" />
    </>
  );
}

function makeStyles(c: any) {
  const base = makeBaseStyles(c);
  return gardenFormStyles(base);
}

function makeBaseStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    tabsRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
    tabBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingVertical: 9, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    tabBtnActive: { borderColor: c.emerald, backgroundColor: c.emerald + '14' },
    tabText: { fontFamily: GF.bodyBold, fontSize: 13, fontWeight: 'normal', color: c.textSecondary },
    tabTextActive: { color: c.emerald },
    catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10, marginLeft: 4 },
    catChip: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    catChipActive: { backgroundColor: c.emerald, borderColor: c.emerald },
    catChipText: { fontFamily: GF.bodyBold, fontSize: 12, color: c.text, fontWeight: 'normal' },
    catChipTextActive: { color: c.onAccent },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 80 },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, marginBottom: 12, gap: 4 },
    section: { fontFamily: GF.bodyBold, fontSize: 15, fontWeight: 'normal', color: c.text, marginBottom: 4 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    fieldLabel: { fontFamily: GF.bodyBold, fontSize: 12, color: c.textSecondary, fontWeight: 'normal', marginTop: 8, marginBottom: 4 },
    hint: { fontFamily: GF.body, fontSize: 11, color: c.textSecondary, fontStyle: 'italic', marginTop: 2 },
    input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: c.text, fontSize: 13, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    metricChip: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
    metricChipText: { fontFamily: GF.bodyBold, fontSize: 11, color: c.text, fontWeight: 'normal' },
    badgePreview: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    uploadBtn: { width: 44, borderWidth: 1.5, borderStyle: 'dashed' as any, borderColor: c.emerald, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    levelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 3 },
    levelName: { fontFamily: GF.bodyBold, width: 54, fontSize: 12, fontWeight: 'normal' },
    miniInput: { flex: 1, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 7, color: c.text, fontSize: 12, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    shopPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
    shopPriceLabel: { fontFamily: GF.bodyBold, flex: 1, fontSize: 12.5, color: c.text, fontWeight: 'normal' },
    shopPriceUnit: { fontFamily: GF.body, fontSize: 11, color: c.textSecondary },
    shopPriceInput: { width: 72, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 7, color: c.text, fontSize: 12, textAlign: 'right', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10 },
    addBtnText: { fontFamily: GF.bodyBold, color: c.emerald, fontWeight: 'normal', fontSize: 13 },
    saveBtn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
    saveLabel: { fontFamily: GF.bodyBold, color: c.onAccent, fontWeight: 'normal', fontSize: 15 },
    msg: { textAlign: 'center', marginTop: 10, fontFamily: GF.bodyBold, fontWeight: 'normal' },
  });
}
