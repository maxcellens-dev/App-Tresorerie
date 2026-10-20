/**
 * Ancienne adresse du tableau de bord (Pilotage). L'app est désormais le Jardin : cette route ne
 * sert plus qu'à rediriger les anciens liens (notifications, favoris, raccourcis).
 */
import { Redirect } from 'expo-router';

export default function PilotageRoute() {
  return <Redirect href="/(tabs)/jardin" />;
}
