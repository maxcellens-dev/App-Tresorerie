/**
 * Pictogrammes des articles du jardin en boutique (décor, garde-robe de Pépin, saisons).
 * Une icône d'article vaut `garden:<nom>` dans le catalogue ; `isGardenIcon` le reconnaît.
 * Dessinés dans le même esprit que la scène (volumes doux, couleurs naturelles).
 */
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

export const isGardenIcon = (icon?: string | null) => !!icon && icon.startsWith('garden:');

export default function GardenItemIcon({ icon, size = 40 }: { icon: string; size?: number }) {
  const name = icon.replace(/^garden:/, '');
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {name === 'lantern' ? (<>
        <Circle cx={32} cy={34} r={22} fill="#FFE2A0" opacity={0.35} />
        <Path d="M32 6V14" stroke="#3A2A1E" strokeWidth={2} />
        <Path d="M22 18H42L38 13H26Z" fill="#2E2A26" />
        <Rect x={24} y={18} width={16} height={24} rx={3} fill="#FBE3A0" stroke="#2E2A26" strokeWidth={2.4} />
        <Path d="M22 42H42L38 48H26Z" fill="#2E2A26" />
      </>) : null}
      {name === 'birdhouse' ? (<>
        <Path d="M12 28L32 12L52 28Z" fill="#9E4A30" />
        <Rect x={17} y={28} width={30} height={22} fill="#C9A27A" />
        <Path d="M17 35H47M17 42H47" stroke="#A47A50" strokeWidth={1} />
        <Circle cx={32} cy={37} r={5} fill="#2E2014" />
        <Path d="M32 50V60" stroke="#5E4129" strokeWidth={3} />
      </>) : null}
      {name === 'bench' ? (<>
        <Ellipse cx={32} cy={56} rx={24} ry={3} fill="#1E1A12" opacity={0.18} />
        <Rect x={8} y={18} width={48} height={6} rx={2} fill="#C9A27A" />
        <Rect x={8} y={30} width={48} height={6} rx={2} fill="#B98A5E" />
        <Rect x={8} y={40} width={48} height={6} rx={2} fill="#B98A5E" />
        <Path d="M13 46V56M51 46V56M13 24V30M51 24V30" stroke="#4A3220" strokeWidth={3} />
      </>) : null}
      {name === 'mushrooms' ? (<>
        <Path d="M24 54V38" stroke="#F1E6D2" strokeWidth={8} strokeLinecap="round" />
        <Path d="M10 40Q24 14 38 40Z" fill="#C7432F" />
        <Circle cx={20} cy={30} r={2.4} fill="#FFF" /><Circle cx={28} cy={26} r={2} fill="#FFF" />
        <Path d="M44 56V46" stroke="#F1E6D2" strokeWidth={6} strokeLinecap="round" />
        <Path d="M36 48Q44 34 52 48Z" fill="#D25A3A" />
      </>) : null}
      {name === 'fence' ? (<>
        <Path d="M6 30H58M6 44H58" stroke="#B48E62" strokeWidth={4} />
        {[8, 22, 36, 50].map((x) => <Path key={x} d={`M${x} 56V18L${x + 3} 14L${x + 6} 18V56Z`} fill="#E3C9A2" stroke="#A9865E" strokeWidth={1} />)}
      </>) : null}
      {name === 'pond' ? (<>
        <Ellipse cx={32} cy={40} rx={26} ry={12} fill="#5E8FA6" />
        <Ellipse cx={32} cy={39} rx={21} ry={8} fill="#7CC3E6" />
        <Ellipse cx={24} cy={36} rx={7} ry={1.6} fill="#FFFFFF" opacity={0.6} />
        <Circle cx={44} cy={39} r={4.5} fill="#5E9A4E" />
      </>) : null}
      {name === 'scarf_red' ? (<>
        <Path d="M10 22Q32 36 54 22L56 31Q32 45 8 31Z" fill="#C0503F" />
        <Path d="M22 31L15 56Q21 58 27 54L30 33Z" fill="#93392C" />
        <Path d="M12 26Q32 38 52 26" stroke="#E07A68" strokeWidth={1.2} fill="none" opacity={0.7} />
      </>) : null}
      {name === 'straw_hat' ? (<>
        <Ellipse cx={32} cy={42} rx={27} ry={8} fill="#D9B46A" />
        <Path d="M17 42Q18 18 32 18Q46 18 47 42Z" fill="#E7C985" />
        <Path d="M18 35H46" stroke="#4C8B5E" strokeWidth={5} />
      </>) : null}
      {name === 'sunglasses' ? (<>
        <Circle cx={20} cy={32} r={11} fill="#1E2A30" />
        <Circle cx={44} cy={32} r={11} fill="#1E2A30" />
        <Path d="M31 31H33M9 30L4 27M55 30L60 27" stroke="#1E1E1E" strokeWidth={3} strokeLinecap="round" />
        <Path d="M14 27L20 25" stroke="#FFFFFF" strokeWidth={2} opacity={0.5} strokeLinecap="round" />
      </>) : null}
      {name === 'boots' ? (<>
        <Path d="M10 16H22V42H30Q34 42 34 50H10Z" fill="#E2B93A" />
        <Path d="M32 16H44V42H52Q56 42 56 50H32Z" fill="#D2A92A" />
        <Path d="M10 22H22M32 22H44" stroke="#B8901F" strokeWidth={2} />
      </>) : null}
      {name.startsWith('season_') ? (() => {
        const se = name.slice(7);
        const bg = se === 'spring' ? '#E6F2DD' : se === 'summer' ? '#DCEEF7' : se === 'autumn' ? '#F4E3CC' : '#E8EEF2';
        const leaf = se === 'spring' ? '#7DBF5E' : se === 'summer' ? '#3A7E3A' : se === 'autumn' ? '#D9842A' : '#356D37';
        return (<>
          <Rect x={4} y={4} width={56} height={56} rx={14} fill={bg} />
          <Path d="M30 52V36" stroke="#6E5038" strokeWidth={4} strokeLinecap="round" />
          <Circle cx={32} cy={28} r={15} fill={leaf} />
          {se === 'spring' ? <><Circle cx={26} cy={24} r={2.6} fill="#FFFFFF" /><Circle cx={36} cy={30} r={2.6} fill="#F9D3E1" /><Circle cx={33} cy={20} r={2.2} fill="#FFFFFF" /></> : null}
          {se === 'summer' ? <Circle cx={50} cy={14} r={6} fill="#FFE07A" /> : null}
          {se === 'autumn' ? <><Path d="M14 12l-2 7M22 8l-2 7M46 10l-2 7" stroke="#8FA3B0" strokeWidth={1.4} strokeLinecap="round" /><Ellipse cx={46} cy={52} rx={4} ry={1.8} fill="#C2621F" /></> : null}
          {se === 'winter' ? <><Ellipse cx={32} cy={17} rx={12} ry={4} fill="#FFFFFF" /><Circle cx={12} cy={14} r={1.6} fill="#FFFFFF" /><Circle cx={50} cy={22} r={1.6} fill="#FFFFFF" /><Circle cx={46} cy={10} r={1.2} fill="#FFFFFF" /></> : null}
        </>);
      })() : null}
    </Svg>
  );
}
