/**
 * Apparence — mode d'affichage (admin) + couleur d'accent. Déplacé depuis Paramètres.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { withDeferredMount } from '../../../hooks/platform/useDeferredMount';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Image, ActivityIndicator } from 'react-native';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import KeyboardAwareScrollView from '../../../components/layout/KeyboardAwareScrollView';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../../hooks/data/useProfile';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { useGamification } from '../../../hooks/engagement/useGamification';
import { usePlan } from '../../../hooks/config/usePlan';
import { useCosmetics } from '../../../hooks/theme/useCosmetics';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useLocalSearchParams } from 'expo-router';
import { COSMETIC_DEFS, SHOP_CATEGORY_LABELS, isImageIcon } from '../../../lib/engagement/gamification';
import { safeInternalRoute } from '../../../lib/ui/navHistory';
import { THEME_MODES, THEME_PRESETS, NATIVE_PRESET_IDS, resolveAccent, readableOn, type ThemeMode, type ThemePreset } from '../../../theme/palette';
import { shouldResetCustomAccent } from '../../../theme/accentRules';
import { useStyleConfig, orderPresetIds } from '../../../hooks/theme/useStyleConfig';
import ColorPickerModal from '../../../components/ui/ColorPickerModal';

export default withDeferredMount(AppearanceScreen);
function AppearanceScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const { user, isImpersonating } = useAuth();
  const queryClient = useQueryClient();
  /* Retour EXPLICITE quand l'écran a été ouvert depuis un endroit précis (« Consulter mes achats »
     dans la boutique) : l'historique générique dépilait vers une autre page. L'appelant dit d'où il
     vient, on y retourne — et à défaut on retombe sur le comportement habituel.
     La destination est FILTRÉE (cf. safeInternalRoute) : sur le web elle vient de l'URL, donc de
     n'importe qui — un `?origin=` pointant à l'extérieur ferait sortir de l'app au clic sur Retour. */
  const { origin } = useLocalSearchParams<{ origin?: string }>();
  const backTo = safeInternalRoute(origin);
  const navBack = useNavBack();
  const goBack = () => { if (backTo) router.navigate(backTo as any); else navBack(); };
  const { data: profile, isSuccess: profileLoaded } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);
  const currentMode = (profile?.theme_mode ?? 'dark') as ThemeMode;
  const currentPreset = (profile?.theme_preset ?? 'emerald') as ThemePreset;

  /* ── « CONNECTÉ EN TANT QUE » : ON REGARDE, ON NE TOUCHE PAS ───────────────────────────────
     La politique d'accès autorise un administrateur à écrire sur n'importe quel profil (pour le
     support). Ici, ça voulait dire qu'un simple coup d'œil à l'Apparence d'un compte visité
     changeait POUR DE BON son thème dès qu'on effleurait une pastille — sans confirmation, sans
     trace, et sans que rien à l'écran ne le laisse deviner. On coupe donc toutes les écritures. */
  const readOnly = isImpersonating;

  /* Un enregistrement peut échouer (réseau coupé, refus du serveur). La mise à jour optimiste fait
     alors marche arrière toute seule : la couleur qu'on vient de choisir revient à la précédente,
     sans un mot — on croit à un bug de l'application. On le dit. */
  const [saveError, setSaveError] = useState(false);
  const onSaveError = () => setSaveError(true);

  const { data: styleConfig } = useStyleConfig();
  /* `visible` = ce qu'on propose (hors couleurs masquées par l'administration) ; `every` = tout le
     catalogue, masquées comprises — nécessaire pour retrouver la couleur ACTUELLE d'un utilisateur
     quand elle vient d'être masquée (cf. visiblePresets plus bas). */
  const { visible: allPresets, every: everyPreset } = useMemo(() => {
    const hidden = new Set(styleConfig?.hidden_presets ?? []);
    // La pastille affiche EXACTEMENT la couleur qui sera appliquée pour le mode courant
    // (résolution identique à useAppColors) → plus de décalage liste ↔ appliqué.
    const opts = { customAccents: styleConfig?.custom_accents, extraPresets: styleConfig?.extra_presets };
    const native = THEME_PRESETS.map((p) => ({ id: p.id, label: p.label, swatch: resolveAccent(currentMode, p.id, opts) }));
    const extra = (styleConfig?.extra_presets ?? []).map((p) => ({ id: p.id, label: p.label, swatch: resolveAccent(currentMode, p.id, opts) }));
    const all = [...native, ...extra];
    const ordered = orderPresetIds(all.map((p) => p.id), styleConfig?.preset_order);
    const every = ordered.map((id) => all.find((p) => p.id === id)!).filter(Boolean);
    return { visible: every.filter((p) => !hidden.has(p.id)), every };
  }, [styleConfig, currentMode]);

  /* Le changement est écrit dans le cache AVANT l'appel réseau : toute l'app (entête, onglets,
     cette page) prend la nouvelle couleur à l'instant du clic. L'écriture, elle, part derrière et
     les écritures de profil s'exécutent en file (cf. useUpdateProfile) — donc le DERNIER clic est
     bien le dernier enregistré, même si on essaie cinq couleurs en trois secondes. */
  const applyProfile = (patch: { theme_mode?: ThemeMode; theme_preset?: ThemePreset }) => {
    if (readOnly || !user?.id) return;
    setSaveError(false);
    queryClient.setQueryData(['profile', user.id], (prev: any) => (prev ? { ...prev, ...patch } : prev));
    updateProfile.mutate(patch as any, { onError: onSaveError });
  };
  const setMode = (mode: ThemeMode) => applyProfile({ theme_mode: mode });
  const setPreset = (preset: ThemePreset) => applyProfile({ theme_preset: preset });

  // ── Couleur personnalisée (theme_preset = hex direct) ──
  const isHex = (v: string) => /^#[0-9A-Fa-f]{6}$/.test(v);
  const customActive = isHex(currentPreset);
  const [customHex, setCustomHex] = useState('#00B67A');
  const customValid = isHex(customHex);
  /* LE CHAMP DOIT MONTRER LA COULEUR RÉELLEMENT APPLIQUÉE.
     Il était rempli une seule fois, au tout premier rendu — c'est-à-dire AVANT l'arrivée du profil.
     Quelqu'un dont l'accent est un rouge personnalisé ouvrait donc la page sur « #000000 », avec la
     coche « appliquée » à côté : la page affirmait que son thème était noir. Et un clic distrait sur
     « Appliquer » le rendait vrai. On resynchronise donc à chaque fois que la couleur enregistrée
     change, sauf pendant que l'utilisateur est en train d'en saisir une autre. */
  const touchedRef = useRef(false);
  useEffect(() => {
    if (touchedRef.current) return;
    if (customActive) setCustomHex(currentPreset.toUpperCase());
  }, [currentPreset, customActive]);

  /* Saisie au clavier OU sélecteur de couleur → met seulement à jour l'aperçu.
     L'application se fait UNIQUEMENT via le bouton « Appliquer ».
     La saisie est normalisée : on accepte « ff5733 » comme « #FF5733 » (le dièse est ce qu'on
     oublie le plus souvent) et on ignore les caractères qui ne sont pas hexadécimaux. */
  const onHexChange = (v: string) => {
    touchedRef.current = true;
    const cleaned = v.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6).toUpperCase();
    setCustomHex('#' + cleaned);
  };
  /** La couleur du champ est-elle CELLE qui est appliquée ? (c'est le sens de la coche d'aperçu) */
  const appliedHex = customActive && customValid && currentPreset.toUpperCase() === customHex;
  /** Rien à appliquer si la couleur est invalide, déjà en place, ou si on ne fait que consulter. */
  const canApplyHex = customValid && !appliedHex && !readOnly;
  const applyHex = () => {
    if (!canApplyHex) return;
    touchedRef.current = false; // la couleur du champ devient la couleur appliquée
    setPreset(customHex as ThemePreset);
  };
  const [showColorPicker, setShowColorPicker] = useState(false); // palette HSV (clic sur l'aperçu)

  // Les pastilles de couleur d'accent de base sont GRATUITES pour tout le monde.
  // SEUL le sélecteur de couleur personnalisée (saisie du code hex, sous les pastilles)
  // est réservé aux abonnés Premium.
  const { config: gamiConfig, inventory, inventoryReady, inventoryError, refetchInventory } = useGamification(user?.id);
  const { isPremium, hasEntitlement, isResolved: planResolved } = usePlan(user?.id);
  const colorsUnlocked = isPremium;
  /* Le « Pack couleurs » (les couleurs supplémentaires définies dans l'éditeur de style — leur
     NOMBRE dépend de la configuration, ne jamais l'écrire en dur) s'obtient UNIQUEMENT via un achat
     en boutique, pas avec le Premium (§N10). Tant que l'inventaire n'est pas lu, on ne conclut RIEN. */
  const hasAccentPack = inventory.some((i) => i.item_key === 'accent_pack' && i.qty > 0);

  /* ── PERTE DU PREMIUM : REVENIR AU THÈME PAR DÉFAUT, MAIS SEULEMENT QUAND C'EST VRAI ────────
     Fin d'abonnement = la couleur personnalisée n'est plus due, on remet l'accent par défaut.
     Sauf que ce garde-fou partait sur `isPremium`, qui vaut `false` TANT QUE LES RÉPONSES NE SONT
     PAS ARRIVÉES : le profil venant souvent du cache local, il était là dès la première image alors
     que les réglages d'offre, eux, arrivaient du réseau. Un abonné qui ouvrait Apparence voyait donc
     sa couleur personnalisée EFFACÉE EN BASE, définitivement, avant même que la page ne finisse de
     s'afficher — il devait la ressaisir à chaque passage.
     Trois conditions désormais, toutes nécessaires :
       • `planResolved` : l'offre ET le profil ont réellement répondu (pas une valeur par défaut) ;
       • `hasEntitlement` : c'est bien CE compte qui n'a plus le droit — et non l'offre Premium
         désactivée globalement par l'administration, qui n'a aucune raison d'effacer les réglages
         de tous les abonnés à la fois ;
       • une seule fois par visite, et jamais en consultation d'un autre compte. */
  const resetDoneRef = useRef(false);
  useEffect(() => {
    const must = shouldResetCustomAccent({
      profileLoaded, planResolved, hasEntitlement, preset: currentPreset,
      readOnly, alreadyDone: resetDoneRef.current,
    });
    if (!must) return;
    resetDoneRef.current = true;
    setPreset('emerald');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoaded, planResolved, hasEntitlement, currentPreset, readOnly]);

  // ── Cosmétiques débloqués (inventaire) + équipés ──
  const cosmetics = useCosmetics(user?.id);
  /* Équiper écrit sur le profil : même règle que les couleurs, on ne touche pas au compte visité. */
  const toggleCosmetic = (key: string) => {
    if (readOnly) return;
    setSaveError(false);
    cosmetics.toggle(key);
  };
  const ownedCosmetics = useMemo(() => {
    return cosmetics.ownedKeys.map((key) => {
      const shopItem = gamiConfig?.shop.find((s) => s.key === key);
      const def = COSMETIC_DEFS[key];
      // Couleur d'illustration : pour un cadre/flamme = sa teinte ; pour un titre = doré.
      const color = def && /^#[0-9A-Fa-f]{6}$/.test(def.value) ? def.value : '#f59e0b';
      return {
        key,
        /* Un article retiré du catalogue reste dans l'inventaire : sans repli, la vignette affichait
           son identifiant technique (« cosmetic_frame_blue ») en guise de nom. On retombe sur le
           libellé de l'emplacement, qui décrit au moins ce que c'est. */
        label: shopItem?.label || def?.slotLabel || 'Article',
        description: shopItem?.description ?? '',
        icon: shopItem?.icon ?? 'sparkles',
        slot: def?.slot ?? 'autre',
        slotLabel: def?.slotLabel ?? '',
        color,
        equipped: cosmetics.isEquipped(key),
      };
    });
  }, [cosmetics.ownedKeys, cosmetics.equipped, gamiConfig]);

  /* DEUX FAMILLES, comme en boutique. Cadres et flammes se portent ensemble : ils partagent la même
     palette et s'assortissent deux à deux (cf. COSMETIC_PALETTE). Un titre, lui, ne s'assortit à
     rien — c'est du texte sous un pseudo, et la boutique le vend dans son propre rayon
     (SHOP_CATEGORY_LABELS.titres). Les mélanger ici obligeait à retrouver, dans une seule liste,
     l'objet qu'on venait d'acheter dans un rayon distinct. */
  const bySlot = (slot: string) =>
    ownedCosmetics.filter((c) => c.slot === slot).sort((a, b) => a.label.localeCompare(b.label, 'fr'));

  const cosmeticGroups = useMemo(() => ([
    { slot: 'avatar_frame', label: "Cadres d'avatar", items: bySlot('avatar_frame') },
    { slot: 'streak_flame', label: 'Flammes de série', items: bySlot('streak_flame') },
  ].filter((g) => g.items.length > 0)), [ownedCosmetics]);

  const titleItems = useMemo(() => bySlot('title'), [ownedCosmetics]);
  // Les couleurs de base (celles de la palette native) sont gratuites pour tous.
  // Les couleurs supplémentaires créées dans l'éditeur de style forment le « Pack couleurs ».
  const nativePresets = allPresets.filter((p) => NATIVE_PRESET_IDS.includes(p.id));
  const packPresets = allPresets.filter((p) => !NATIVE_PRESET_IDS.includes(p.id));

  /* ── LA COULEUR ACTIVE DOIT TOUJOURS ÊTRE VISIBLE ────────────────────────────────────────────
     Les pastilles affichées sont filtrées (couleurs masquées par l'administration, couleurs du pack
     réservées à ceux qui l'ont acheté). Quand la couleur en cours d'usage tombe dans un de ces cas
     — l'administration masque une couleur déjà choisie par des utilisateurs — la liste ne montrait
     AUCUNE sélection : l'app était dans une couleur qu'on ne trouvait nulle part, et il fallait en
     choisir une autre au hasard pour comprendre. On la remet donc dans la liste, à sa place. */
  const visiblePresets = useMemo(() => {
    const base = hasAccentPack ? allPresets : nativePresets;
    if (isHex(currentPreset) || base.some((p) => p.id === currentPreset)) return base;
    const missing = everyPreset.find((p) => p.id === currentPreset);
    return missing ? [...base, missing] : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPresets, everyPreset, nativePresets, hasAccentPack, currentPreset]);

  return (
    <View style={styles.root}>
      <StatusBar style={currentMode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'settings')]} edges={[]}>
        <ScreenHeader title="Apparence" onBack={goBack} />

        <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          {/* Consultation d'un autre compte : on le dit AVANT que quiconque touche à quoi que ce
              soit — sinon un clic changerait vraiment le thème de la personne visitée. */}
          {readOnly && (
            <View style={styles.notice}>
              <Ionicons name="eye-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.noticeText}>
                Consultation seule : tu es connecté en tant qu'un autre utilisateur. Rien de ce que
                tu touches ici ne sera modifié sur son compte.
              </Text>
            </View>
          )}

          {/* Inventaire illisible : la page ne peut PAS dire « tu ne possèdes rien » — elle ne le
              sait pas. Elle le dit, et propose de réessayer. */}
          {inventoryError && (
            <TouchableOpacity
              style={[styles.notice, { borderColor: COLORS.danger }]}
              onPress={refetchInventory}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <Ionicons name="refresh-outline" size={16} color={COLORS.danger} />
              <Text style={[styles.noticeText, { color: COLORS.danger }]}>
                Tes achats n'ont pas pu être chargés : les couleurs et cosmétiques débloqués ne sont
                pas affichés. Touche ici pour réessayer.
              </Text>
            </TouchableOpacity>
          )}

          {/* Un réglage qui n'est pas parti doit se voir : sans ça, la couleur revient toute seule
              à la précédente et on croit que l'application « ne marche pas ». */}
          {saveError && (
            <View style={[styles.notice, { borderColor: COLORS.danger }]}>
              <Ionicons name="cloud-offline-outline" size={16} color={COLORS.danger} />
              <Text style={[styles.noticeText, { color: COLORS.danger }]}>
                Ton choix n'a pas pu être enregistré. Vérifie ta connexion, puis réessaie.
              </Text>
            </View>
          )}

          {/* ── LES MÊMES RAYONS QU'EN BOUTIQUE ────────────────────────────────────────────────
              Tout tenait dans une seule carte : mode d'affichage, couleurs, cadres, flammes et
              titres empilés sans hiérarchie. Or la boutique, elle, vend ça en trois rayons
              distincts — on achetait un titre au rayon « Titres de profil » et on devait ensuite
              le chercher au milieu des couleurs. Les libellés sont IMPORTÉS de la boutique
              (SHOP_CATEGORY_LABELS) : les deux écrans ne peuvent plus se contredire. */}
          <Text style={styles.sectionTitle}>{SHOP_CATEGORY_LABELS.apparence}</Text>
          <Text style={styles.sectionIntro}>Le mode d'affichage et la couleur de l'application.</Text>

          <View style={styles.card}>
            {/* Mode d'affichage clair / sombre — accessible à tous les utilisateurs. */}
            <View style={[styles.block, { borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder, paddingBottom: 16, marginBottom: 16 }]}>
              <Text style={styles.label}>Mode d'affichage</Text>
              <View style={styles.segmentRow}>
                {THEME_MODES.map((m) => {
                  const active = currentMode === m.id;
                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={[styles.segment, active && styles.segmentActive, readOnly && styles.disabled]}
                      onPress={() => setMode(m.id)}
                      disabled={readOnly}
                      activeOpacity={0.8}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active, disabled: readOnly }}
                      accessibilityLabel={`Mode ${m.label}`}
                    >
                      <Ionicons name={m.icon as any} size={16} color={active ? COLORS.onAccent : COLORS.textSecondary} />
                      <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.block}>
              <Text style={styles.label}>Couleur d'accent</Text>
              <View style={styles.presetRow}>
                {/* Presets natifs (toujours libres) + presets du pack si débloqué */}
                {visiblePresets.map((p) => {
                  const active = currentPreset === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.presetDot, { backgroundColor: p.swatch }, active && styles.presetDotActive, readOnly && styles.disabled]}
                      onPress={() => setPreset(p.id as ThemePreset)}
                      disabled={readOnly}
                      activeOpacity={0.8}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active, disabled: readOnly }}
                      accessibilityLabel={p.label}
                    >
                      {/* La coche se pose SUR la pastille : sa couleur doit tenir compte de la
                          teinte, sinon elle disparaît sur les couleurs claires (blanc, jaune). */}
                      {active && <Ionicons name="checkmark" size={18} color={readableOn(p.swatch)} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Pack couleurs — extra presets créés dans le Style Editor, achetables en boutique.
                `inventoryReady` : sans lui, la mention « verrouillé » s'affichait une seconde à
                quelqu'un qui a déjà acheté le pack — le temps que l'inventaire arrive. */}
            {inventoryReady && packPresets.length > 0 && !hasAccentPack && (
              <View style={[styles.block, { borderTopWidth: 1, borderTopColor: COLORS.cardBorder, paddingTop: 16, marginTop: 16 }]}>
                <View style={styles.lockRow}>
                  <Text style={styles.label}>Pack couleurs</Text>
                  <Ionicons name="lock-closed" size={15} color={COLORS.textSecondary} />
                </View>
                <Text style={styles.hint}>
                  {packPresets.length} couleur{packPresets.length > 1 ? 's' : ''} supplémentaire
                  {packPresets.length > 1 ? 's' : ''}, disponible{packPresets.length > 1 ? 's' : ''} à la boutique.
                </Text>
                <View style={styles.presetRow}>
                  {packPresets.map((p) => (
                    <View key={p.id} style={[styles.presetDot, { backgroundColor: p.swatch, opacity: 0.35 }]} />
                  ))}
                </View>
                <TouchableOpacity style={styles.unlockBtn} onPress={() => router.push('/(tabs)/(secondary)/boutique' as any)} activeOpacity={0.85} accessibilityRole="button">
                  <Ionicons name="bag-handle-outline" size={16} color={COLORS.onAccent} />
                  <Text style={styles.unlockBtnText}>Voir en boutique</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Couleur personnalisée — réservée aux abonnés Premium */}
            <View style={[styles.block, { borderTopWidth: 1, borderTopColor: COLORS.cardBorder, paddingTop: 16, marginTop: 16 }]}>
              <View style={styles.lockRow}>
                <Text style={styles.label}>Couleur personnalisée</Text>
                {/* Le cadenas non plus ne s'affiche qu'une fois l'abonnement connu. */}
                {!planResolved ? null : colorsUnlocked ? (
                  <View style={styles.premiumBadge}>
                    <Ionicons name="star" size={11} color="#F5B301" />
                  </View>
                ) : (
                  <Ionicons name="lock-closed" size={15} color={COLORS.textSecondary} />
                )}
              </View>

              {/* Tant que l'offre n'a pas répondu, on n'affirme NI l'un NI l'autre : `isPremium`
                  vaut `false` par défaut, et un abonné voyait donc « réservé aux abonnés Premium »
                  avec un bouton « Passer Premium » — sur une offre qu'il paie déjà. */}
              {!planResolved ? (
                <View style={styles.shelfLoading}>
                  <ActivityIndicator size="small" color={COLORS.textSecondary} />
                  <Text style={styles.hint}>Vérification de ton abonnement…</Text>
                </View>
              ) : colorsUnlocked ? (
                <>
                  <Text style={styles.hint}>Choisis ta propre teinte d'accent.</Text>

                  <View style={styles.customRow}>
                    {/* SÉLECTEUR (à gauche) : ouvre la palette HSV/RVB — même modal sur toutes les
                        plateformes (l'ancien <input type="color"> web faisait doublon). */}
                    <TouchableOpacity
                      style={[styles.pickerBtn, readOnly && styles.disabled]}
                      onPress={() => setShowColorPicker(true)}
                      disabled={readOnly}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel="Ouvrir la palette de couleurs"
                    >
                      <Ionicons name="color-palette-outline" size={20} color={COLORS.text} />
                    </TouchableOpacity>
                    <TextInput
                      style={[styles.hexInput, !customValid && { borderColor: COLORS.danger }]}
                      value={customHex}
                      onChangeText={onHexChange}
                      onBlur={() => { if (!customValid) { touchedRef.current = false; setCustomHex(customActive ? currentPreset.toUpperCase() : '#00B67A'); } }}
                      placeholder="#RRGGBB"
                      placeholderTextColor={COLORS.textSecondary}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      editable={!readOnly}
                      maxLength={7}
                      accessibilityLabel="Code couleur hexadécimal"
                    />
                    {/* CARRÉ DE RENDU (à droite) : aperçu de la couleur choisie.
                        La coche ne veut dire qu'UNE chose : « c'est la couleur actuellement
                        appliquée ». Elle s'affichait dès qu'une couleur personnalisée était en
                        place, donc AUSSI pendant qu'on en saisissait une autre — l'aperçu montrait
                        alors une couleur non appliquée, avec la coche à côté. */}
                    <View
                      style={[styles.customPreview, { backgroundColor: customValid ? customHex : COLORS.cardBorder }, appliedHex && { borderColor: COLORS.text, borderWidth: 2 }]}
                      accessibilityLabel={appliedHex ? 'Couleur appliquée' : 'Aperçu de la couleur'}
                    >
                      {appliedHex && <Ionicons name="checkmark" size={18} color={readableOn(customHex)} />}
                    </View>
                    <TouchableOpacity
                      style={[styles.applyBtn, (!canApplyHex) && { opacity: 0.5 }]}
                      onPress={applyHex}
                      disabled={!canApplyHex}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !canApplyHex }}
                    >
                      <Text style={styles.applyBtnText}>Appliquer</Text>
                    </TouchableOpacity>
                  </View>
                  {!customValid && (
                    <Text style={[styles.hint, { color: COLORS.danger }]}>
                      Il faut six caractères entre 0-9 et A-F (exemple : #00B67A).
                    </Text>
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.hint}>La personnalisation de la couleur d'accent est réservée aux abonnés Premium.</Text>
                  <TouchableOpacity style={styles.unlockBtn} onPress={() => router.navigate('/(tabs)/(secondary)/premium' as any)} activeOpacity={0.85} accessibilityRole="button">
                    <Ionicons name="star-outline" size={16} color={COLORS.onAccent} />
                    <Text style={styles.unlockBtnText}>Passer Premium</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

          </View>

          {/* ── COSMÉTIQUES : ce qui se porte (cadres d'avatar, flammes de série) ── */}
          <Text style={styles.sectionTitle}>{SHOP_CATEGORY_LABELS.cosmetiques}</Text>
          <Text style={styles.sectionIntro}>Le cadre autour de ton avatar et la flamme de ta série.</Text>
          <View style={styles.card}>
            {/* TROIS ÉTATS, PAS UN.
                « Aucun cadre débloqué » était affiché tant que l'inventaire n'était pas lu — donc à
                chaque ouverture, y compris à quelqu'un qui possède tout —, et il RESTAIT affiché si
                la lecture échouait. On attend d'abord, on ne conclut qu'une fois qu'on sait. */}
            {!inventoryReady ? (
              <ShelfLoading styles={styles} COLORS={COLORS} error={inventoryError} />
            ) : cosmeticGroups.length === 0 ? (
              <EmptyShelf
                styles={styles} COLORS={COLORS} router={router} readOnly={readOnly}
                text="Aucun cadre ni flamme débloqué pour le moment."
              />
            ) : (
              <>
                <Text style={styles.hint}>
                  {readOnly
                    ? 'Consultation seule : les cosmétiques de ce compte ne peuvent pas être changés ici.'
                    : "Touche un élément pour l'équiper ; touche-le à nouveau pour le retirer."}
                </Text>
                {cosmeticGroups.map((group) => (
                  <View key={group.slot}>
                    <Text style={styles.cosmeticGroupTitle}>{group.label}</Text>
                    {/* Une ligne par type, défilable à l'horizontale (galerie / carrousel). */}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cosmeticRow}>
                      {group.items.map((cos) => (
                        <CosmeticCard key={cos.key} cos={cos} styles={styles} COLORS={COLORS} disabled={readOnly} onToggle={() => toggleCosmetic(cos.key)} />
                      ))}
                    </ScrollView>
                  </View>
                ))}
              </>
            )}
          </View>

          {/* ── TITRES DE PROFIL : du texte sous ton pseudo, vendu à part en boutique ── */}
          <Text style={styles.sectionTitle}>{SHOP_CATEGORY_LABELS.titres}</Text>
          <Text style={styles.sectionIntro}>La mention affichée sous ton nom, sur ton profil.</Text>
          <View style={[styles.card, { marginBottom: 8 }]}>
            {!inventoryReady ? (
              <ShelfLoading styles={styles} COLORS={COLORS} error={inventoryError} />
            ) : titleItems.length === 0 ? (
              <EmptyShelf
                styles={styles} COLORS={COLORS} router={router} readOnly={readOnly}
                text="Aucun titre débloqué pour le moment."
              />
            ) : (
              <>
                <Text style={styles.hint}>Un seul titre à la fois : en équiper un remplace le précédent.</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cosmeticRow}>
                  {titleItems.map((cos) => (
                    <CosmeticCard key={cos.key} cos={cos} styles={styles} COLORS={COLORS} disabled={readOnly} onToggle={() => toggleCosmetic(cos.key)} />
                  ))}
                </ScrollView>
              </>
            )}
          </View>
        </KeyboardAwareScrollView>
      </SafeAreaView>

      {/* Palette de couleurs (HSV) — ouverte au clic sur le carré d'aperçu. Met à jour l'aperçu ;
          l'application se fait via « Appliquer », comme la saisie hex. */}
      <ColorPickerModal
        visible={showColorPicker}
        value={customValid ? customHex : '#00B67A'}
        onPick={(hex) => onHexChange(hex)}
        onClose={() => setShowColorPicker(false)}
      />
    </View>
  );
}

/** Rayon vide : on dit ce qui manque, et on ouvre la boutique — même geste dans les deux sections. */
function EmptyShelf({ styles, COLORS, router, text, readOnly }: { styles: any; COLORS: any; router: any; text: string; readOnly?: boolean }) {
  /* En consultation d'un autre compte, les lectures ne renvoient rien (chacun ses lignes) : dire
     « aucun article débloqué » serait une affirmation sur des données qu'on ne peut PAS lire — et
     proposer la boutique n'aurait aucun sens, on n'achète pas pour quelqu'un d'autre. */
  if (readOnly) {
    return (
      <Text style={styles.hint}>
        Les articles de ce compte ne sont pas lisibles depuis le tien : cette page ne montrerait
        qu'un rayon vide.
      </Text>
    );
  }
  return (
    <>
      <Text style={styles.hint}>{text}</Text>
      <TouchableOpacity style={styles.unlockBtn} onPress={() => router.push('/(tabs)/(secondary)/boutique' as any)} activeOpacity={0.85} accessibilityRole="button">
        <Ionicons name="bag-handle-outline" size={16} color={COLORS.onAccent} />
        <Text style={styles.unlockBtnText}>Voir la boutique</Text>
      </TouchableOpacity>
    </>
  );
}

/**
 * Rayon dont on ne connaît PAS encore le contenu — à ne jamais confondre avec un rayon vide.
 * Tant que l'inventaire n'a pas répondu, annoncer « tu n'as rien » est une affirmation gratuite.
 */
function ShelfLoading({ styles, COLORS, error }: { styles: any; COLORS: any; error: boolean }) {
  if (error) {
    return <Text style={[styles.hint, { color: COLORS.danger }]}>Tes achats n'ont pas pu être chargés.</Text>;
  }
  return (
    <View style={styles.shelfLoading}>
      <ActivityIndicator size="small" color={COLORS.textSecondary} />
      <Text style={styles.hint}>Chargement de tes achats…</Text>
    </View>
  );
}

/** Vignette d'un cosmétique possédé — identique dans les deux rayons (une seule écriture). */
function CosmeticCard({ cos, styles, COLORS, onToggle, disabled }: { cos: any; styles: any; COLORS: any; onToggle: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.cosmeticCard, cos.equipped && { borderColor: COLORS.emerald, backgroundColor: COLORS.emerald + '14' }, disabled && styles.disabled]}
      onPress={onToggle}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ selected: cos.equipped, disabled: !!disabled }}
      accessibilityLabel={`${cos.label}${cos.equipped ? ' (équipé)' : ''}`}
    >
      <View style={[styles.cosmeticCardIcon, { backgroundColor: cos.color + '22' }]}>
        {/* L'icône d'un article peut être une IMAGE téléversée par l'administration (comme en
            boutique) : rendue en `Ionicons`, elle ne s'affichait tout simplement pas. */}
        {isImageIcon(cos.icon)
          ? <Image source={{ uri: cos.icon }} style={styles.cosmeticCardImage} resizeMode="contain" />
          : <Ionicons name={cos.icon as any} size={22} color={cos.color} />}
      </View>
      <Text style={styles.cosmeticCardLabel} numberOfLines={2}>{cos.label}</Text>
      {cos.equipped && (
        <View style={styles.cosmeticCheck}>
          <Ionicons name="checkmark" size={12} color={COLORS.onAccent} />
        </View>
      )}
    </TouchableOpacity>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    card: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, padding: 16, marginBottom: 22 },
    // Bandeau d'information / d'erreur, en tête de page.
    notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, marginBottom: 14 },
    noticeText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: c.textSecondary },
    disabled: { opacity: 0.45 },
    shelfLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    // Titres de RAYON, hors des cartes : ils découpent la page comme la boutique découpe la sienne.
    sectionTitle: { fontSize: 17, fontWeight: "800", color: c.text, marginTop: 4 },
    sectionIntro: { fontSize: 12.5, color: c.textSecondary, lineHeight: 17, marginTop: 3, marginBottom: 10 },
    block: { gap: 10 },
    label: { fontSize: 15, fontWeight: '500', color: c.text },
    segmentRow: { flexDirection: 'row', gap: 8 },
    segment: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bg },
    segmentActive: { backgroundColor: c.emerald, borderColor: c.emerald },
    segmentLabel: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
    // `onAccent` (et non `bg`) : la couleur d'accent est libre, le libellé doit rester lisible
    // dessus quelle que soit la teinte choisie — y compris un jaune vif en mode clair.
    segmentLabelActive: { color: c.onAccent },
    presetRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
    presetDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.cardBorder },
    presetDotActive: { borderWidth: 2, borderColor: c.text },
    hint: { fontSize: 12, color: c.textSecondary, lineHeight: 16, marginTop: -2 },
    customRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    customPreview: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.cardBorder },
    pickerBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card },
    hexInput: { width: 110, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, color: c.text, backgroundColor: c.bg, fontSize: 14, letterSpacing: 1 },
    applyBtn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10, backgroundColor: c.emerald },
    applyBtnText: { fontSize: 14, fontWeight: '700', color: c.onAccent },
    lockRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    premiumBadge: { width: 20, height: 20, borderRadius: 6, backgroundColor: 'rgba(245,179,1,0.16)', alignItems: 'center', justifyContent: 'center' },
    unlockBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.emerald, borderRadius: 10, paddingVertical: 12, marginTop: 4 },
    unlockBtnText: { fontSize: 14, fontWeight: '700', color: c.onAccent },
    cosmeticGroupTitle: { fontSize: 12, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 2 },
    cosmeticRow: { flexDirection: 'row', gap: 10, marginTop: 6, paddingRight: 6 },
    cosmeticCard: { width: 104, height: 96, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, gap: 7 },
    cosmeticCardIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    cosmeticCardImage: { width: 26, height: 26 },
    cosmeticCardLabel: { fontSize: 11, fontWeight: '700', color: c.text, textAlign: 'center' },
    cosmeticCheck: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: c.emerald, alignItems: 'center', justifyContent: 'center' },
  });
}
