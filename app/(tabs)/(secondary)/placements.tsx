/**
 * MES PLACEMENTS (Jardin) — la section « Investissement » de la Projection, rangée près des
 * branches : ouverte depuis Mon argent (ligne Mes placements) et depuis la feuille des branches.
 * L'écran est celui de la Projection, tel quel (même calcul) : il défile lui-même.
 */
import { View } from 'react-native';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import CalculatorButton from '../../../components/transaction/CalculatorButton';
import { ProjectionSection } from '../../../components/money/ProjectionSection';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { GARDEN_COLORS } from '../../../lib/garden/theme';

export default function PlacementsScreen() {
  const goBack = useNavBack();
  return (
    <View style={{ flex: 1, backgroundColor: GARDEN_COLORS.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><ScreenHeader title="Mes placements" onBack={goBack} /></View>
      <View style={{ flex: 1 }}><ProjectionSection section="invest" /></View>
      <CalculatorButton page="placements" />
    </View>
  );
}
