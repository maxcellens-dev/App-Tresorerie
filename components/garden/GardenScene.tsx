/**
 * L'arbre à l'écran : rend la scène SVG (lib/garden/sceneSvg) et pose par-dessus des zones
 * touchables (arrosoir, racines, arbre, cabane, ronces, Pico).
 *
 * - Le SVG est une chaîne rendue par `SvgXml` : le dessin reste pur et testable, et une seule
 *   implémentation sert le natif et le web.
 * - Il n'est reconstruit que si l'état ou les options changent RÉELLEMENT (clé sérialisée) : un
 *   parent qui recrée ses objets à chaque rendu ne refait pas tout le dessin.
 * - Les zones sont placées en POURCENTAGES du viewBox : rien à mesurer, elles suivent la taille du
 *   conteneur quelle qu'elle soit (règle de l'app : on ne déduit jamais une largeur de l'écran).
 */
import { memo, useId, useMemo } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { describeScene, type HotspotPart, type SceneOptions } from '../../lib/garden/sceneSvg';
import { buildCinematicScene, type SceneExtras } from '../../lib/garden/sceneCinematic';
import type { TreeState } from '../../lib/garden/treeState';
import { seasonFor } from '../../lib/garden/season';
import { TREE_PARTS } from '../../lib/garden/lexicon';
import { GARDEN_COLORS, GARDEN_RADII } from '../../lib/garden/theme';

const PART_LABEL: Record<HotspotPart, string> = {
  can: `${TREE_PARTS.can.name} · ${TREE_PARTS.can.meaning}`,
  roots: `${TREE_PARTS.roots.name} · ${TREE_PARTS.roots.meaning}`,
  tree: `${TREE_PARTS.branches.name} · ${TREE_PARTS.branches.meaning}`,
  cabin: `${TREE_PARTS.cabin.name} · ${TREE_PARTS.cabin.meaning}`,
  brambles: `${TREE_PARTS.brambles.name} · ${TREE_PARTS.brambles.meaning}`,
  flowers: `${TREE_PARTS.flowers.name} · ${TREE_PARTS.flowers.meaning}`,
  pico: 'Pépin',
};

/**
 * Ordre d'empilement des zones, de la plus grande (dessous) à la plus précise (dessus) : la zone de
 * l'arbre déborde sur l'arrosoir et contient la cabane ; sans cet ordre, elle les recouvrirait.
 */
const STACK: HotspotPart[] = ['tree', 'roots', 'can', 'flowers', 'brambles', 'cabin', 'pico'];

interface Props {
  state: TreeState;
  options: SceneOptions & SceneExtras;
  /** Sans gestionnaire, la scène est un simple dessin (aucune zone touchable). */
  onPressPart?: (part: HotspotPart) => void;
  style?: StyleProp<ViewStyle>;
}

function GardenScene({ state, options, onPressPart, style }: Props) {
  /* Identifiants de dégradés UNIQUES par scène affichée : sur le web, deux SVG qui partagent un id
     (page restée montée et masquée + page revenue) font pointer les dégradés vers la copie cachée —
     le dessin s'affichait alors sans ses couleurs ni volumes au retour sur la page. */
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const opts = useMemo(() => ({ ...options, id: `${options.id}${uid}`, season: options.season ?? seasonFor(new Date()) }), [options, uid]);
  const key = JSON.stringify([state, opts]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scene = useMemo(() => buildCinematicScene(state, opts), [key]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const label = useMemo(() => options.label ?? describeScene(state), [key]);
  const [vx, vy, vw, vh] = scene.viewBox.split(/\s+/).map(Number);

  return (
    <View
      style={[{ width: '100%', aspectRatio: vw / vh, backgroundColor: GARDEN_COLORS.sky, borderRadius: GARDEN_RADII.xl, overflow: 'hidden' }, style]}
      accessible={!onPressPart}
      accessibilityRole={onPressPart ? undefined : 'image'}
      accessibilityLabel={label}
    >
      <SvgXml xml={scene.svg} width="100%" height="100%" />
      {onPressPart
        ? [...scene.hotspots].sort((a, b) => STACK.indexOf(a.part) - STACK.indexOf(b.part)).map((h) => {
            const left = Math.max(0, (h.x - vx) / vw), top = Math.max(0, (h.y - vy) / vh);
            const width = Math.min(1 - left, h.w / vw), height = Math.min(1 - top, h.h / vh);
            if (width <= 0 || height <= 0) return null;
            return (
              <Pressable
                key={h.part}
                onPress={() => onPressPart(h.part)}
                accessibilityRole="button"
                accessibilityLabel={PART_LABEL[h.part]}
                style={{ position: 'absolute', left: `${left * 100}%`, top: `${top * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }}
              />
            );
          })
        : null}
    </View>
  );
}

export default memo(GardenScene);
