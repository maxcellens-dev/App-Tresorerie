/**
 * useRatesAutoRefresh — met à jour les taux de change ~1×/jour.
 * Déclenché uniquement par un ADMIN connecté (seul autorisé à écrire la table, cf. RLS) et
 * seulement si les taux sont périmés (> 20 h). La table étant globale, tout le monde en profite.
 * Une seule tentative par session (ref) pour ne pas spammer l'API.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from './useProfile';
import { refreshCurrencyRates, ratesAreStale } from '../lib/refreshRates';

export function useRatesAutoRefresh() {
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin ?? false;
  const qc = useQueryClient();
  const tried = useRef(false);

  useEffect(() => {
    if (!isAdmin || tried.current) return;
    tried.current = true;
    (async () => {
      if (!(await ratesAreStale())) return;
      const r = await refreshCurrencyRates();
      if (r) qc.invalidateQueries({ queryKey: ['currency_rates'] });
    })();
  }, [isAdmin, qc]);
}
