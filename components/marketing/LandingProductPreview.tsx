import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Line, Circle } from 'react-native-svg';
import type { LandingConfig } from '../../hooks/config/useLandingConfig';
import type { LandingColors } from './landingTheme';

/** Illustrative public preview; no financial hooks or personal data. */
export default function LandingProductPreview({ cfg, colors: c, compact = false, kind = 'projection' }: {
  cfg: LandingConfig; colors: LandingColors; compact?: boolean; kind?: 'projection' | 'budget';
}) {
  const p = cfg.presentation;
  const s = StyleSheet.create({
    window: { width: '100%', backgroundColor: c.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: c.line },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 20, borderBottomWidth: 1, borderBottomColor: c.line },
    brand: { fontSize: 14, fontWeight: '700', color: c.ink },
    tiny: { fontSize: 12, lineHeight: 18, color: c.muted },
    body: { padding: compact ? 22 : 30, gap: 20 },
    label: { fontSize: 14, lineHeight: 20, color: c.muted },
    amount: { fontSize: compact ? 36 : 44, lineHeight: compact ? 44 : 54, letterSpacing: -1.5, fontWeight: '600', color: c.ink },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    icon: { padding: 10, borderRadius: 10, backgroundColor: c.soft },
    divider: { height: 1, backgroundColor: c.line },
    positive: { color: c.positive, fontSize: 16, fontWeight: '600' },
    project: { backgroundColor: c.soft, padding: 22, gap: 14, borderRadius: 12 },
    track: { height: 6, borderRadius: 3, backgroundColor: c.line, overflow: 'hidden' },
    caption: { fontSize: 11, lineHeight: 16, color: c.muted, paddingHorizontal: 20, paddingBottom: 16 },
  });
  return <View style={s.window}>
    <View style={s.top}>
      <View style={s.row}><Ionicons name={kind === 'projection' ? 'analytics-outline' : 'wallet-outline'} size={18} color={c.positive} /><Text style={s.brand}>{kind === 'projection' ? p.projectionTitle : p.budgetLabel}</Text></View>
      {!compact && <Text style={s.tiny}>{p.projectionPeriod}</Text>}
    </View>
    <View style={s.body}>
      <View><Text style={s.label}>{kind === 'projection' ? cfg.heroBalanceLabel : p.budgetCaption}</Text><Text style={s.amount}>{kind === 'projection' ? cfg.heroBalanceValue : p.budgetValue}</Text></View>
      {kind === 'projection' ? <>
        <View accessibilityLabel="Illustration de projection de solde" accessibilityRole="image">
          <Svg width="100%" height={compact ? 116 : 152} viewBox="0 0 400 152">
            {[25, 75, 125].map(y => <Line key={y} x1="0" x2="400" y1={y} y2={y} stroke={c.line} strokeDasharray="3 5" />)}
            <Path d="M0 120 L42 108 L86 116 L130 72 L173 88 L218 62 L259 78 L304 36 L350 46 L395 18 L395 150 L0 150 Z" fill={c.soft} />
            <Path d="M0 120 L42 108 L86 116 L130 72 L173 88 L218 62 L259 78 L304 36 L350 46 L395 18" fill="none" stroke={c.positive} strokeWidth="3" strokeLinejoin="round" />
            <Circle cx="395" cy="18" r="5" fill={c.positive} />
          </Svg>
        </View>
        <View style={s.divider} />
        <View style={s.row}><View style={s.icon}><Ionicons name="arrow-down-outline" size={18} color={c.positive} /></View><View style={{ flex: 1 }}><Text style={s.brand}>{cfg.heroTxLabel}</Text><Text style={s.tiny}>{p.transactionDate}</Text></View><Text style={s.positive}>{cfg.heroTxAmount}</Text></View>
      </> : <View style={s.project}>
        <View style={s.row}><Ionicons name="flag-outline" size={20} color={c.positive} /><Text style={[s.brand, { flex: 1 }]}>{p.projectLabel}</Text></View>
        <Text style={s.positive}>{p.projectValue}</Text>
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.max(0, Math.min(100, p.projectProgress)) }} style={s.track}><View style={{ width: `${Math.max(0, Math.min(100, p.projectProgress))}%`, height: 6, backgroundColor: c.positive }} /></View>
      </View>}
    </View>
    <Text style={s.caption}>{p.previewLabel}</Text>
  </View>;
}
