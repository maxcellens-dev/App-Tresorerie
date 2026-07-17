/**
 * DataPrefetcher — chauffe EN ARRIÈRE-PLAN les caches react-query des onglets pas encore visités,
 * pour que CHAQUE page s'ouvre instantanément (cache d'abord, refetch silencieux ensuite).
 *
 * Monté à la racine. Attend que le démarrage ait respiré (interactions finies + petit délai) avant
 * de monter les hooks : le préchargement ne doit JAMAIS concurrencer le premier écran.
 *
 * Déjà chauds par ailleurs (usePulse / PulseDeltaHost / PilotagePrefetch, montés à la racine) :
 * pilotage_data, transactions perso, accounts, projects, preSavings, reservations, profil
 * financier, configs. Ici : ce que SEULS les autres onglets chargeaient à leur 1ʳᵉ ouverture.
 */
import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useAllTransactions } from '../hooks/useTransactions';
import { useCategories } from '../hooks/useCategories';
import { useCredits } from '../hooks/useCredits';
import { useAllCreditEvents } from '../hooks/useCreditEvents';
import { useTransactionMonthOverrides } from '../hooks/useTransactionMonthOverrides';
import { useSharedContribution } from '../hooks/useSharedContribution';
import { useCurrencyRates } from '../hooks/useCurrencyRates';

/** Monte les hooks de données → react-query remplit son cache ; ne rend rien. */
function Warm({ userId }: { userId: string }) {
  useAllTransactions(userId);        // liste Transactions + détail de compte
  useCategories(userId);             // filtres + saisie
  useCredits(userId);                // tréso / projection / onglet Crédits
  useAllCreditEvents(userId);
  useTransactionMonthOverrides(userId);
  useSharedContribution(userId);     // tréso / projection / reporting
  useCurrencyRates();
  return null;
}

export default function DataPrefetcher() {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Après les interactions du démarrage + 1,2 s de marge : la priorité reste au premier écran.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => setReady(true), 1200);
    });
    return () => { task.cancel(); if (timer) clearTimeout(timer); };
  }, []);

  if (!ready || !user?.id) return null;
  return <Warm userId={user.id} />;
}
