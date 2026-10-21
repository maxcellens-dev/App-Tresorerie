/**
 * PÉPIN — le coach du Jardin, en deux onglets, sans rien inventer :
 *   - « Ses remarques » (par défaut) : les messages du moteur (Relyka et recommandations,
 *     buildRelykaMessages / buildRecoMessages) ;
 *   - « Ta question » : tes questions et ses analyses (Conseils IA, components/ai/AskPepin).
 * `?tab=ask` ouvre directement « Ta question » (anciens liens /conseils-ia, notifications).
 */
import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import GardenPage, { GardenGrid, GardenWaiting } from '../../components/garden/GardenPage';
import GardenButton from '../../components/garden/GardenButton';
import GardenSegmented from '../../components/garden/GardenSegmented';
import PicoBubble from '../../components/garden/PicoBubble';
import PicoRemark from '../../components/garden/PicoRemark';
import AskPepin from '../../components/ai/AskPepin';
import AdSlot from '../../components/marketing/AdSlot';
import { usePilotageCore } from '../../hooks/garden/usePilotageCore';

type PepinTab = 'remarks' | 'ask';

export default function PepinScreen() {
  const core = usePilotageCore();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<PepinTab>(params.tab === 'ask' ? 'ask' : 'remarks');
  useEffect(() => { if (params.tab === 'ask') setTab('ask'); }, [params.tab]);
  const [all, setAll] = useState(false);
  const messages = [...(core.vm.relykaMessages ?? []), ...(core.vm.recoMessages ?? [])].filter((m) => m.text);
  const shown = all ? messages : messages.slice(0, 3);

  const tabs = (
    <GardenSegmented<PepinTab>
      accessibilityLabel="Pépin"
      items={[{ key: 'remarks', label: 'Ses remarques' }, { key: 'ask', label: 'Ta question' }]}
      value={tab}
      onChange={setTab}
    />
  );

  /* L'écran des questions défile lui-même (et suit le clavier) : il prend le bas de la page. */
  if (tab === 'ask') return <GardenPage calculator="pepin" fill={<AskPepin />}>{tabs}</GardenPage>;

  return (
    <GardenPage calculator="pepin">
      {tabs}
      {!core.ready ? <GardenWaiting message="Pépin fait le tour du jardin…" /> : (
        <PicoBubble mood={messages.length ? 'joy' : 'happy'}>
          {messages.length
            ? `J'ai fait le tour de ton jardin : ${messages.length} remarque${messages.length > 1 ? 's' : ''} pour toi.`
            : "Rien de particulier pour l'instant : ton jardin suit son cours."}
        </PicoBubble>
      )}
      {core.ready && messages.length ? <GardenGrid cols={2}>{shown.map((m) => <PicoRemark key={m.key} message={m as any} />)}</GardenGrid> : null}
      {messages.length > 3 ? <GardenButton label={all ? 'Voir moins' : `Voir les ${messages.length} remarques`} variant="secondary" onPress={() => setAll((v) => !v)} /> : null}
      <AdSlot placement="pepin" />
    </GardenPage>
  );
}
