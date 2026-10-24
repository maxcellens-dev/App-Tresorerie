/**
 * Le conseil du jour, DIT PAR PÉPIN sur sa page : « Pour toi » (déclenché par ta situation) d'abord,
 * puis « Le savais-tu ». Le catalogue et ses règles sont ceux de l'admin (hooks/pilotage/useConseils).
 * Toujours affiché (plus de réglage pour le couper) : c'est la voix de Pépin, pas une option.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import PicoBubble from './PicoBubble';
import GardenText from './GardenText';
import { GARDEN_COLORS as G } from '../../lib/garden/theme';
import { pointer } from '../../lib/ui/webLayout';
import { useConseilDuJour, interpolate } from '../../hooks/pilotage/useConseils';
import { useProjects } from '../../hooks/data/useProjects';
import { useTransactionMonthOverrides } from '../../hooks/data/useTransactionMonthOverrides';
import type { PilotageCore } from '../../hooks/garden/usePilotageCore';

export default function GardenTip({ core }: { core: PilotageCore }) {
  const { data: projects = [] } = useProjects(core.userId);
  const { data: monthOverrides = [] } = useTransactionMonthOverrides(core.userId);
  const tx = (core.txPerso ?? []).filter((t: any) => !t.credit_kind);
  const { general, contextuel, ready } = useConseilDuJour(core.userId, core.pilotageData, tx, projects, core.accounts, monthOverrides, core.vm.resteDisponibleBrut);
  const [index, setIndex] = useState(0);

  const tips = [
    ...(contextuel ? [{ id: contextuel.id, label: 'Pour toi', fg: G.branchesText, text: interpolate(contextuel.message, contextuel.vars) }] : []),
    ...(general ? [{ id: general.id, label: 'Le savais-tu ?', fg: G.picoText, text: general.message }] : []),
  ];
  if (!ready || !tips.length) return null;
  const tip = tips[Math.min(index, tips.length - 1)];

  return (
    <PicoBubble mood="thinking">
      <View style={{ gap: 4 }}>
        <GardenText variant="label" color={tip.fg}>Le conseil du jour · {tip.label}</GardenText>
        <GardenText variant="body">{tip.text}</GardenText>
        {tips.length > 1 ? (
          <Pressable onPress={() => setIndex((i) => (i + 1) % tips.length)} accessibilityRole="button" accessibilityLabel="Conseil suivant" style={[{ alignSelf: 'flex-start', paddingTop: 2 }, pointer]}>
            <GardenText variant="smallStrong" color={tip.fg}>Un autre conseil ›</GardenText>
          </Pressable>
        ) : null}
      </View>
    </PicoBubble>
  );
}
