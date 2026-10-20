/**
 * Ce que porte la navigation du Jardin, quelle que soit sa forme (barre du bas sur téléphone,
 * colonne de gauche sur bureau) : la synchro EN DIRECT des comptes et crédits partagés, et le compte
 * des invitations en attente par onglet. Repris de CustomTabBar / WebSideNav : sans eux, passer au
 * Jardin couperait ces mises à jour. Un seul des deux composants est monté à la fois.
 */
import { useAuth } from '../../contexts/AuthContext';
import { useRwInvitations } from '../engagement/useRelykaWorld';
import { useAccountInvitations, useSharedAccountsRealtime } from '../data/useSharedAccounts';
import { useCreditInvitations, useSharedCreditsRealtime } from '../data/useSharedCredits';

export function useGardenNavBadges(): Record<string, number> {
  const { user } = useAuth();
  const { data: rwInvitations = [] } = useRwInvitations(user?.id);
  const { data: acctInvitations = [] } = useAccountInvitations(user?.id);
  const { data: creditInvitations = [] } = useCreditInvitations(user?.id);
  useSharedAccountsRealtime(user?.id);
  useSharedCreditsRealtime(user?.id);
  return { projets: rwInvitations.length, argent: acctInvitations.length + creditInvitations.length };
}
