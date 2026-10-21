/**
 * Ancienne page Projection : sa trésorerie vit dans « Mon argent › Demain », ses placements dans
 * « Mes placements » (components/money/ProjectionSection). Ne sert plus qu'aux anciens liens.
 */
import { Redirect } from 'expo-router';

export default function ProjectionRoute() {
  return <Redirect href={'/(tabs)/argent?view=tomorrow' as any} />;
}
