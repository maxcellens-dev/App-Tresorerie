/**
 * Ancienne page « Profil financier », fusionnée dans « Mon parcours » : redirige les anciens liens.
 */
import { Redirect } from 'expo-router';

export default function ProfilFinancierRoute() {
  return <Redirect href="/(tabs)/(secondary)/parcours" />;
}
