/**
 * AdSlot — zone de publicité « maison » par emplacement (1 par page principale).
 * - N'affiche rien si pubs désactivées (admin), utilisateur Premium, ou aucune bannière
 *   pour cet emplacement.
 * - Plusieurs bannières sur le même emplacement → rotation en fondu enchaîné, durée
 *   paramétrable en admin (rotation_seconds).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Linking, Platform, Animated, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { usePlan } from '../../hooks/config/usePlan';
import { useAdsConfig, bannerPlacements, bannerLink, placementFormat, type AdPlacement } from '../../hooks/config/useAdsConfig';
import { logEvent } from '../../lib/platform/analytics';

// Impressions déjà comptées dans la session (1 par bannière × emplacement) → évite le flood.
const seenImpressions = new Set<string>();

// Graine tirée UNE fois par session d'app : deux ouvertures ne démarrent pas sur la même bannière.
const SESSION_SEED = Math.floor(Math.random() * 9973);

/**
 * Décalage de départ dans la liste des bannières, propre à chaque emplacement.
 * Sans lui, tous les emplacements partent de la bannière 1 : en naviguant d'une page à l'autre,
 * l'utilisateur reverrait la MÊME pub partout (et au même rythme). Avec ce décalage, la page A
 * commence sur la bannière 1, la page B sur la 3, etc. — la rotation reste ensuite identique.
 */
function placementOffset(placement: string, count: number): number {
  if (count < 2) return 0;
  let h = 0;
  for (let i = 0; i < placement.length; i++) h = (h * 31 + placement.charCodeAt(i)) % 9973;
  return (h + SESSION_SEED) % count;
}

/**
 * La FORME de la zone vient de l'emplacement (cf. AD_FORMATS), plus d'une prop du point d'appel.
 * `compact` restait à la main de l'écran : rien ne garantissait que les deux endroits qui rendent
 * « Comptes › À côté des actions » soient d'accord, et l'admin ne pouvait pas savoir quelle image
 * fournir. Un seul endroit décide, et c'est celui que l'écran d'administration affiche.
 */
export default function AdSlot({ placement, style }: { placement: AdPlacement; style?: ViewStyle }) {
  const format = placementFormat(placement);
  const compact = format === 'compact';
  const rect = format === 'rect';
  const COLORS = useAppColors();
  const router = useRouter();
  const { user } = useAuth();
  const { showAds } = usePlan(user?.id);
  const { data } = useAdsConfig();

  // Masquage global (admin) → aucune bannière. Sinon on exclut les bannières masquées une à une.
  const adsDisabled = !!data?.disabled;
  const banners = adsDisabled ? [] : (data?.banners ?? []).filter((b) => !b.hidden && bannerPlacements(b).includes(placement));
  const count = banners.length;
  const rotationMs = Math.max(2, data?.rotation_seconds ?? 6) * 1000;
  // Opacité globale des bannières (réglable en admin).
  const baseOpacity = Math.max(0, Math.min(1, (data?.opacity ?? 100) / 100));

  // `idx` = tour de rotation ; la bannière réellement affichée est décalée par l'emplacement.
  const [idx, setIdx] = useState(0);
  const offset = useMemo(() => placementOffset(placement, count), [placement, count]);
  const pos = count > 0 ? (idx + offset) % count : 0;
  const opacity = useRef(new Animated.Value(1)).current;

  // Rotation en fondu si plusieurs bannières au même emplacement.
  useEffect(() => {
    if (count < 2) return;
    const t = setInterval(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setIdx((i) => (i + 1) % count);
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      });
    }, rotationMs);
    return () => clearInterval(t);
  }, [count, rotationMs, opacity]);

  // Garder l'index dans les bornes si la liste change.
  useEffect(() => { if (idx >= count && count > 0) setIdx(0); }, [count, idx]);

  // Impression publicitaire (1 fois par bannière et par emplacement dans la session).
  useEffect(() => {
    if (!showAds || count === 0) return;
    const b = banners[pos];
    if (!b) return;
    const key = `${placement}:${b.id}`;
    if (seenImpressions.has(key)) return;
    seenImpressions.add(key);
    logEvent('ad_impression', placement, { bannerId: b.id, label: b.label });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, count, showAds, placement]);

  if (!showAds || count === 0) return null;
  const banner = banners[pos];
  // Lien de la bannière : page/bouton de l'app (interne) ou site externe. `null` = non cliquable.
  const link = bannerLink(banner);
  const open = () => {
    if (!link) return;
    logEvent('ad_click', placement, { bannerId: banner.id, label: banner.label, kind: link.kind, href: link.href });
    if (link.kind === 'internal') router.push(link.href as any);
    else Linking.openURL(link.href).catch(() => {});
  };

  return (
    <Animated.View style={[{ opacity }, compact ? styles.compactWrap : null, rect ? styles.rectWrap : null, style]}>
      <TouchableOpacity
        style={[styles.slot, compact && styles.slotCompact, rect && styles.slotRect, { backgroundColor: COLORS.card, borderColor: COLORS.cardBorder, opacity: baseOpacity }]}
        onPress={open}
        activeOpacity={link ? 0.85 : 1}
        disabled={!link}
      >
        {banner.image ? (
          // Image quasi pleine zone + tag « Sponsorisé » en overlay (pastille sombre
          // + ombre du texte → lisible quelle que soit l'image).
          <>
            <Image source={{ uri: banner.image }} style={compact ? styles.imgCompact : rect ? styles.imgRect : styles.img} resizeMode="cover" />
            <View style={styles.tagOverlay}>
              <Text style={styles.tagOverlayText}>Sponsorisé</Text>
            </View>
          </>
        ) : (
          /* Repli SANS image. En rectangle, le texte se centre dans la boîte (une rangée
             horizontale collée en haut d'un encart vide se lit comme une bannière ratée) ;
             ailleurs, la mise en page d'origine est inchangée. */
          <View style={compact ? styles.textWrapCompact : rect ? styles.textWrapRect : styles.textWrap}>
            {!compact && <Text style={[styles.tag, { color: COLORS.textSecondary }]}>Sponsorisé</Text>}
            <Animated.View style={rect ? styles.textColRect : styles.textRow}>
              <Ionicons name="megaphone-outline" size={compact ? 15 : rect ? 26 : 18} color={COLORS.emerald} />
              <Text
                style={[compact ? styles.textCompact : rect ? styles.textRect : styles.text, { color: COLORS.text }]}
                numberOfLines={rect ? 4 : 2}
              >
                {banner.text ?? banner.label ?? 'Découvrez nos partenaires'}
              </Text>
              {link ? <Ionicons name="chevron-forward" size={compact ? 13 : 16} color={COLORS.textSecondary} /> : null}
            </Animated.View>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slot: { borderWidth: 1, borderRadius: 14, marginVertical: 6, overflow: 'hidden', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  // Variante compacte : remplit l'espace dispo à côté d'autres éléments (ex. actions Comptes).
  compactWrap: { flex: 1 },
  slotCompact: { marginVertical: 0, height: 64, justifyContent: 'center' },
  imgCompact: { width: '100%', height: 64 },
  textWrapCompact: { paddingHorizontal: 10, paddingVertical: 8 },
  textCompact: { flex: 1, fontSize: 11.5, fontWeight: '600' },
  // Image pleine largeur à RATIO FORCÉ (≈3,5:1) → même forme sur toutes les pages, quelle que
  // soit la largeur disponible. Uploader au ratio 3,5:1 (ex. 1400×400) pour éviter tout recadrage.
  img: { width: '100%', aspectRatio: 3.5 },

  /* ── Variante ENCART (1,91 : 1, PLEINE LARGEUR) ─────────────────────────────────────────────
     Réservée aux cartes (confirmation de saisie), jamais à une page qui défile.
     AUCUN plafond de largeur : les plafonds précédents (260 pt, puis 30 % de la hauteur d'écran)
     laissaient ~35 pt de vide de chaque côté, et l'encart était le seul bloc de la carte à ne pas
     aller bord à bord — l'œil le lisait comme un élément mal posé. C'est le RATIO qui borne
     désormais la hauteur : à 1,91 : 1, pleine largeur, l'encart est plus BAS qu'avec les plafonds
     (~172 pt contre ~217 sur un téléphone standard), donc le pied de carte ne risque plus de
     passer sous l'écran. */
  rectWrap: { width: '100%' },
  slotRect: { width: '100%' },
  imgRect: { width: '100%', aspectRatio: 1.91 },
  textWrapRect: { width: '100%', aspectRatio: 1.91, padding: 14, alignItems: 'center', justifyContent: 'center' },
  textColRect: { flexDirection: 'column', alignItems: 'center', gap: 10 },
  textRect: { fontSize: 13.5, fontWeight: '700', textAlign: 'center', lineHeight: 19 },
  // Pastille « Sponsorisé » : discrète (−20 % par rapport à la taille d'origine) — elle doit se
  // lire, pas concurrencer le message de la bannière.
  tagOverlay: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 5.5, paddingVertical: 2.5, borderRadius: 5 },
  tagOverlayText: { fontSize: 7, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, color: '#fff', textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  textWrap: { padding: 12 },
  tag: { fontSize: 7, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
  textRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flex: 1, fontSize: 13, fontWeight: '600' },
});
