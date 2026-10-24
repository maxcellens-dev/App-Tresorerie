/**
 * « Ajouter » : la MÊME liste fermée de gestes que la bulle « + » actuelle (dépense, recette,
 * virement, nouveau solde) et les mêmes écrans de saisie — un seul écran par geste. Ouverte par le
 * « + » de la barre du bas (téléphone) ou par le bouton de la colonne de gauche (bureau).
 */
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import GardenSheet from './GardenSheet';
import GardenCard from './GardenCard';
import GardenText from './GardenText';
import { GARDEN_COLORS, GARDEN_SPACE } from '../../lib/garden/theme';
import { WORDS } from '../../lib/garden/lexicon';

export const ADD_ACTIONS: { key: string; label: string; hint: string; route: string; color: string }[] = [
  { key: 'expense', label: 'Dépense', hint: 'courses, sorties, une facture…', route: '/(tabs)/transactions/add?type=expense&origin=/(tabs)/jardin', color: GARDEN_COLORS.flowers },
  { key: 'income', label: 'Recette', hint: 'salaire, remboursement, vente…', route: '/(tabs)/transactions/add?type=income&origin=/(tabs)/jardin', color: GARDEN_COLORS.branches },
  { key: 'transfer', label: 'Virement', hint: 'entre tes comptes', route: '/(tabs)/transactions/add?type=transfer&origin=/(tabs)/jardin', color: GARDEN_COLORS.water },
  { key: 'recurring', label: 'Ce qui revient', hint: 'salaire, loyer, abonnements… prévus automatiquement', route: '/(tabs)/(secondary)/recurrentes', color: GARDEN_COLORS.primary },
  { key: 'balance', label: 'Mettre à jour le solde de mes comptes', hint: "corriger le solde d'un compte", route: '/(tabs)/comptes/solde', color: GARDEN_COLORS.roots },
];

export default function GardenAddSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  return (
    <GardenSheet visible={visible} onClose={onClose} title="Ajouter" subtitle="Pas besoin de tout noter : mettre tes soldes à jour rattrape ce qui manque.">
      {ADD_ACTIONS.map((a) => (
        <GardenCard key={a.key} onPress={() => { onClose(); setTimeout(() => router.push(a.route as any), 60); }} accessibilityLabel={a.label} style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
          <View style={{ width: 14, height: 40, borderRadius: 7, backgroundColor: a.color }} />
          <View style={{ flex: 1 }}>
            <GardenText variant="bodyStrong">{a.label}</GardenText>
            <GardenText variant="small" color={GARDEN_COLORS.muted}>{a.hint}</GardenText>
          </View>
        </GardenCard>
      ))}
    </GardenSheet>
  );
}
