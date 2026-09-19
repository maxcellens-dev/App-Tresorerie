import { useEffect, useState, type ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { LandingMedia as Media } from '../../hooks/config/useLandingConfig';

export default function LandingMedia({ media, fallback }: { media: Media; fallback?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [media.url]);
  if (!media.url || failed) return <>{fallback}</>;
  const opacity = Number.isFinite(media.opacity) ? Math.max(0, Math.min(100, media.opacity)) / 100 : 0;
  return <View style={StyleSheet.absoluteFill}>
    <Image source={{ uri: media.url }} accessibilityLabel={media.alt} accessible={!!media.alt}
      resizeMode={media.fit} style={StyleSheet.absoluteFill} onError={() => setFailed(true)} />
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: /^#[0-9a-f]{6}$/i.test(media.overlay) ? media.overlay : '#123B37', opacity }]} />
  </View>;
}
