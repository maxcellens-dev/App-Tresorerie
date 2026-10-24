/**
 * MES CRÉDITS (Jardin) — page à part, ouverte depuis Mon argent. Un achat immobilier peut compter
 * plusieurs crédits (prêt principal, prêt à taux zéro, prêt travaux…) : ils encombraient la liste
 * des comptes, comme le faisait déjà remarquer l'ancienne page Comptes, qui leur réservait un onglet.
 *
 * Pour chaque crédit : le reste à rembourser (capital restant dû, même calcul que la fiche crédit),
 * la part déjà remboursée (la cabane qui se construit), le taux. La fiche détaillée, l'échéancier
 * et l'ajout restent les écrans existants.
 */
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import GardenPage, { GardenGrid, GardenWaiting } from '../../../components/garden/GardenPage';
import GardenText from '../../../components/garden/GardenText';
import GardenCard from '../../../components/garden/GardenCard';
import GardenBar from '../../../components/garden/GardenBar';
import GardenButton from '../../../components/garden/GardenButton';
import PicoBubble from '../../../components/garden/PicoBubble';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useGardenModel } from '../../../hooks/garden/useGardenModel';
import { creditKind } from '../../../lib/garden/gardenInputs';
import { formatEuros } from '../../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL } from '../../../lib/finance/currency';
import { GARDEN_COLORS as G, GARDEN_SPACE } from '../../../lib/garden/theme';
import { TREE_PARTS } from '../../../lib/garden/lexicon';

const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);

export default function CreditsScreen() {
  const router = useRouter();
  const goBack = useNavBack();
  const { core, credits } = useGardenModel();
  const active = credits.filter((c) => c.remaining > 0);
  const total = active.reduce((s, c) => s + c.remaining, 0);

  return (
    <GardenPage calculator="comptes" secondary header={<ScreenHeader title="Mes crédits" onBack={goBack} />}>
      {!core.ready ? <GardenWaiting message="Tes crédits arrivent…" /> : active.length === 0 ? (
        <PicoBubble>Aucun crédit en cours. Si tu en as un (maison, voiture, travaux), ajoute-le : il apparaîtra comme une cabane qui se construit à chaque mensualité.</PicoBubble>
      ) : (
        <>
          <GardenCard>
            <GardenText variant="label">Il reste à rembourser</GardenText>
            <GardenText variant="amount" tabular>{eur(total)}</GardenText>
            <GardenText variant="small" color={G.inkSoft}>{active.length} crédit{active.length > 1 ? 's' : ''} en cours</GardenText>
          </GardenCard>
          <GardenGrid cols={2}>
            {active.map((c) => {
              const expensive = creditKind(c.rateAnnual) === 'expensive';
              const progress = c.principal > 0 ? Math.max(0, Math.min(1, 1 - c.remaining / c.principal)) : 0;
              return (
                <GardenCard key={c.id} onPress={() => router.push(`/(tabs)/comptes/credit/${c.id}` as any)} accessibilityLabel={`${c.label}, reste ${eur(c.remaining)}, remboursé à ${Math.round(progress * 100)} %`}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: GARDEN_SPACE.sm }}>
                    <GardenText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{c.label}</GardenText>
                    <GardenText variant="bodyStrong" tabular>{eur(c.remaining)}</GardenText>
                  </View>
                  <GardenBar value={progress} fill={expensive ? G.brambles : '#C9A57E'} track={expensive ? G.bramblesBg : G.pico} accessibilityLabel={`Remboursé à ${Math.round(progress * 100)} %`} />
                  <GardenText variant="small" color={G.inkSoft}>
                    Remboursé à {Math.round(progress * 100)} % · taux {c.rateAnnual.toLocaleString('fr-FR')} %{expensive ? ` · ${TREE_PARTS.brambles.name.toLowerCase()}` : ''}
                  </GardenText>
                </GardenCard>
              );
            })}
          </GardenGrid>
        </>
      )}
      {/* Même bouton que « Ajouter un compte » dans Mon argent (action offerte, sous la liste). */}
      <GardenButton label="Ajouter un crédit" variant="secondary" onPress={() => router.push('/(tabs)/comptes/credit-add' as any)} />
    </GardenPage>
  );
}
