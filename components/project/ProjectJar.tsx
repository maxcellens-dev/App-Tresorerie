/**
 * Le bocal d'un projet, REMPLI DE RELYKS : des pièces (la même que l'icône de la monnaie, frappée
 * d'un R) s'empilent avec l'avancement ; plein et doré une fois l'objectif atteint. Purement visuel
 * (l'avancement vient du Pilotage, projects_with_progress) ; annoncé en clair aux lecteurs d'écran.
 */
import Svg, { Circle, ClipPath, Defs, G as SvgG, Path, Rect } from 'react-native-svg';
import { R_PATH } from '../gamification/CurrencyIcon';
import { GARDEN_COLORS as G } from '../../lib/garden/theme';

/* Le verre du bocal, dans un repère 0..80 × 0..100. */
const JAR = 'M16 20 h48 a8 8 0 0 1 8 8 v54 a12 12 0 0 1 -12 12 h-40 a12 12 0 0 1 -12 -12 v-54 a8 8 0 0 1 8 -8z';
const TOP = 24, BOTTOM = 94, COIN_R = 8.5, ROW_H = 11.5;

/** Les pièces jusqu'au niveau atteint : rangées de 4 (ou 3, décalées), du fond vers le haut. Pure. */
export function jarCoins(pct: number): { x: number; y: number }[] {
  const p = Math.max(0, Math.min(100, pct));
  const level = BOTTOM - ((BOTTOM - TOP) * p) / 100;
  const coins: { x: number; y: number }[] = [];
  for (let row = 0, y = BOTTOM - COIN_R + 1; y - COIN_R * 0.4 >= level && y > TOP; row++, y -= ROW_H) {
    const xs = row % 2 === 0 ? [21, 34, 47, 60] : [27.5, 40.5, 53.5];
    for (const x of xs) coins.push({ x, y });
  }
  return coins;
}

export default function ProjectJar({ pct, size = 56 }: { pct: number; size?: number }) {
  const p = Math.max(0, Math.min(100, pct));
  const done = p >= 100;
  const coins = jarCoins(p);
  const id = `jar-${Math.round(p)}-${size}`;
  return (
    <Svg width={size} height={size * 1.25} viewBox="0 0 80 100" accessibilityRole="image" accessibilityLabel={done ? 'Objectif atteint' : `Rempli à ${Math.round(p)} %`}>
      <Defs>
        <ClipPath id={id}><Path d={JAR} /></ClipPath>
      </Defs>
      <Rect x={20} y={4} width={40} height={11} rx={4} fill="#8A5A30" />
      <Path d={JAR} fill={done ? G.rootsBg : G.field} stroke={done ? G.roots : G.line} strokeWidth={2} />
      <SvgG clipPath={`url(#${id})`}>
        {coins.map((c, i) => (
          <SvgG key={i}>
            <Circle cx={c.x} cy={c.y + 1} r={COIN_R} fill="#C98A1E" />
            <Circle cx={c.x} cy={c.y} r={COIN_R} fill="#F2B53A" />
            {/* Le R de la pièce (repère 24 × 24 ramené au diamètre de la pièce) */}
            <Path d={R_PATH} fill="#9A6510" transform={`translate(${c.x - COIN_R * 0.85} ${c.y - COIN_R * 0.95}) scale(${(COIN_R * 1.7) / 24})`} />
          </SvgG>
        ))}
      </SvgG>
      {done ? <Path d="M40 6l1.8 3.7 4 .5-3 2.8.8 4-3.6-2-3.6 2 .8-4-3-2.8 4-.5z" fill="#F2B53A" /> : null}
    </Svg>
  );
}
