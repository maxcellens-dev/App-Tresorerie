/**
 * DÉMARRER — « Plante ton arbre » (refonte Jardin, phase 8).
 *
 * Pas de questionnaire : comme dans l'app actuelle, le démarrage consiste à installer de VRAIES
 * données (comptes avec leur solde du jour, puis ce qui revient chaque mois), et l'arbre se dessine
 * à partir d'elles. Les étapes et leur état viennent du moteur existant (computeSetupState) ; chaque
 * étape ouvre l'écran qui sert déjà à la faire.
 */
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import GardenPage, { GardenColumns } from '../../../components/garden/GardenPage';
import GardenText from '../../../components/garden/GardenText';
import GardenCard from '../../../components/garden/GardenCard';
import GardenScene from '../../../components/garden/GardenScene';
import PicoBubble from '../../../components/garden/PicoBubble';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useGardenModel } from '../../../hooks/garden/useGardenModel';
import { GARDEN_COLORS, GARDEN_SPACE } from '../../../lib/garden/theme';
import { TREE_PARTS } from '../../../lib/garden/lexicon';

export default function DemarrerScreen() {
  const router = useRouter();
  const goBack = useNavBack();
  const { core, tree } = useGardenModel();
  const { vm } = core;
  const accounts = core.accountsPerso as any[];
  const hasChecking = accounts.some((a) => a.type === 'checking');
  const hasSavings = accounts.some((a) => a.type === 'savings' || a.type === 'investment');

  const steps = [
    { done: hasChecking, title: `Ton ${TREE_PARTS.can.name.toLowerCase()}`, text: 'Ajoute ton compte courant avec le solde affiché par ta banque aujourd\'hui.', route: '/(tabs)/comptes/add' },
    { done: hasSavings, title: `Tes ${TREE_PARTS.roots.name.toLowerCase()}`, text: 'Ajoute ton livret ou tes placements, même avec un petit montant. Facultatif.', route: '/(tabs)/comptes/add' },
    { done: !!vm.hasRecurringTx, title: 'Ce qui revient chaque mois', text: 'Ton salaire et tes charges fixes (loyer, abonnements), en opérations récurrentes.', route: '/(tabs)/transactions/add' },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <GardenPage secondary header={<ScreenHeader title="Plante ton arbre" onBack={goBack} />}>
      <GardenColumns left={<GardenScene state={tree} options={{ id: 'start', marks: false, mood: doneCount === steps.length ? 'joy' : 'happy' }} />} right={<>
      <PicoBubble>{doneCount === steps.length ? "Ton jardin est planté ! Ton Relyka et ton arbre se calculent maintenant tout seuls." : "Pas de questionnaire : on part de tes vrais comptes. Trois étapes, et ton arbre se dessine tout seul."}</PicoBubble>
      {steps.map((s, i) => (
        <GardenCard key={s.title} onPress={s.done ? undefined : () => router.push(s.route as any)} tint={s.done ? GARDEN_COLORS.branchesBg : undefined} accessibilityLabel={`${s.title} : ${s.done ? 'fait' : 'à faire'}`}
          style={{ flexDirection: 'row', gap: GARDEN_SPACE.md, alignItems: 'flex-start' }}>
          <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: s.done ? GARDEN_COLORS.primary : GARDEN_COLORS.track }}>
            <GardenText variant="smallStrong" color={s.done ? GARDEN_COLORS.onPrimary : GARDEN_COLORS.inkSoft}>{s.done ? '✓' : String(i + 1)}</GardenText>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <GardenText variant="bodyStrong">{s.title}</GardenText>
            <GardenText variant="small" color={GARDEN_COLORS.inkSoft}>{s.text}</GardenText>
          </View>
        </GardenCard>
      ))}
      </>} />
    </GardenPage>
  );
}
