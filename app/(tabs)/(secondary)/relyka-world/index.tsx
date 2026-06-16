/**
 * Relyka World n'a plus d'écran liste dédié : les projets partagés s'affichent
 * dans la page « Projets ». Toute navigation vers /relyka-world y est redirigée.
 */
import { Redirect } from 'expo-router';

export default function RelykaWorldIndexRedirect() {
  return <Redirect href={'/(tabs)/projects' as any} />;
}
