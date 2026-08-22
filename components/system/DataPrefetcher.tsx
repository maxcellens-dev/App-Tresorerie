/**
 * DataPrefetcher — chauffe EN ARRIÈRE-PLAN les caches react-query des onglets pas encore visités,
 * pour que CHAQUE page s'ouvre instantanément (cache d'abord, refetch silencieux ensuite).
 *
 * Monté à la racine. Attend que le démarrage ait respiré (interactions finies + petit délai) avant
 * de monter les hooks : le préchargement ne doit JAMAIS concurrencer le premier écran.
 *
 * Déjà chauds par ailleurs (usePulse / PulseDeltaHost / PilotagePrefetch / GamificationSync, montés
 * à la racine) : pilotage_data, transactions perso, accounts, projects, preSavings, reservations,
 * profil financier, configs, gamification (état/succès/inventaire → pages Succès et Boutique).
 * Ici : ce que SEULS les autres onglets chargeaient à leur 1ʳᵉ ouverture.
 *
 * DEUX VAGUES. La 1ʳᵉ couvre les onglets principaux. La 2ᵉ, plus tardive, couvre des pages moins
 * fréquentées (projets partagés, Conseils IA) : les y mettre avec les autres ferait partir une
 * douzaine de requêtes d'un coup, ce qui ralentirait justement ce qu'on cherche à accélérer.
 */
import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useAllTransactions } from '../../hooks/data/useTransactions';
import { useCategories } from '../../hooks/data/useCategories';
import { useCredits } from '../../hooks/data/useCredits';
import { useAllCreditEvents } from '../../hooks/data/useCreditEvents';
import { useTransactionMonthOverrides } from '../../hooks/data/useTransactionMonthOverrides';
import { useSharedContribution } from '../../hooks/data/useSharedContribution';
import { useCurrencyRates } from '../../hooks/data/useCurrencyRates';
import { useRwProjects, useRwInvitations, useRwProjectsStats } from '../../hooks/engagement/useRelykaWorld';
import { useAiConfig, useAiQuota, useAiAnalyses, useAiConversations } from '../../hooks/admin/useAi';

/** Monte les hooks de données → react-query remplit son cache ; ne rend rien. */
function Warm({ userId }: { userId: string }) {
  useAllTransactions(userId);        // liste Transactions + détail de compte
  useCategories(userId);             // filtres + saisie
  useCredits(userId);                // tréso / projection / onglet Crédits
  useAllCreditEvents(userId);
  useTransactionMonthOverrides(userId);
  useSharedContribution(userId);     // tréso / projection / reporting
  useCurrencyRates();
  /* Projets PARTAGÉS : remontés de la 2ᵉ vague à la 1ʳᵉ. La page Projets affiche ses projets perso
     immédiatement (ils viennent du cache du Pilotage) : attendre 3,5 s pour lancer la requête des
     projets partagés garantissait que la page arrive en deux temps sous les yeux de l'utilisateur.
     Depuis la migration 178 c'est UN seul aller-retour (rw_my_projects), donc le coût de la
     remonter est négligeable. Les stats, plus lourdes, restent en 2ᵉ vague. */
  useRwProjects(userId);
  return null;
}

/**
 * 2ᵉ vague — pages secondaires dont AUCUNE donnée n'était chaude, d'où un chargement visible à
 * chaque première ouverture.
 *
 *  • Projets PARTAGÉS : les projets perso s'affichaient d'emblée (déjà en cache via le Pilotage)
 *    tandis que la partie partagée se chargeait sous les yeux de l'utilisateur — deux moitiés de la
 *    même page qui n'arrivaient pas ensemble. Les stats dépendent des projets : on les chaîne ici
 *    exactement comme l'écran le fait, pour qu'elles soient prêtes elles aussi.
 *  • Conseils IA : configuration, quota, invites et liste des conversations — ce sont elles qui
 *    conditionnent l'affichage de la page (compteur, historique). L'instantané financier
 *    (`snapshot_txs`, jusqu'à 4 000 lignes) n'est volontairement PAS préchargé : il ne sert qu'au
 *    moment où l'on pose réellement une question, et le tirer au démarrage pour tout le monde
 *    coûterait plus cher que ce qu'il ferait gagner.
 */
function WarmSecondary({ userId }: { userId: string }) {
  const { data: rwProjects = [] } = useRwProjects(userId);
  useRwInvitations(userId);
  useRwProjectsStats(userId, rwProjects.filter((p) => !p.archived_at).map((p) => p.id));
  useAiConfig();
  useAiQuota(userId);
  useAiAnalyses();
  useAiConversations(userId);
  return null;
}

export default function DataPrefetcher() {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [secondaryReady, setSecondaryReady] = useState(false);

  useEffect(() => {
    // Après les interactions du démarrage + 1,2 s de marge : la priorité reste au premier écran.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timer2: ReturnType<typeof setTimeout> | null = null;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => setReady(true), 1200);
      // 2ᵉ vague nettement plus tard : la 1ʳᵉ doit avoir rendu la main.
      timer2 = setTimeout(() => setSecondaryReady(true), 3500);
    });
    return () => { task.cancel(); if (timer) clearTimeout(timer); if (timer2) clearTimeout(timer2); };
  }, []);

  if (!user?.id) return null;
  return (
    <>
      {ready && <Warm userId={user.id} />}
      {secondaryReady && <WarmSecondary userId={user.id} />}
    </>
  );
}
