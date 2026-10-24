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
import GardenTip from '../../components/garden/GardenTip';
import AskPepin from '../../components/ai/AskPepin';
import AdSlot from '../../components/marketing/AdSlot';
import { View } from 'react-native';
import GardenCard from '../../components/garden/GardenCard';
import GardenText from '../../components/garden/GardenText';
import { useGardenModel } from '../../hooks/garden/useGardenModel';
import { CHOICE_LOOKS } from '../../lib/garden/choiceLooks';
import { formatEuros } from '../../lib/garden/picoChoices';
import { gardenRelykaZero } from '../../lib/garden/relykaWords';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';
import { WORDS } from '../../lib/garden/lexicon';

const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);

type PepinTab = 'remarks' | 'ask';

export default function PepinScreen() {
  const { core, choices } = useGardenModel();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<PepinTab>(params.tab === 'ask' ? 'ask' : 'remarks');
  useEffect(() => { if (params.tab === 'ask') setTab('ask'); }, [params.tab]);
  const [all, setAll] = useState(false);
  /* Ces phrases s'écrivaient SOUS le Relyka et ses quatre décisions : lues seules, « conserver ton
     Relyka » ou « Réserver » ne renvoyaient à rien. Deux remèdes : le Relyka et sa répartition sont
     rappelés en tête, et chaque remarque sur une décision porte le geste du Jardin et son montant. */
  const amountOf = (t: string) => choices.find((c) => c.type === t)?.amount ?? 0;
  /* Les remarques qui expliquent une reco du plan sont DÉPLIABLES sous cette reco, sur l'accueil :
     ici, seulement celles qui n'y figurent pas (Relyka, point bas, budget, reco absente du plan). */
  const inPlan = new Set(choices.filter((c) => c.amount > 0).map((c) => c.type as string));
  const messages = [...(core.vm.relykaMessages ?? []), ...(core.vm.recoMessages ?? [])].filter((m) => m.text && !(m.recoType && inPlan.has(m.recoType))).map((m) => {
    if (!m.recoType || !CHOICE_LOOKS[m.recoType]) return m;
    const amt = amountOf(m.recoType);
    return { ...m, label: amt > 0 ? `${CHOICE_LOOKS[m.recoType].verb} · ${eur(amt)}` : CHOICE_LOOKS[m.recoType].verb };
  });
  const zero = gardenRelykaZero(core.vm as any);
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
      {!core.ready ? <GardenWaiting message="Pépin regarde tes comptes…" /> : (
        <PicoBubble mood={messages.length ? 'joy' : 'happy'}>
          {messages.length
            ? `J'ai regardé tes comptes : ${messages.length} remarque${messages.length > 1 ? 's' : ''} pour toi, en plus de mon plan sur l'accueil.`
            : "Rien de particulier pour l'instant : tout suit son cours."}
        </PicoBubble>
      )}
      {/* Le conseil du jour, dit par Pépin (toujours affiché) */}
      {core.ready ? <GardenTip core={core} /> : null}
      {core.ready ? (
        <GardenCard tint={G.waterBg}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: GARDEN_SPACE.md }}>
            <GardenText variant="label" color={G.waterText} style={{ flex: 1 }}>{WORDS.relyka} ce mois-ci</GardenText>
            <GardenText variant="heading" color={G.ink} tabular>{zero?.word ?? eur(core.vm.relykaAffiche ?? 0)}</GardenText>
          </View>
          {choices.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GARDEN_SPACE.sm }}>
              {choices.map((c) => (
                <View key={c.type} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: GARDEN_RADII.pill, backgroundColor: CHOICE_LOOKS[c.type].bg }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: CHOICE_LOOKS[c.type].fill }} />
                  <GardenText variant="smallStrong" color={CHOICE_LOOKS[c.type].fg}>{CHOICE_LOOKS[c.type].verb} · {eur(c.amount)}</GardenText>
                </View>
              ))}
            </View>
          ) : null}
        </GardenCard>
      ) : null}
      {core.ready && messages.length ? <GardenGrid cols={2}>{shown.map((m) => <PicoRemark key={m.key} message={m as any} />)}</GardenGrid> : null}
      {messages.length > 3 ? <GardenButton label={all ? 'Voir moins' : `Voir les ${messages.length} remarques`} variant="secondary" onPress={() => setAll((v) => !v)} /> : null}
      <AdSlot placement="pepin" />
    </GardenPage>
  );
}
