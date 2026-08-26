/**
 * /notifications — ROUTE HÉRITÉE, conservée uniquement pour les anciens liens.
 *
 * ── POURQUOI CET ÉCRAN N'EXISTE PLUS ────────────────────────────────────────────────────────────
 * C'était un second réglage de notifications, atteignable par l'adresse seule (plus aucun menu n'y
 * menait). Il portait exactement le défaut que la page Paramètres a corrigé depuis : son
 * interrupteur ne lisait que `profiles.notifications_enabled`, c'est-à-dire ce que l'utilisateur
 * SOUHAITE. Quelqu'un ayant refusé l'autorisation au niveau d'Android ou d'iOS voyait donc un
 * interrupteur allumé et ne recevait jamais rien — et il s'affichait aussi sur le web, où les
 * notifications système n'existent pas du tout.
 *
 * Deux écrans pour un même réglage, dont un qui ment : on garde l'adresse, on la renvoie vers le
 * seul endroit qui dit la vérité (Paramètres → Notifications).
 */
import { Redirect } from 'expo-router';

export default function NotificationsRedirect() {
  // `Redirect` et non `router.replace` dans un effet : la redirection part au premier rendu, sans
  // qu'un écran vide n'apparaisse au passage.
  return <Redirect href="/(tabs)/(secondary)/parametres" />;
}
