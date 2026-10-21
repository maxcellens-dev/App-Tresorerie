/**
 * L'arrosoir seul, à un niveau d'eau donné (0 → 1) — les mêmes images que la scène 3D
 * (lib/garden/scene3dAssets : l'arrosoir vide + le calque d'eau, coupé au niveau voulu).
 * Pour la vitrine et les explications : « ton Relyka, c'est l'eau de ton arrosoir ».
 */
import { Image, View } from 'react-native';
import { SCENE3D, SCENE3D_IMG } from '../../lib/garden/scene3dAssets';

export default function WateringCan({ level, width = 120, accessibilityLabel }: { level: number; width?: number; accessibilityLabel?: string }) {
  const c = SCENE3D.can;
  const h = width * c.h / c.w;
  const lv = Math.max(0, Math.min(1, level));
  // part du HAUT de l'image où l'eau n'apparaît pas encore (même règle que scene3dLayout)
  const cut = c.waterTop + (1 - lv) * (c.waterBottom - c.waterTop);
  const visH = h * (1 - cut);
  return (
    <View accessible={!!accessibilityLabel} accessibilityRole={accessibilityLabel ? 'image' : undefined} accessibilityLabel={accessibilityLabel} style={{ width, height: h }}>
      <Image source={SCENE3D_IMG.can_empty} fadeDuration={0} resizeMode="stretch" style={{ position: 'absolute', left: 0, top: 0, width, height: h }} />
      {lv > 0.01 ? (
        <View style={{ position: 'absolute', left: 0, top: h - visH, width, height: visH, overflow: 'hidden' }}>
          <Image source={SCENE3D_IMG.can_water} fadeDuration={0} resizeMode="stretch" style={{ position: 'absolute', left: 0, top: -(h - visH), width, height: h }} />
        </View>
      ) : null}
    </View>
  );
}
