/**
 * L'arbre à l'écran, en 3D : des images superposées (lib/garden/scene3dLayout) + quelques calques
 * vectoriels (ciel, repères 1/3/6 mois, ombres de contact, lueurs) + les zones touchables (arrosoir,
 * racines, arbre, cabane, ronces, fleurs, Pépin).
 *
 * - Tout est placé en POURCENTAGES du cadre : la scène suit la largeur de son conteneur, quelle
 *   qu'elle soit (règle de l'app : on ne déduit jamais une largeur de l'écran), sans rien mesurer.
 * - Crépuscule et nuit : un voile coloré sur toute la scène (les images restent celles du jour),
 *   la lune, les étoiles et les lanternes passent au-dessus. L'heure est l'heure LOCALE.
 * - La mise en page n'est recalculée que si l'état ou les options changent RÉELLEMENT.
 */
import { memo, useEffect, useId, useMemo, useState } from 'react';
import { Image, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { describeScene, type HotspotPart } from '../../lib/garden/sceneTypes';
import type { SceneExtras } from '../../lib/garden/sceneTypes';
import type { TreeState } from '../../lib/garden/treeState';
import { seasonFor, type Season } from '../../lib/garden/season';
import { momentFor, type Moment } from '../../lib/garden/daylight';
import { FRAME_H, FRAME_W, VEIL, layoutScene, skyStops, type Layer, type PepinMood } from '../../lib/garden/scene3dLayout';
import { SCENE3D_IMG } from '../../lib/garden/scene3dAssets';
import { TREE_PARTS } from '../../lib/garden/lexicon';
import { GARDEN_COLORS, GARDEN_RADII } from '../../lib/garden/theme';

const PART_LABEL: Record<HotspotPart, string> = {
  can: TREE_PARTS.can.name,
  roots: TREE_PARTS.roots.name,
  tree: TREE_PARTS.branches.name,
  cabin: TREE_PARTS.cabin.name,
  brambles: TREE_PARTS.brambles.name,
  flowers: TREE_PARTS.flowers.name,
  pico: 'Pépin',
};

/**
 * Ordre d'empilement des zones, de la plus grande (dessous) à la plus précise (dessus) : la zone de
 * l'arbre déborde sur l'arrosoir et contient la cabane ; sans cet ordre, elle les recouvrirait.
 */
const STACK: HotspotPart[] = ['tree', 'roots', 'can', 'flowers', 'brambles', 'cabin', 'pico'];

export interface GardenSceneOptions extends SceneExtras {
  /** Gardé pour compatibilité (ancien préfixe des dégradés SVG) ; les identifiants sont désormais uniques d'office. */
  id?: string;
  season?: Season;
  /** Force le moment de la journée (vitrine, captures) ; sinon l'heure locale. */
  moment?: Moment;
  marks?: boolean;
  mascot?: boolean;
  mood?: PepinMood;
  glow?: boolean;
  rain?: boolean;
  sky?: boolean;
  label?: string;
}

interface Props {
  state: TreeState;
  options: GardenSceneOptions;
  /** Sans gestionnaire, la scène est un simple dessin (aucune zone touchable). */
  onPressPart?: (part: HotspotPart) => void;
  style?: StyleProp<ViewStyle>;
}

const pctX = (n: number) => `${(n / FRAME_W) * 100}%` as const;
const pctY = (n: number) => `${(n / FRAME_H) * 100}%` as const;

/** Une image du cadre, éventuellement coupée (niveau d'eau, cabane en construction, échelle). */
const LayerImage = memo(function LayerImage({ l }: { l: Layer }) {
  const source = SCENE3D_IMG[l.img];
  const transform = l.flip ? [{ scaleX: -1 as const }] : undefined;
  const cut = l.showBottom ?? l.showTop;
  if (cut == null) {
    return <Image source={source} fadeDuration={0} resizeMode="stretch" style={{ position: 'absolute', left: pctX(l.x), top: pctY(l.y), width: pctX(l.w), height: pctY(l.h), opacity: l.opacity, transform }} />;
  }
  const visH = l.h * Math.max(0, Math.min(1, cut));
  if (visH < 0.5) return null;
  const top = l.showBottom != null ? l.y + l.h - visH : l.y;
  return (
    <View style={{ position: 'absolute', left: pctX(l.x), top: pctY(top), width: pctX(l.w), height: pctY(visH), overflow: 'hidden', opacity: l.opacity }}>
      <Image
        source={source}
        fadeDuration={0}
        resizeMode="stretch"
        style={{ position: 'absolute', left: 0, width: '100%', height: `${(l.h / visH) * 100}%`, top: l.showBottom != null ? `${(-(l.h - visH) / visH) * 100}%` : 0, transform }}
      />
    </View>
  );
});

/** Étoiles fixes (même ciel à chaque rendu) : [x, y, rayon]. */
const STARS: [number, number, number][] = (() => {
  let s = 3; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 70 }, () => [r() * FRAME_W, r() * 520, 0.9 + r() * 1.8] as [number, number, number]);
})();
const RAIN: [number, number][] = [[255, 140], [350, 210], [440, 110], [535, 190], [625, 125], [720, 220], [300, 300], [580, 290]];

/** Le moment de la journée, réévalué toutes les 5 minutes (la scène passe seule au crépuscule). */
function useMoment(forced?: Moment): Moment {
  const [m, setM] = useState<Moment>(() => momentFor());
  useEffect(() => {
    if (forced) return;
    const t = setInterval(() => setM(momentFor()), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [forced]);
  return forced ?? m;
}

function GardenScene({ state, options, onPressPart, style }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const moment = useMoment(options.moment);
  const season = options.season ?? seasonFor(new Date());
  const key = JSON.stringify([state, options, moment, season]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scene = useMemo(() => layoutScene(state, { ...options, season, moment }), [key]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const label = useMemo(() => options.label ?? describeScene(state), [key]);
  const sky = skyStops(season, moment);
  const veil = VEIL[moment];
  const v = scene.vector;
  const id = (n: string) => `${n}${uid}`;

  return (
    <View
      style={[{ width: '100%', aspectRatio: FRAME_W / FRAME_H, backgroundColor: GARDEN_COLORS.sky, borderRadius: GARDEN_RADII.xl, overflow: 'hidden' }, style]}
      accessible={!onPressPart}
      accessibilityRole={onPressPart ? undefined : 'image'}
      accessibilityLabel={label}
    >
      {/* Ciel, soleil, halo de palier */}
      <Svg style={{ position: 'absolute', left: 0, top: 0 }} width="100%" height="100%" viewBox={`0 0 ${FRAME_W} ${FRAME_H}`} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id('sky')} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={sky[0]} /><Stop offset="0.55" stopColor={sky[1]} /><Stop offset="1" stopColor={sky[2]} />
          </LinearGradient>
          <RadialGradient id={id('sun')} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#FFF4D2" stopOpacity="1" /><Stop offset="0.3" stopColor="#FFE6A8" stopOpacity="0.85" /><Stop offset="1" stopColor="#FFE6A8" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id={id('glow')} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#FFE9A6" stopOpacity="0.9" /><Stop offset="0.55" stopColor="#FFD978" stopOpacity="0.35" /><Stop offset="1" stopColor="#FFD978" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {options.sky !== false ? <Rect x="0" y="0" width={FRAME_W} height={FRAME_H} fill={`url(#${id('sky')})`} /> : null}
        {options.sky !== false && moment === 'day' ? <G><Circle cx="800" cy="112" r="130" fill={`url(#${id('sun')})`} /><Circle cx="800" cy="112" r="44" fill="#FFF0C4" opacity="0.95" /></G> : null}
        {options.sky !== false && moment === 'dusk' ? <G><Circle cx="790" cy="430" r="150" fill={`url(#${id('sun')})`} /><Circle cx="790" cy="430" r="40" fill="#FFD9A0" /></G> : null}
        {/* étoiles DANS le ciel (derrière l'arbre et les nuages), un peu renforcées : le voile les adoucit */}
        {options.sky !== false && moment === 'night' ? STARS.map(([x, y, r], i) => <Circle key={i} cx={x} cy={y} r={r * 1.15} fill="#FFFFFF" opacity={0.65 + (i % 5) * 0.07} />) : null}
        {v.glow ? <Circle cx={v.glow.cx} cy={v.glow.cy} r={v.glow.r} fill={`url(#${id('glow')})`} /> : null}
      </Svg>

      {scene.back.map((l) => <LayerImage key={l.key} l={l} />)}

      {/* Repères 1 / 3 / 6 mois, arrosage des racines, ombres de contact */}
      <Svg style={{ position: 'absolute', left: 0, top: 0 }} width="100%" height="100%" viewBox={`0 0 ${FRAME_W} ${FRAME_H}`} preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={id('shadow')} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#1E2A10" stopOpacity="0.55" /><Stop offset="1" stopColor="#1E2A10" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {v.marks.map((m) => (
          <G key={m.label} opacity={m.reached ? 1 : 0.55}>
            <Line x1="74" y1={m.y} x2="726" y2={m.y} stroke="#F4E6CC" strokeWidth="2.6" strokeDasharray="8 10" strokeLinecap="round" opacity="0.9" />
            <Rect x="736" y={m.y - 21} width="124" height="42" rx="13" fill="#D9B086" stroke="#8C6442" strokeWidth="2" />
            <SvgText x="798" y={m.y + 8} textAnchor="middle" fontFamily="Nunito_800ExtraBold" fontWeight="800" fontSize="23" fill={m.reached ? '#3E2A17' : '#6E5639'}>{m.label}</SvgText>
          </G>
        ))}
        {v.shadows.map((s, i) => <Ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={`url(#${id('shadow')})`} opacity={s.o * 1.6} />)}
      </Svg>

      {scene.front.map((l) => <LayerImage key={l.key} l={l} />)}

      {/* Arrosage des branches, reflet de l'eau, averse */}
      <Svg style={{ position: 'absolute', left: 0, top: 0 }} width="100%" height="100%" viewBox={`0 0 ${FRAME_W} ${FRAME_H}`} preserveAspectRatio="none" pointerEvents="none">
        {v.waterLine ? <Line x1={v.waterLine.x1} y1={v.waterLine.y} x2={v.waterLine.x2} y2={v.waterLine.y} stroke="#E4F6FF" strokeWidth="3" strokeLinecap="round" opacity="0.8" /> : null}
        {options.rain ? RAIN.map(([x, y], i) => <Path key={i} transform={`translate(${x} ${y})`} d="M0-20C7-9 11-2 11 4A11 11 0 0 1-11 4C-11-2-7-9 0-20Z" fill="#6FB9DE" opacity="0.9" />) : null}
      </Svg>

      {veil ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: `rgba(${veil.rgb.join(',')},${veil.a})` }} /> : null}

      {/* Fenêtres allumées (cabane finie) et fanion (cabane à toi) : au-dessus du voile, visibles la nuit aussi */}
      {v.windows.length || v.flags.length ? (
        <Svg style={{ position: 'absolute', left: 0, top: 0 }} width="100%" height="100%" viewBox={`0 0 ${FRAME_W} ${FRAME_H}`} preserveAspectRatio="none" pointerEvents="none">
          <Defs>
            <RadialGradient id={id('win')} cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor="#FFD98A" stopOpacity={moment === 'day' ? 0.45 : 0.8} /><Stop offset="1" stopColor="#FFC870" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          {v.windows.map((w, i) => (
            <G key={i}>
              <Circle cx={w.x + w.w / 2} cy={w.y + w.h / 2} r={w.w * 1.5} fill={`url(#${id('win')})`} />
              <Rect x={w.x} y={w.y} width={w.w} height={w.h} rx={w.w * 0.06} fill="#FFD36E" opacity={0.95} />
              <Line x1={w.x + w.w / 2} y1={w.y} x2={w.x + w.w / 2} y2={w.y + w.h} stroke="#7A5A3A" strokeWidth={w.w * 0.09} />
              <Line x1={w.x} y1={w.y + w.h / 2} x2={w.x + w.w} y2={w.y + w.h / 2} stroke="#7A5A3A" strokeWidth={w.w * 0.09} />
            </G>
          ))}
          {v.flags.map((fl, i) => (
            <G key={`flag${i}`}>
              <Line x1={fl.x} y1={fl.y} x2={fl.x} y2={fl.y - fl.h} stroke="#6E4E30" strokeWidth={fl.h * 0.07} strokeLinecap="round" />
              <Path d={`M${fl.x} ${fl.y - fl.h} L${fl.x + fl.h * 0.62} ${fl.y - fl.h * 0.82} L${fl.x} ${fl.y - fl.h * 0.62} Z`} fill="#F0B54A" stroke="#B07A1E" strokeWidth={fl.h * 0.03} strokeLinejoin="round" />
            </G>
          ))}
        </Svg>
      ) : null}

      {/* Au-dessus du voile : lune, lanternes allumées, Pépin qui dort */}
      {moment !== 'day' ? (
        <Svg style={{ position: 'absolute', left: 0, top: 0 }} width="100%" height="100%" viewBox={`0 0 ${FRAME_W} ${FRAME_H}`} preserveAspectRatio="none" pointerEvents="none">
          <Defs>
            <RadialGradient id={id('moon')} cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor="#E8EEFF" stopOpacity="0.55" /><Stop offset="1" stopColor="#E8EEFF" stopOpacity="0" />
            </RadialGradient>
            <RadialGradient id={id('lamp')} cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor="#FFE4A0" stopOpacity="0.95" /><Stop offset="0.4" stopColor="#FFC870" stopOpacity="0.45" /><Stop offset="1" stopColor="#FFC870" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          {moment === 'night' && options.sky !== false ? (
            <G>
              <Circle cx="800" cy="112" r="120" fill={`url(#${id('moon')})`} />
              <Circle cx="800" cy="112" r="40" fill="#F2F5FF" />
            </G>
          ) : null}
          {v.lights.map((l, i) => <Circle key={i} cx={l.cx} cy={l.cy} r={l.r} fill={`url(#${id('lamp')})`} />)}
          {v.sleepZ ? (
            <G opacity="0.9">
              <SvgText x={v.sleepZ.x} y={v.sleepZ.y} fontFamily="Nunito_800ExtraBold" fontWeight="800" fontSize="26" fill="#EEF2FF">z</SvgText>
              <SvgText x={v.sleepZ.x + 22} y={v.sleepZ.y - 26} fontFamily="Nunito_800ExtraBold" fontWeight="800" fontSize="34" fill="#EEF2FF">z</SvgText>
            </G>
          ) : null}
        </Svg>
      ) : null}

      {onPressPart
        ? [...scene.hotspots].sort((a, b) => STACK.indexOf(a.part) - STACK.indexOf(b.part)).map((h) => {
            const left = Math.max(0, h.x / FRAME_W), top = Math.max(0, h.y / FRAME_H);
            const width = Math.min(1 - left, h.w / FRAME_W), height = Math.min(1 - top, h.h / FRAME_H);
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
