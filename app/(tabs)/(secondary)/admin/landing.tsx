/**
 * Admin — Page d'accueil (landing desktop). Édite app_config.landing : textes, images,
 * menu, fonctionnalités, statistiques, CTA et pied de page. Téléversement d'images vers
 * le bucket public « gamification » (préfixe landing/).
 */
import React, { useMemo, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Switch, Platform, Image } from 'react-native';
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
import { useLandingConfig, useSaveLandingConfig, type LandingConfig, type LandingFeature, type LandingStat, type LandingLink, type LandingSocial } from '../../../../hooks/config/useLandingConfig';
import SocialLinks from '../../../../components/marketing/SocialLinks';

/**
 * RÉSEAUX PRÊTS À L'EMPLOI — un tap ajoute la ligne, il ne reste que l'URL à coller.
 * `icon` est un nom Ionicons : ceux qui n'en ont pas (X, Threads, Mastodon, BlueSky…) prennent un
 * repli générique et se personnalisent en téléversant une image.
 */
const SOCIAL_PRESETS: { label: string; icon: string }[] = [
  { label: 'Instagram', icon: 'logo-instagram' },
  { label: 'Facebook', icon: 'logo-facebook' },
  { label: 'LinkedIn', icon: 'logo-linkedin' },
  { label: 'YouTube', icon: 'logo-youtube' },
  { label: 'TikTok', icon: 'logo-tiktok' },
  { label: 'X (Twitter)', icon: 'logo-twitter' },
  { label: 'Pinterest', icon: 'logo-pinterest' },
  { label: 'Discord', icon: 'logo-discord' },
  { label: 'WhatsApp', icon: 'logo-whatsapp' },
  { label: 'Reddit', icon: 'logo-reddit' },
  { label: 'Site web', icon: 'globe-outline' },
  { label: 'E-mail', icon: 'mail-outline' },
];

export default function AdminLanding() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const goBack = useNavBack();
  const { data: loaded } = useLandingConfig();
  const save = useSaveLandingConfig();

  const [cfg, setCfg] = useState<LandingConfig | null>(null);
  const [uploading, setUploading] = useState(false);
  /* Le retour d'action portait sa TONALITÉ dans son texte : la couleur se décidait par
     `msg.includes('Erreur')`. Un refus de Supabase qui ne contient pas ce mot — « new row violates
     row-level security policy », « Failed to fetch », et désormais tout refus lié aux droits
     administrateur (migration 204) — s'affichait donc en VERT, comme un enregistrement réussi :
     l'admin repartait convaincu d'avoir publié sa page d'accueil. On sépare le fond de la forme. */
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [tab, setTab] = useState<'bureau' | 'mobile'>('bureau');
  // Réseaux sociaux : section repliée par défaut, et un seul réseau ouvert à la fois — sinon le
  // bloc occupe toute la page alors qu'on n'y touche qu'une fois.
  const [socialsOpen, setSocialsOpen] = useState(false);
  const [openSocial, setOpenSocial] = useState<number | null>(null);

  useEffect(() => { if (loaded && !cfg) setCfg(loaded); }, [loaded]);

  if (!cfg) {
    return <View style={styles.root}><ScreenGradient /><SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}><ScreenHeader title="Page d'accueil" onBack={goBack} /><ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} /></SafeAreaView></View>;
  }

  const set = (patch: Partial<LandingConfig>) => setCfg({ ...cfg, ...patch });
  const setFeature = (i: number, patch: Partial<LandingFeature>) => set({ features: cfg.features.map((f, idx) => idx === i ? { ...f, ...patch } : f) });
  const setMobileFeature = (i: number, patch: Partial<LandingFeature>) => set({ mobileFeatures: cfg.mobileFeatures.map((f, idx) => idx === i ? { ...f, ...patch } : f) });
  const setStat = (i: number, patch: Partial<LandingStat>) => set({ stats: cfg.stats.map((s, idx) => idx === i ? { ...s, ...patch } : s) });
  const setFooter = (i: number, patch: Partial<LandingLink>) => set({ footerLinks: cfg.footerLinks.map((l, idx) => idx === i ? { ...l, ...patch } : l) });

  /** Choisit un fichier et le téléverse dans le bucket public, puis renvoie son URL à `onDone`.
   *  Partagé par le visuel du héros et les icônes de réseaux (mêmes contraintes, même bucket). */
  function pickAndUpload(onDone: (url: string) => void, accept = 'image/png,image/jpeg,image/webp,image/svg+xml') {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !supabase) { setMsg({ text: 'Téléversement possible depuis la version web uniquement.', ok: false }); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
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
        onDone(data.publicUrl);
        setMsg({ text: 'Image téléversée. Pense à enregistrer la page.', ok: true });
      } catch (e: unknown) { setMsg({ text: e instanceof Error ? e.message : 'Téléversement impossible.', ok: false }); }
      finally { setUploading(false); }
    };
    input.click();
  }

  const uploadHero = () => pickAndUpload((url) => set({ heroImage: url }));

  /* ── Réseaux sociaux ─────────────────────────────────────────────────────────────────────── */
  const socials = cfg.socials;
  const setSocials = (patch: Partial<LandingConfig['socials']>) => set({ socials: { ...socials, ...patch } });
  const setSocial = (i: number, patch: Partial<LandingSocial>) =>
    setSocials({ items: socials.items.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  const removeSocial = (i: number) => setSocials({ items: socials.items.filter((_, idx) => idx !== i) });
  /** Déplace une entrée d'un cran : l'ordre du tableau EST l'ordre d'affichage. */
  const moveSocial = (i: number, delta: number) => {
    const next = [...socials.items];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setSocials({ items: next });
  };
  const addSocial = (preset?: { label: string; icon: string }) => {
    setSocials({ items: [...socials.items, { label: preset?.label ?? '', url: '', icon: preset?.icon ?? 'globe-outline' }] });
    setOpenSocial(socials.items.length); // le nouveau réseau s'ouvre : il ne manque que son lien
  };

  async function persist() {
    setMsg(null);
    try { await save.mutateAsync(cfg!); setMsg({ text: 'Enregistré ✓', ok: true }); }
    catch (e: unknown) { setMsg({ text: e instanceof Error ? e.message : "L'enregistrement a échoué.", ok: false }); }
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Page d'accueil" onBack={goBack} />
        <Text style={styles.sub}>Deux présentations : « Bureau » (web grand écran) et « Mobile » (écran d'accueil de l'app). Les boutons mènent aux pages de connexion / inscription.</Text>

        {/* Onglets Bureau / Mobile → évite une page interminable. */}
        <View style={styles.tabsRow}>
          {([['bureau', 'Bureau', 'desktop-outline'], ['mobile', 'Mobile', 'phone-portrait-outline']] as const).map(([id, label, icon]) => (
            <TouchableOpacity key={id} style={[styles.tabBtn, tab === id && styles.tabBtnActive]} onPress={() => setTab(id)} activeOpacity={0.8}>
              <Ionicons name={icon as any} size={16} color={tab === id ? COLORS.bg : COLORS.textSecondary} />
              <Text style={[styles.tabBtnText, tab === id && { color: COLORS.bg }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
          {/* Application mobile — commun aux deux présentations (badge « Google Play » sur l'accueil). */}
          <View style={styles.card}>
            <Text style={styles.section}>Application mobile (Google Play)</Text>
            <Text style={styles.hint}>Lien vers la fiche de l'app sur le Play Store (Android). Un badge « Disponible sur Google Play » apparaît sur la page d'accueil (bureau + mobile web). Laisser vide pour le masquer.</Text>
            <Field label="Lien Google Play" value={cfg.androidStoreUrl ?? ''} onChange={(v) => set({ androidStoreUrl: v })} styles={styles} c={COLORS} />
          </View>

          {/* ── RÉSEAUX SOCIAUX — commun aux deux présentations ────────────────────────────────
              Pied de page de la landing bureau, et bas de l'écran d'accueil mobile (à côté du
              badge Google Play en web mobile, seuls dans l'app native). */}
          <View style={styles.card}>
            {/* Section REPLIÉE par défaut : ouverte en permanence, elle occupait la moitié de la
                page alors qu'on n'y touche qu'une fois. Le résumé (nombre de réseaux) suffit. */}
            <TouchableOpacity style={styles.rowBetween} onPress={() => setSocialsOpen((v) => !v)} activeOpacity={0.7}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name={socialsOpen ? 'chevron-down' : 'chevron-forward'} size={17} color={COLORS.textSecondary} />
                <Text style={styles.section}>Réseaux sociaux</Text>
                <Text style={styles.countTag}>
                  {socials.items.length === 0 ? 'aucun' : `${socials.items.length} réseau${socials.items.length > 1 ? 'x' : ''}`}
                </Text>
              </View>
              <Switch value={socials.enabled} onValueChange={(v) => setSocials({ enabled: v })} />
            </TouchableOpacity>

            {socialsOpen && (<>
            <Text style={styles.hint}>
              S'affichent dans le pied de page (web bureau) et en bas de l'écran d'accueil mobile.
              L'ordre de la liste est l'ordre d'affichage. Une entrée sans lien n'est pas affichée.
            </Text>

            {/* Aperçu réel : même composant que le site, avec les réglages en cours. */}
            <Text style={styles.fieldLabel}>Aperçu</Text>
            <View style={styles.preview}>
              {socials.items.some((s) => (s.url ?? '').trim())
                ? <SocialLinks config={socials} color={COLORS.text} />
                : <Text style={styles.hint}>Ajoute un réseau et son lien pour voir l'aperçu.</Text>}
            </View>

            {/* Taille */}
            <Text style={styles.fieldLabel}>Taille de l'icône — {socials.size} pt</Text>
            <View style={styles.themeRow}>
              {[16, 20, 22, 26, 32].map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.themeBtn, socials.size === s && styles.themeBtnActive]}
                  onPress={() => setSocials({ size: s })}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.themeBtnText, socials.size === s && { color: '#fff' }]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Habillage */}
            <Text style={styles.fieldLabel}>Habillage</Text>
            <View style={styles.themeRow}>
              {([
                { id: 'plain' as const, label: 'Icône seule' },
                { id: 'circle' as const, label: 'Cercle' },
                { id: 'square' as const, label: 'Carré' },
              ]).map((o) => (
                <TouchableOpacity
                  key={o.id}
                  style={[styles.themeBtn, socials.shape === o.id && styles.themeBtnActive]}
                  onPress={() => setSocials({ shape: o.id })}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.themeBtnText, socials.shape === o.id && { color: '#fff' }]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Positionnement — bureau uniquement (le mobile est toujours centré, sous le badge). */}
            <Text style={styles.fieldLabel}>Alignement dans le pied de page (bureau)</Text>
            <View style={styles.themeRow}>
              {([
                { id: 'left' as const, label: 'Gauche' },
                { id: 'center' as const, label: 'Centre' },
                { id: 'right' as const, label: 'Droite' },
              ]).map((o) => (
                <TouchableOpacity
                  key={o.id}
                  style={[styles.themeBtn, socials.align === o.id && styles.themeBtnActive]}
                  onPress={() => setSocials({ align: o.id })}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.themeBtnText, socials.align === o.id && { color: '#fff' }]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Position par rapport aux liens du pied de page</Text>
            <View style={styles.themeRow}>
              {([
                { id: 'above' as const, label: 'Au-dessus' },
                { id: 'below' as const, label: 'En dessous' },
              ]).map((o) => (
                <TouchableOpacity
                  key={o.id}
                  style={[styles.themeBtn, socials.position === o.id && styles.themeBtnActive]}
                  onPress={() => setSocials({ position: o.id })}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.themeBtnText, socials.position === o.id && { color: '#fff' }]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Ajout rapide : un tap pose la ligne avec le bon logo, il ne reste que l'URL. */}
            <Text style={styles.fieldLabel}>Ajouter un réseau</Text>
            <View style={styles.presetRow}>
              {SOCIAL_PRESETS.map((p) => (
                <TouchableOpacity key={p.label} style={styles.presetChip} onPress={() => addSocial(p)} activeOpacity={0.8}>
                  <Ionicons name={p.icon as any} size={15} color={COLORS.emerald} />
                  <Text style={styles.presetTxt}>{p.label}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.presetChip} onPress={() => addSocial()} activeOpacity={0.8}>
                <Ionicons name="add" size={15} color={COLORS.emerald} />
                <Text style={styles.presetTxt}>Autre</Text>
              </TouchableOpacity>
            </View>

            {/* Chaque réseau est REPLIÉ : déplié, cinq champs × N réseaux remplissaient la page.
                La ligne fermée montre l'essentiel (icône, nom, lien) et garde ordre + suppression
                accessibles sans avoir à ouvrir. */}
            {socials.items.map((s, i) => {
              const isOpen = openSocial === i;
              return (
              <View key={i} style={styles.subCard}>
                <View style={styles.rowBetween}>
                  <TouchableOpacity
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}
                    onPress={() => setOpenSocial(isOpen ? null : i)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={15} color={COLORS.textSecondary} />
                    {s.image
                      ? <Image source={{ uri: s.image }} style={{ width: 18, height: 18 }} resizeMode="contain" />
                      : <Ionicons name={(s.icon || 'globe-outline') as any} size={18} color={COLORS.text} />}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{s.label || `Réseau ${i + 1}`}</Text>
                      {!isOpen && (
                        <Text style={styles.itemSub} numberOfLines={1}>{s.url?.trim() || 'lien manquant'}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Monter le réseau social" onPress={() => moveSocial(i, -1)} disabled={i === 0}>
                      <Ionicons name="arrow-up" size={17} color={i === 0 ? COLORS.cardBorder : COLORS.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Descendre le réseau social" onPress={() => moveSocial(i, 1)} disabled={i === socials.items.length - 1}>
                      <Ionicons name="arrow-down" size={17} color={i === socials.items.length - 1 ? COLORS.cardBorder : COLORS.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Supprimer le réseau social" onPress={() => removeSocial(i)}>
                      <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
                {isOpen && (<>
                  <Field label="Nom (lu par les lecteurs d'écran)" value={s.label} onChange={(v) => setSocial(i, { label: v })} styles={styles} c={COLORS} />
                  <Field label="Lien (https://… ou mailto:…)" value={s.url} onChange={(v) => setSocial(i, { url: v })} styles={styles} c={COLORS} />
                  <Field label="Icône (nom Ionicons)" value={s.icon} onChange={(v) => setSocial(i, { icon: v })} styles={styles} c={COLORS} />
                  <Text style={styles.fieldLabel}>Ou téléverser une image (prioritaire sur l'icône)</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={s.image ?? ''}
                      onChangeText={(v) => setSocial(i, { image: v })}
                      placeholder="URL image (PNG/SVG)"
                      placeholderTextColor={COLORS.textSecondary}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Téléverser l'image du réseau social" style={styles.uploadBtn} onPress={() => pickAndUpload((url) => setSocial(i, { image: url }))} disabled={uploading}>
                      {uploading ? <ActivityIndicator size="small" color={COLORS.emerald} /> : <Ionicons name="cloud-upload-outline" size={18} color={COLORS.emerald} />}
                    </TouchableOpacity>
                    {!!s.image && (
                      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retirer l'image du réseau social" style={styles.uploadBtn} onPress={() => setSocial(i, { image: '' })}>
                        <Ionicons name="close" size={18} color={COLORS.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                </>)}
              </View>
              );
            })}
            <Text style={styles.hint}>
              X, Threads, Mastodon, BlueSky… n'ont pas de logo dans Ionicons : téléverse une image
              (fond transparent) pour ceux-là.
            </Text>
            </>)}
          </View>

          {tab === 'bureau' && (<>
          {/* Général */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.section}>Activer la landing desktop</Text>
              <Switch value={cfg.enabled} onValueChange={(v) => set({ enabled: v })} />
            </View>

            {/* Thème de la page d'accueil — sombre (actuel) ou clair (même accent émeraude) */}
            <Text style={styles.fieldLabel}>Thème de la page</Text>
            <View style={styles.themeRow}>
              {([
                { id: 'dark' as const, label: 'Sombre', icon: 'moon-outline' },
                { id: 'light' as const, label: 'Clair', icon: 'sunny-outline' },
              ]).map((t) => {
                const active = (cfg.theme ?? 'dark') === t.id;
                return (
                  <TouchableOpacity key={t.id} style={[styles.themeBtn, active && styles.themeBtnActive]} onPress={() => set({ theme: t.id })} activeOpacity={0.85}>
                    <Ionicons name={t.icon as any} size={16} color={active ? '#fff' : COLORS.textSecondary} />
                    <Text style={[styles.themeBtnText, active && { color: '#fff' }]}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
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
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Téléverser l'image d'en-tête" style={styles.uploadBtn} onPress={uploadHero} disabled={uploading}>
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
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Supprimer la fonctionnalité" onPress={() => set({ features: cfg.features.filter((_, idx) => idx !== i) })}><Ionicons name="trash-outline" size={18} color={COLORS.danger} /></TouchableOpacity>
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
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Supprimer la statistique" onPress={() => set({ stats: cfg.stats.filter((_, idx) => idx !== i) })}><Ionicons name="trash-outline" size={18} color={COLORS.danger} /></TouchableOpacity>
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
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Supprimer le lien de pied de page" onPress={() => set({ footerLinks: cfg.footerLinks.filter((_, idx) => idx !== i) })}><Ionicons name="trash-outline" size={18} color={COLORS.danger} /></TouchableOpacity>
              </View>
            ))}
            <Text style={styles.hint}>Ancres : confidentialite, legal (pages publiques), login, register, features, stats, final — ou une URL https://…</Text>
          </View>

          </>)}

          {tab === 'mobile' && (
          /* ── Écran d'accueil MOBILE (application) — textes propres au mobile ── */
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.section}>Accueil mobile (application)</Text>
              <TouchableOpacity onPress={() => set({ mobileFeatures: [...cfg.mobileFeatures, { icon: 'sparkles', title: 'Titre', text: '' }] })} style={styles.addBtn}><Ionicons name="add" size={16} color={COLORS.emerald} /><Text style={styles.addText}>Ajouter</Text></TouchableOpacity>
            </View>
            <Text style={styles.hint}>Ces textes s'affichent sur l'écran d'accueil de l'app mobile (le nom de la marque et le logo sont communs). Le badge/héros ci-dessus concernent la version web bureau.</Text>
            <Field label="Accroche (sous le nom)" value={cfg.mobileTagline} onChange={(v) => set({ mobileTagline: v })} multiline styles={styles} c={COLORS} />
            <Field label="Sous-accroche" value={cfg.mobileSubtag} onChange={(v) => set({ mobileSubtag: v })} styles={styles} c={COLORS} />
            <Field label="Titre de la carte d'action" value={cfg.mobileCtaTitle} onChange={(v) => set({ mobileCtaTitle: v })} styles={styles} c={COLORS} />
            <Field label="Texte de la carte d'action" value={cfg.mobileCtaText} onChange={(v) => set({ mobileCtaText: v })} multiline styles={styles} c={COLORS} />
            <Field label="Bouton principal" value={cfg.mobileCtaPrimaryLabel} onChange={(v) => set({ mobileCtaPrimaryLabel: v })} styles={styles} c={COLORS} />
            <Field label="Bouton secondaire" value={cfg.mobileCtaSecondaryLabel} onChange={(v) => set({ mobileCtaSecondaryLabel: v })} styles={styles} c={COLORS} />
            <Text style={[styles.section, { fontSize: 13, marginTop: 8 }]}>Fonctionnalités mises en avant</Text>
            {cfg.mobileFeatures.map((f, i) => (
              <View key={i} style={styles.subCard}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>Fonctionnalité {i + 1}</Text>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Supprimer la fonctionnalité mobile" onPress={() => set({ mobileFeatures: cfg.mobileFeatures.filter((_, idx) => idx !== i) })}><Ionicons name="trash-outline" size={18} color={COLORS.danger} /></TouchableOpacity>
                </View>
                <Field label="Icône (Ionicons)" value={f.icon} onChange={(v) => setMobileFeature(i, { icon: v })} styles={styles} c={COLORS} />
                <Field label="Titre" value={f.title} onChange={(v) => setMobileFeature(i, { title: v })} styles={styles} c={COLORS} />
                <Field label="Texte" value={f.text} onChange={(v) => setMobileFeature(i, { text: v })} multiline styles={styles} c={COLORS} />
              </View>
            ))}
          </View>
          )}

          <TouchableOpacity style={[styles.saveBtn, save.isPending && { opacity: 0.6 }]} onPress={persist} disabled={save.isPending}>
            {save.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveLabel}>Enregistrer la page d'accueil</Text>}
          </TouchableOpacity>
          {msg && <Text style={[styles.msg, { color: msg.ok ? COLORS.emerald : COLORS.danger }]}>{msg.text}</Text>}
        </KeyboardAwareScrollView>
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
    sub: { fontSize: 12, color: c.textSecondary, marginBottom: 12, lineHeight: 16 },
    tabsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card },
    tabBtnActive: { backgroundColor: c.emerald, borderColor: c.emerald },
    tabBtnText: { fontSize: 13.5, fontWeight: '700', color: c.textSecondary },
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
    themeRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
    themeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bg },
    themeBtnActive: { backgroundColor: c.emerald, borderColor: c.emerald },
    themeBtnText: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
    preview: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center' },
    countTag: { fontSize: 11, fontWeight: '700', color: c.textSecondary, backgroundColor: c.bg, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8, overflow: 'hidden' },
    itemSub: { fontSize: 11, color: c.textSecondary, marginTop: 1 },
    presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 4 },
    presetChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10 },
    presetTxt: { fontSize: 12, fontWeight: '600', color: c.text },
    saveBtn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    saveLabel: { color: '#fff', fontWeight: '700', fontSize: 15 },
    msg: { textAlign: 'center', marginTop: 10, fontWeight: '600' },
  });
}
