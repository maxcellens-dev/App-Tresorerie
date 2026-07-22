/**
 * La gestion des groupes est désormais intégrée à la page « Utilisateurs » (onglet Groupes).
 * On redirige tout accès à /admin/groups vers cette page unifiée.
 */
import { Redirect } from 'expo-router';

export default function AdminGroupsRedirect() {
  return <Redirect href={'/(tabs)/(secondary)/admin/users' as any} />;
}
