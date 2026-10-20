/**
 * PICO — le coach du Jardin, en deux onglets, sans rien inventer :
 *   - « Ses remarques » (par défaut) : les messages du tableau de bord (Relyka et recommandations),
 *     produits par le moteur actuel (buildRelykaMessages / buildRecoMessages) ;
 *   - « Ta question » : les Conseils IA (Premium), l'écran existant intégré tel quel.
 * Le Bilan (Reporting) n'est plus proposé ici.
 */
import { useState } from 'react';
import GardenPage, { GardenGrid, GardenWaiting } from '../../components/garden/GardenPage';
import GardenButton from '../../components/garden/GardenButton';
import GardenSegmented from '../../components/garden/GardenSegmented';
import PicoBubble from '../../components/garden/PicoBubble';
import PicoRemark from '../../components/garden/PicoRemark';
import { ConseilsIaSection } from './conseils-ia';
import AdSlot from '../../components/marketing/AdSlot';
import { usePilotageCore } from '../../hooks/garden/usePilotageCore';

type PicoTab = 'remarks' | 'ask';

export default function PicoScreen() {
  const core = usePilotageCore();
  const [tab, setTab] = useState<PicoTab>('remarks');
  const [all, setAll] = useState(false);
  const messages = [...(core.vm.relykaMessages ?? []), ...(core.vm.recoMessages ?? [])].filter((m) => m.text);
  const shown = all ? messages : messages.slice(0, 3);

  const tabs = (
    <GardenSegmented<PicoTab>
      accessibilityLabel="Pépin"
      items={[{ key: 'remarks', label: 'Ses remarques' }, { key: 'ask', label: 'Ta question' }]}
      value={tab}
      onChange={setTab}
    />
  );

  /* L'écran des questions défile lui-même (et suit le clavier) : il prend le bas de la page. */
  if (tab === 'ask') return <GardenPage fill={<ConseilsIaSection />}>{tabs}</GardenPage>;

  return (
    <GardenPage>
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
