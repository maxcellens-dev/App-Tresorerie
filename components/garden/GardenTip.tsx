/**
 * Le conseil du jour, en bas de la page Jardin : « Pour toi » (déclenché par ta situation) d'abord,
 * puis « Le savais-tu ». Le catalogue et ses règles sont ceux de l'admin (hooks/pilotage/useConseils).
 * Fermer un conseil le masque pour la journée. Se coupe dans les Paramètres (« Le conseil du jour »).
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GardenCard from './GardenCard';
import GardenText from './GardenText';
import { GARDEN_COLORS as G, GARDEN_SPACE } from '../../lib/garden/theme';
import { pointer } from '../../lib/ui/webLayout';
import { useConseilDuJour, interpolate } from '../../hooks/pilotage/useConseils';
import { usePilotageTips } from '../../hooks/config/useUiPrefs';
import { useProjects } from '../../hooks/data/useProjects';
import { useTransactionMonthOverrides } from '../../hooks/data/useTransactionMonthOverrides';
import type { PilotageCore } from '../../hooks/garden/usePilotageCore';

export default function GardenTip({ core }: { core: PilotageCore }) {
  const { enabled } = usePilotageTips(core.userId);
  const { data: projects = [] } = useProjects(core.userId);
  const { data: monthOverrides = [] } = useTransactionMonthOverrides(core.userId);
  const tx = (core.txPerso ?? []).filter((t: any) => !t.credit_kind);
  const { general, contextuel, dismiss, ready } = useConseilDuJour(core.userId, core.pilotageData, tx, projects, core.accounts, monthOverrides, core.vm.resteDisponibleBrut);
  const [index, setIndex] = useState(0);

  const tips = [
    ...(contextuel ? [{ id: contextuel.id, label: 'Pour toi', icon: 'leaf-outline', fg: G.branchesText, bg: G.branchesBg, text: interpolate(contextuel.message, contextuel.vars) }] : []),
    ...(general ? [{ id: general.id, label: 'Le savais-tu ?', icon: 'bulb-outline', fg: G.picoText, bg: G.pico, text: general.message }] : []),
  ];
  if (!enabled || !ready || !tips.length) return null;
  const tip = tips[Math.min(index, tips.length - 1)];

  return (
    <GardenCard tint={tip.bg}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.sm }}>
        <Ionicons name={tip.icon as any} size={16} color={tip.fg} />
        <GardenText variant="label" color={tip.fg} style={{ flex: 1 }}>Le conseil du jour · {tip.label}</GardenText>
        <Pressable onPress={() => dismiss(tip.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Masquer ce conseil pour aujourd'hui" style={pointer}>
          <Ionicons name="close" size={18} color={tip.fg} />
        </Pressable>
      </View>
      <GardenText variant="body">{tip.text}</GardenText>
      {tips.length > 1 ? (
        <Pressable onPress={() => setIndex((i) => (i + 1) % tips.length)} accessibilityRole="button" accessibilityLabel="Conseil suivant" style={[{ alignSelf: 'flex-start' }, pointer]}>
          <GardenText variant="smallStrong" color={tip.fg}>Un autre conseil ›</GardenText>
        </Pressable>
      ) : null}
    </GardenCard>
  );
}
