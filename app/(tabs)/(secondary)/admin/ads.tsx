/**
 * Admin — Publicités (bannières maison). Gère les bannières affichées dans les zones de pub
 * (activées via le flag « Publicités »). Texte ou image (téléversée), lien optionnel.
 */
import React, { useMemo, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Image, Platform } from 'react-native';
import KeyboardAwareScrollView from '../../../../components/layout/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import { useNavBack } from '../../../../hooks/platform/useNavBack';
import { supabase } from '../../../../lib/platform/supabase';
import PageTabs from '../../../../components/ui/PageTabs';
import {
  useAdsConfig, useSaveAdsConfig, bannerPlacements, placementFormat,
  AD_PLACEMENTS, AD_LINK_TARGETS, AD_FORMATS,
  type AdBanner, type AdLinkTarget, type AdFormat,
} from '../../../../hooks/config/useAdsConfig';

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

// Destinations internes regroupées (Pages / Actions) → même présentation que les emplacements.
type LinkTarget = (typeof AD_LINK_TARGETS)[number];
const TARGET_GROUPS: [string, LinkTarget[]][] = (() => {
  const map = new Map<string, LinkTarget[]>();
  for (const t of AD_LINK_TARGETS) {
    const arr = map.get(t.group) ?? [];
    arr.push(t);
    map.set(t.group, arr);
  }
  return Array.from(map.entries());
})();

export default function AdminAds() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const goBack = useNavBack();
  const { data: loaded, isError, refetch } = useAdsConfig();
  const save = useSaveAdsConfig();

  const [banners, setBanners] = useState<AdBanner[] | null>(null);
  const [rotation, setRotation] = useState('6');
  const [opacity, setOpacity] = useState('100');
  const [disabled, setDisabled] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Emplacements ET destination interne repliés par défaut (résumé sur 1 ligne) → carte compacte.
  const [openPlacements, setOpenPlacements] = useState<Record<string, boolean>>({});
  const [openTargets, setOpenTargets] = useState<Record<string, boolean>>({});

  /* ── MAÎTRE / DÉTAIL ────────────────────────────────────────────────────────────────────────
     L'écran dépliait TOUTES les bannières l'une sous l'autre : chacune fait une demi-page, donc à
     dix bannières on faisait défiler sur des mètres pour retrouver celle qu'on cherchait, et le
     bouton « Enregistrer » vivait tout en bas. On sépare donc les deux gestes — CHOISIR une
     bannière (une liste dense, une ligne chacune) puis la MODIFIER (une seule à l'écran).
     Les réglages globaux (rotation, opacité, masquage) partent dans leur propre onglet : ils ne
     concernent aucune bannière en particulier et n'avaient rien à faire au milieu d'elles. */
  const [tab, setTab] = useState<'banners' | 'settings'>('banners');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  /** Filtre par FORMAT : « montre-moi mes carrées » est la question qu'on se pose en régie. */
  const [formatFilter, setFormatFilter] = useState<AdFormat | 'all'>('all');

  /** Destination interne choisie, en une ligne : « Actions · Projets › + Projet ». */
  const targetSummary = (b: AdBanner) => {
    const t = AD_LINK_TARGETS.find((x) => x.value === b.target);
    return t ? `${t.group} · ${t.label}` : 'Aucune destination choisie — bannière non cliquable';
  };

  // Résumé court des emplacements sélectionnés, groupé par page : « Comptes (2) · Pilotage ».
  const placementSummary = (b: AdBanner) => {
    const sel = bannerPlacements(b);
    const byGroup = new Map<string, number>();
    for (const p of AD_PLACEMENTS) {
      if (sel.includes(p.value)) byGroup.set(p.group, (byGroup.get(p.group) ?? 0) + 1);
    }
    return Array.from(byGroup.entries()).map(([g, n]) => (n > 1 ? `${g} (${n})` : g)).join(' · ');
  };

  /** Formats RÉELLEMENT couverts par une bannière — c'est la forme de l'image à fournir. */
  const bannerFormats = (b: AdBanner): AdFormat[] =>
    Array.from(new Set(bannerPlacements(b).map((p) => placementFormat(p))));

  useEffect(() => {
    if (loaded && banners === null) {
      setBanners(loaded.banners);
      setRotation(String(loaded.rotation_seconds ?? 6));
      setOpacity(String(loaded.opacity ?? 100));
      setDisabled(loaded.disabled ?? false);
    }
  }, [loaded]);

  if (banners === null) {
    return <View style={styles.root}><ScreenGradient /><SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}><ScreenHeader title="Publicités" onBack={goBack} /><ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} /></SafeAreaView></View>;
  }

  const update = (i: number, patch: Partial<AdBanner>) => setBanners(banners.map((b, idx) => idx === i ? { ...b, ...patch } : b));
  /** Créer, c'est vouloir remplir : la nouvelle bannière s'OUVRE (sinon elle atterrit tout en bas
   *  d'une liste filtrée, parfois hors du filtre courant, et on ne la retrouve pas). */
  const add = () => {
    const b: AdBanner = { id: `ad_${Date.now()}`, label: 'Nouvelle bannière', text: '', url: '', placements: ['pilotage'] };
    setBanners([...banners, b]);
    setSearch(''); setFormatFilter('all'); setSelectedId(b.id);
  };
  const remove = (i: number) => {
    const gone = banners[i];
    setBanners(banners.filter((_, idx) => idx !== i));
    if (gone && selectedId === gone.id) setSelectedId(null);   // ne pas rester sur un détail supprimé
  };

  /* Liste AFFICHÉE : recherche (libellé + texte) puis filtre de format. L'index d'origine voyage
     avec chaque ligne — `update`/`remove` travaillent sur la liste COMPLÈTE, et une position de
     liste filtrée y désignerait la mauvaise bannière. */
  const q = search.trim().toLowerCase();
  const visible = banners
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => !q || `${b.label ?? ''} ${b.text ?? ''}`.toLowerCase().includes(q))
    .filter(({ b }) => formatFilter === 'all' || bannerFormats(b).includes(formatFilter));
  const selectedIdx = selectedId ? banners.findIndex((b) => b.id === selectedId) : -1;
  const selected = selectedIdx >= 0 ? banners[selectedIdx] : null;

  /**
   * Dimensions d'un fichier image, lues LOCALEMENT (avant tout envoi réseau).
   * `null` si le navigateur n'arrive pas à le décoder — on n'empêche jamais un téléversement pour ça.
   */
  function readImageRatio(file: File): Promise<number | null> {
    return new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(file);
        const img = new (window as any).Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : null); };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      } catch { resolve(null); }
    });
  }

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

        /* CONTRÔLE DU RATIO — l'app ne CHOISIT pas le format d'après l'image (c'est l'emplacement
           qui le décide), mais elle peut dire si le fichier a la bonne forme. Sans ça, on ne
           découvrait le recadrage qu'en ouvrant l'app sur la bonne page. Tolérance 12 % : une image
           1400 × 402 n'est pas une erreur. Purement informatif — l'image est déjà enregistrée. */
        const ratio = await readImageRatio(file);
        const wanted = bannerFormats(banners[i]);
        const off = ratio != null && wanted.length > 0
          && wanted.every((f) => Math.abs(ratio - AD_FORMATS[f].ratio) / AD_FORMATS[f].ratio > 0.12);
        setMsg(off
          ? `Image téléversée, mais son format ne correspond pas : elle est en ${ratio!.toFixed(2)} : 1 alors que cet emplacement attend ${wanted.map((f) => `${AD_FORMATS[f].label} (${AD_FORMATS[f].ideal})`).join(' ou ')}. Elle sera recadrée au centre.`
          : 'Image téléversée.');
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

  /* ⚠️ NE JAMAIS OUVRIR LE FORMULAIRE SUR UNE LECTURE RATÉE : cet écran réécrit la configuration
     des publicités EN ENTIER. Partir d'une liste vide parce que la lecture n'a pas abouti, puis
     appuyer sur « Enregistrer », effaçait TOUTES les bannières configurées. */
  if (isError) {
    return (
      <View style={styles.root}><ScreenGradient /><SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Publicités" onBack={goBack} />
        <Text style={{ color: COLORS.text, marginTop: 24, fontSize: 15, fontWeight: '700' }}>Configuration non chargée</Text>
        <Text style={{ color: COLORS.textSecondary, marginTop: 8, fontSize: 13.5, lineHeight: 19 }}>
          Les bannières actuelles n'ont pas pu être lues. Le formulaire reste fermé : l'ouvrir vide
          ferait écraser les bannières en place au premier enregistrement.
        </Text>
        <TouchableOpacity onPress={() => refetch()} accessibilityRole="button" style={{ marginTop: 18, alignSelf: 'flex-start', backgroundColor: COLORS.emerald, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11 }}>
          <Text style={{ color: COLORS.onAccent, fontWeight: '800', fontSize: 14 }}>Réessayer</Text>
        </TouchableOpacity>
      </SafeAreaView></View>
    );
  }

  /* ── ÉDITEUR D'UNE BANNIÈRE ────────────────────────────────────────────────────────────────
     Exactement le formulaire d'avant — mais rendu pour UNE seule bannière, celle qu'on a choisie
     dans la liste, au lieu d'être répété pour toutes. */
  const renderEditor = (b: AdBanner, i: number) => (
    <View style={[styles.card, b.hidden && styles.cardHidden]}>
      <View style={styles.rowBetween}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{b.label || 'Sans titre'}</Text>
          {b.hidden && <Text style={styles.hiddenTag}>Masquée</Text>}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={b.hidden ? 'Afficher la bannière' : 'Masquer la bannière'} onPress={() => update(i, { hidden: !b.hidden })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name={b.hidden ? 'eye-off-outline' : 'eye-outline'} size={18} color={b.hidden ? COLORS.danger : COLORS.emerald} />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Supprimer la bannière" onPress={() => remove(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Ionicons name="trash-outline" size={18} color={COLORS.danger} /></TouchableOpacity>
        </View>
      </View>

      {/* Le TITRE INTERNE était introuvable : la carte disait « Bannière 3 » et le champ n'existait
          nulle part. C'est pourtant lui qui nomme la ligne dans la liste et les stats. */}
      <Text style={styles.label}>Titre interne (pour t'y retrouver)</Text>
      <TextInput style={styles.input} value={b.label ?? ''} onChangeText={(v) => update(i, { label: v })} placeholder="Ex. Partenaire assurance — septembre" placeholderTextColor={COLORS.textSecondary} />

      {/* En-tête repliable : résumé des emplacements sur 1 ligne (compact).
          ⚠️ C'EST ICI QU'ON CHOISIT LE FORMAT, et rien ne le disait. Le format n'est pas un réglage
          à part, et il ne se déduit PAS du fichier téléversé : il découle des emplacements cochés
          (chaque emplacement a une forme, cf. AD_PLACEMENTS). Sans cette mention, on cherche un
          menu « format » qui n'existe pas. */}
      <TouchableOpacity style={styles.placementToggle} onPress={() => setOpenPlacements((s) => ({ ...s, [b.id]: !s[b.id] }))} activeOpacity={0.7}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Emplacements — ce sont eux qui décident du format</Text>
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

              {/* ── Lien au clic : site externe OU page/bouton de l'app ── */}
              <Text style={styles.label}>Lien au clic (optionnel)</Text>
              <View style={styles.linkTypeRow}>
                {([['external', 'Site externe'], ['internal', 'Dans l\'app']] as const).map(([val, lbl]) => {
                  const active = (b.link_type ?? 'external') === val;
                  return (
                    <TouchableOpacity
                      key={val}
                      style={[styles.linkTypeBtn, active && { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald }]}
                      onPress={() => update(i, { link_type: val })}
                      activeOpacity={0.8}
                    >
                      <Ionicons name={val === 'external' ? 'open-outline' : 'phone-portrait-outline'} size={13} color={active ? COLORS.bg : COLORS.textSecondary} />
                      <Text style={[styles.linkTypeText, active && { color: COLORS.bg }]}>{lbl}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {(b.link_type ?? 'external') === 'external' ? (
                <TextInput style={styles.input} value={b.url ?? ''} onChangeText={(v) => update(i, { url: v })} placeholder="https://…" placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" autoCorrect={false} />
              ) : (
                <>
                  {/* Replié par défaut : la destination tient sur une ligne (la liste complète prend
                      tout l'écran). On la déplie pour changer de cible. */}
                  <TouchableOpacity style={styles.placementToggle} onPress={() => setOpenTargets((s) => ({ ...s, [b.id]: !s[b.id] }))} activeOpacity={0.7}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.placementSummary} numberOfLines={1}>{targetSummary(b)}</Text>
                    </View>
                    <Ionicons name={openTargets[b.id] ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                  {openTargets[b.id] && (
                    <>
                      {TARGET_GROUPS.map(([group, items]) => (
                        <View key={group} style={styles.placementGroup}>
                          <Text style={styles.placementGroupLabel}>{group}</Text>
                          <View style={styles.placementRow}>
                            {items.map((t) => {
                              const active = b.target === t.value;
                              return (
                                <TouchableOpacity
                                  key={t.value}
                                  onPress={() => { update(i, { target: t.value as AdLinkTarget }); setOpenTargets((s) => ({ ...s, [b.id]: false })); }}
                                  style={[styles.placementChip, active && { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald }]}
                                >
                                  <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={13} color={active ? COLORS.bg : COLORS.textSecondary} />
                                  <Text style={[styles.placementChipText, active && { color: COLORS.bg }]}>{t.label}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        </View>
                      ))}
                      <Text style={styles.hintInline}>
                        Une « Action » ouvre la page ET déclenche son bouton (ex. Projets › + Projet → la fenêtre « Quel type de projet ? » s'ouvre à l'arrivée).
                      </Text>
                    </>
                  )}
                </>
              )}

      <Text style={styles.label}>Image (optionnel)</Text>
      {/* LE FORMAT ATTENDU, déduit des emplacements cochés juste au-dessus. Avant, l'admin
          téléversait à l'aveugle : rien ne disait qu'un emplacement rognerait son 1400 × 400 en
          64 pt de haut. On le dit ICI, au moment où il choisit le fichier. */}
      <View style={styles.formatNeeds}>
        {bannerFormats(b).map((f) => (
          <View key={f} style={styles.formatNeedChip}>
            <Text style={styles.formatNeedLabel}>{AD_FORMATS[f].label}</Text>
            <Text style={styles.formatNeedIdeal}>{AD_FORMATS[f].ideal}</Text>
          </View>
        ))}
      </View>
      {/* UNE bannière, UNE image — mais ses emplacements peuvent réclamer DEUX formes. Cocher
          « Pilotage » (3,5 : 1) et « Fin de C'est enregistré » (1 : 1) fait servir le même fichier
          aux deux : l'un des deux sera recadré au centre, et rien ne l'aurait signalé. On le dit
          plutôt que de l'interdire — le recadrage est parfois acceptable, c'est à l'admin de voir. */}
      {bannerFormats(b).length > 1 && (
        <View style={styles.warn}>
          <Ionicons name="warning-outline" size={15} color={COLORS.orange} />
          <Text style={styles.warnText}>
            Cette bannière vise {bannerFormats(b).length} formats différents et n'a qu'une image :
            elle sera recadrée au centre là où la forme ne correspond pas. Pour une image par forme,
            dédouble la bannière (une par format).
          </Text>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput style={[styles.input, { flex: 1 }]} value={b.image ?? ''} onChangeText={(v) => update(i, { image: v })} placeholder="URL image" placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" autoCorrect={false} />
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Téléverser l'image de la bannière" style={styles.uploadBtn} onPress={() => uploadImage(i)} disabled={uploadingId === b.id}>
          {uploadingId === b.id ? <ActivityIndicator size="small" color={COLORS.emerald} /> : <Ionicons name="cloud-upload-outline" size={18} color={COLORS.emerald} />}
        </TouchableOpacity>
      </View>
    </View>
  );

  /* ── LISTE — une LIGNE par bannière, pas une carte ──────────────────────────────────────────
     C'est ce qui remplace la « méga liste » : à dix bannières, on voit les dix d'un coup d'œil,
     avec leur vignette, leurs emplacements et leur format. */
  const renderRow = ({ b, i }: { b: AdBanner; i: number }) => {
    const on = selectedId === b.id;
    return (
      <TouchableOpacity
        key={b.id}
        style={[styles.row, on && styles.rowActive, b.hidden && styles.rowHidden]}
        onPress={() => setSelectedId(on && !isDesktop ? null : b.id)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
      >
        {b.image
          ? <Image source={{ uri: b.image }} style={styles.thumb} resizeMode="cover" />
          : <View style={[styles.thumb, styles.thumbEmpty]}><Ionicons name="megaphone-outline" size={16} color={COLORS.textSecondary} /></View>}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowTitle} numberOfLines={1}>{b.label || b.text || 'Sans titre'}</Text>
            {b.hidden && <Ionicons name="eye-off" size={13} color={COLORS.danger} />}
            {/* Le FORMAT est une pastille, pas la fin d'une ligne de texte : sur une bannière qui
                vise cinq pages, il était systématiquement mangé par la troncature — donc invisible
                exactement là où on venait le chercher. */}
            {bannerFormats(b).map((f) => (
              <Text key={f} style={styles.rowFormat}>{AD_FORMATS[f].label}</Text>
            ))}
          </View>
          <Text style={styles.rowSub} numberOfLines={1}>{placementSummary(b) || 'Aucun emplacement'}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={on ? COLORS.emerald : COLORS.textSecondary} />
      </TouchableOpacity>
    );
  };

  const listPane = (
    <>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={15} color={COLORS.textSecondary} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Rechercher une bannière"
          placeholderTextColor={COLORS.textSecondary}
        />
        {!!search && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Effacer la recherche">
            <Ionicons name="close-circle" size={16} color={COLORS.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filtre par FORMAT — « montre-moi mes carrées » avant de vendre un espace carré. */}
      <View style={styles.filterRow}>
        {([['all', 'Toutes'], ...(Object.keys(AD_FORMATS) as AdFormat[]).map((f) => [f, AD_FORMATS[f].label] as const)] as [string, string][]).map(([val, lbl]) => {
          const on = formatFilter === val;
          return (
            <TouchableOpacity
              key={val}
              style={[styles.filterChip, on && styles.filterChipOn]}
              onPress={() => setFormatFilter(val as AdFormat | 'all')}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.filterChipText, on && styles.filterChipTextOn]}>{lbl}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity style={styles.addBtn} onPress={add} accessibilityRole="button">
        <Ionicons name="add" size={16} color={COLORS.emerald} /><Text style={styles.addText}>Ajouter une bannière</Text>
      </TouchableOpacity>

      {visible.length === 0
        ? (
          <Text style={styles.emptyList}>
            {banners.length === 0
              ? 'Aucune bannière pour l’instant.'
              : 'Aucune bannière ne correspond à cette recherche.'}
          </Text>
        )
        : visible.map(renderRow)}
    </>
  );

  const renderBannersTab = () => {
    /* BUREAU : liste à gauche, éditeur à droite — on change de bannière sans perdre sa place.
       MOBILE : une chose à la fois, la liste puis l'éditeur, avec un retour explicite. */
    if (isDesktop) {
      return (
        <View style={styles.split}>
          <View style={styles.listPane}>{listPane}</View>
          <View style={styles.detailPane}>
            {selected
              ? renderEditor(selected, selectedIdx)
              : <View style={styles.card}><Text style={styles.emptyDetail}>Choisis une bannière dans la liste pour la modifier, ou ajoutes-en une.</Text></View>}
          </View>
        </View>
      );
    }
    if (selected) {
      return (
        <>
          <TouchableOpacity style={styles.backToList} onPress={() => setSelectedId(null)} accessibilityRole="button">
            <Ionicons name="chevron-back" size={16} color={COLORS.emerald} />
            <Text style={styles.backToListText}>Toutes les bannières ({banners.length})</Text>
          </TouchableOpacity>
          {renderEditor(selected, selectedIdx)}
        </>
      );
    }
    return listPane;
  };

  /* ── RÉGLAGES GLOBAUX ──────────────────────────────────────────────────────────────────────
     Ils ne concernent aucune bannière en particulier : les laisser en tête de la liste obligeait
     à les traverser à chaque fois qu'on venait modifier une bannière. */
  const renderSettingsTab = () => (
    <>
      {/* Formats — ENGENDRÉS depuis AD_FORMATS et AD_PLACEMENTS. Cette carte était écrite à la
          main : elle décrivait deux formats sur trois et nommait les emplacements en toutes
          lettres, donc elle devenait fausse à chaque emplacement ajouté. */}
      <View style={styles.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Ionicons name="resize-outline" size={18} color={COLORS.emerald} />
          <Text style={styles.cardTitle}>Formats des bannières</Text>
        </View>
        {(Object.keys(AD_FORMATS) as AdFormat[]).map((f) => (
          <View key={f} style={styles.formatRow}>
            <Text style={styles.formatBadge}>{AD_FORMATS[f].label}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.formatLine}>
                {AD_FORMATS[f].hint} → image idéale <Text style={styles.formatBold}>{AD_FORMATS[f].ideal}</Text>
              </Text>
              <Text style={styles.formatWhere}>
                {AD_PLACEMENTS.filter((p) => p.format === f).map((p) => `${p.group} · ${p.label}`).join('  ·  ')}
              </Text>
            </View>
          </View>
        ))}
        <Text style={styles.hintInline}>
          L'image remplit toute la zone et est recadrée au centre (« cover ») : gardez le sujet et le texte
          au milieu, et évitez les détails collés aux bords. PNG, JPEG ou WebP. Sans image, c'est le texte
          de la bannière qui s'affiche.
        </Text>
      </View>

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
        <Text style={styles.hintInline}>Plusieurs bannières sur un même emplacement défilent en fondu (rotation).</Text>
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
    </>
  );

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Publicités" onBack={goBack} />
        <Text style={styles.sub}>Affichées dans les zones de pub si le flag « Publicités » est activé (et masquées pour les Premium).</Text>

        <PageTabs
          options={[{ value: 'banners', label: `Bannières (${banners.length})` }, { value: 'settings', label: 'Réglages' }]}
          value={tab}
          onChange={(v) => setTab(v)}
          style={{ marginBottom: 12 }}
        />

        <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
          {tab === 'banners' ? renderBannersTab() : renderSettingsTab()}

          {/* « Enregistrer » écrit la config ENTIÈRE (bannières + réglages) : il reste donc visible
              dans les deux onglets — sans quoi on croirait devoir enregistrer onglet par onglet. */}
          <TouchableOpacity style={[styles.saveBtn, save.isPending && { opacity: 0.6 }]} onPress={persist} disabled={save.isPending}>
            {save.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveLabel}>Enregistrer</Text>}
          </TouchableOpacity>
          {/* Trois tons, pas deux : un « téléversée, mais le format ne correspond pas » s'affichait
              en VERT comme une réussite franche — donc personne ne le lisait. */}
          {msg && (
            <Text style={[styles.msg, {
              color: msg.includes('Erreur') || msg.includes('Échec') ? COLORS.danger
                : msg.includes('ne correspond pas') ? COLORS.orange
                : COLORS.emerald,
            }]}>{msg}</Text>
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
    linkTypeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    linkTypeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingVertical: 8 },
    linkTypeText: { fontSize: 12, color: c.text, fontWeight: '700' },
    formatLine: { fontSize: 12, color: c.textSecondary, lineHeight: 18, marginTop: 4 },
    formatBold: { fontWeight: '800', color: c.text },
    /* Carte « Formats » : une ligne par format, avec la pastille du nom à gauche et, en dessous,
       les emplacements que ce format couvre — la liste est engendrée, elle ne peut plus mentir. */
    formatRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 10 },
    formatBadge: {
      fontSize: 10.5, fontWeight: '800', color: c.emerald, textTransform: 'uppercase', letterSpacing: 0.4,
      borderWidth: 1, borderColor: c.emerald + '55', backgroundColor: c.emerald + '14',
      borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, overflow: 'hidden',
    },
    formatWhere: { fontSize: 11, color: c.textSecondary, opacity: 0.85, lineHeight: 16, marginTop: 3 },
    /* Rappel du format ATTENDU, dans l'éditeur, juste au-dessus du champ image. */
    formatNeeds: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
    formatNeedChip: {
      flexDirection: 'row', alignItems: 'baseline', gap: 6,
      borderWidth: 1, borderColor: c.cardBorder, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    },
    formatNeedLabel: { fontSize: 11, fontWeight: '800', color: c.text },
    formatNeedIdeal: { fontSize: 10.5, color: c.textSecondary },

    /* ── Liste maître / détail ──────────────────────────────────────────────────────────────── */
    searchBox: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: Platform.OS === 'web' ? 9 : 7, marginBottom: 8,
    },
    searchInput: { flex: 1, minWidth: 0, color: c.text, fontSize: 13, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
    filterChip: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
    filterChipOn: { borderColor: c.emerald, backgroundColor: c.emerald + '1F' },
    filterChipText: { fontSize: 11.5, fontWeight: '600', color: c.textSecondary },
    filterChipTextOn: { color: c.emerald, fontWeight: '800' },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
      paddingHorizontal: 10, paddingVertical: 9, marginBottom: 8,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
    },
    rowActive: { borderColor: c.emerald, backgroundColor: c.emerald + '12' },
    rowHidden: { opacity: 0.55 },
    thumb: { width: 46, height: 34, borderRadius: 6, backgroundColor: c.bg },
    thumbEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.cardBorder },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    rowTitle: { flexShrink: 1, fontSize: 13.5, fontWeight: '700', color: c.text },
    /* `flexShrink: 0` : la pastille de format ne se comprime jamais — c'est le TITRE qui se tronque
       (il est le seul à porter `flexShrink: 1`). */
    rowFormat: {
      flexShrink: 0, fontSize: 9.5, fontWeight: '800', color: c.textSecondary,
      textTransform: 'uppercase', letterSpacing: 0.3,
      borderWidth: 1, borderColor: c.cardBorder, borderRadius: 5,
      paddingHorizontal: 5, paddingVertical: 1.5, overflow: 'hidden',
    },
    rowSub: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
    /* Avertissement non bloquant (format mixte) : orange, pas rouge — rien n'est cassé. */
    warn: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8,
      borderWidth: 1, borderColor: c.orange + '55', backgroundColor: c.orange + '14',
      borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
    },
    warnText: { flex: 1, fontSize: 11.5, color: c.text, lineHeight: 16 },
    emptyList: { fontSize: 12.5, color: c.textSecondary, textAlign: 'center', paddingVertical: 22 },
    emptyDetail: { fontSize: 12.5, color: c.textSecondary, textAlign: 'center', paddingVertical: 28, lineHeight: 18 },
    /* Bureau : deux colonnes. La liste garde une largeur FIXE — sinon elle s'étire avec la fenêtre
       et l'éditeur, lui, se retrouve à l'étroit. */
    split: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
    listPane: { width: 330 },
    detailPane: { flex: 1, minWidth: 0 },
    backToList: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, marginBottom: 2, alignSelf: 'flex-start', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    backToListText: { fontSize: 13, fontWeight: '700', color: c.emerald },
    hintInline: { fontSize: 11, color: c.textSecondary, marginTop: 6, fontStyle: 'italic' },
    addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginBottom: 8 },
    addText: { color: c.emerald, fontWeight: '700', fontSize: 13 },
    saveBtn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    saveLabel: { color: c.onAccent, fontWeight: '700', fontSize: 15 },
    msg: { textAlign: 'center', marginTop: 10, fontWeight: '600' },
  });
}
