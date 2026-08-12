/**
 * SocialLinks — la rangée d'icônes de réseaux sociaux.
 *
 * Un seul composant pour les deux endroits où elle apparaît :
 *  • le pied de page de la landing BUREAU (web grand écran) ;
 *  • le bas de l'écran d'accueil MOBILE — à côté du badge Google Play en web mobile, seule dans
 *    l'app native (où le badge n'a pas de sens).
 *
 * Tout est piloté par l'admin (app_config.landing.socials) : ordre, icône (Ionicons ou image
 * téléversée), taille, alignement et habillage. Rien à recompiler pour ajouter un réseau.
 * Renvoie `null` s'il n'y a rien à montrer — le conteneur reste alors intact.
 */
import { View, Image, StyleSheet, TouchableOpacity, Linking, Platform, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LandingSocials } from '../../hooks/config/useLandingConfig';

export default function SocialLinks({ config, color, style, align }: {
  config: LandingSocials | undefined;
  /** Couleur de l'icône (et de la pastille). Le pied de page passe sa couleur de texte secondaire. */
  color: string;
  style?: ViewStyle;
  /** Force l'alignement (le mobile est toujours centré) ; sinon celui de la config. */
  align?: 'left' | 'center' | 'right';
}) {
  if (!config?.enabled) return null;
  // Une entrée sans URL ne mène nulle part : on ne l'affiche pas (plutôt qu'un bouton mort).
  const items = (config.items ?? []).filter((s) => (s.url ?? '').trim().length > 0);
  if (items.length === 0) return null;

  const size = Math.max(14, Math.min(48, config.size || 22));
  const shape = config.shape ?? 'circle';
  const pad = shape === 'plain' ? 0 : Math.round(size * 0.45);
  const box = size + pad * 2;
  const justify = (align ?? config.align ?? 'center') === 'left' ? 'flex-start'
    : (align ?? config.align) === 'right' ? 'flex-end' : 'center';

  const open = (url: string) => {
    const clean = url.trim();
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(clean, '_blank', 'noopener');
    else Linking.openURL(clean).catch(() => {});
  };

  return (
    <View style={[styles.row, { justifyContent: justify, gap: Math.round(size * 0.5) }, style]}>
      {items.map((s, i) => (
        <TouchableOpacity
          key={`${s.url}-${i}`}
          onPress={() => open(s.url)}
          activeOpacity={0.7}
          accessibilityRole="link"
          accessibilityLabel={s.label || 'Réseau social'}
          style={[
            styles.item,
            shape !== 'plain' && {
              width: box, height: box,
              borderRadius: shape === 'circle' ? box / 2 : Math.round(size * 0.32),
              borderWidth: 1, borderColor: color + '55',
            },
          ]}
        >
          {/* Image téléversée prioritaire : c'est la porte de sortie pour les réseaux dont
              Ionicons n'a pas le logo (Threads, Mastodon, BlueSky…). */}
          {s.image
            ? <Image source={{ uri: s.image }} style={{ width: size, height: size }} resizeMode="contain" />
            : <Ionicons name={(s.icon || 'globe-outline') as any} size={size} color={color} />}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  item: {
    alignItems: 'center', justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
});
