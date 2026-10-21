/**
 * Ancienne adresse des Conseils IA : les questions se posent désormais dans l'onglet Pépin
 * (« Ta question », components/ai/AskPepin). Cette route ne sert plus qu'aux anciens liens
 * (notifications de réponse, page Premium, favoris).
 */
import { Redirect } from 'expo-router';

export default function ConseilsIaRoute() {
  return <Redirect href={'/(tabs)/pepin?tab=ask' as any} />;
}
