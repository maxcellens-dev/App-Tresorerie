/**
 * LiveProfileSync — le profil financier suit les données, où qu'elles changent.
 *
 * Le profil se déduit de quatre mesures : l'épargne disponible, le revenu constaté, ce qui est mis
 * de côté chaque mois, et ce qui est réellement placé. Toutes viennent des COMPTES et des
 * TRANSACTIONS. Le recalcul était pourtant déclenché à la main depuis trois écrans (Pilotage, mise à
 * jour de solde, fiche Profil), chacun sur un critère différent : créer une épargne depuis la page
 * Comptes, saisir un salaire depuis Transactions ou supprimer un virement ne recalculait donc rien —
 * il fallait retomber par hasard sur l'un de ces trois écrans. D'où « le profil ne se met pas à jour ».
 *
 * On monte donc UN seul observateur, à la racine : il surveille la SIGNATURE des données qui entrent
 * dans le calcul et relance la synchronisation dès qu'elle bouge. Les écrans n'ont plus rien à
 * déclencher, et il n'y a plus de chemin de saisie « oublié » — c'est la donnée qui commande.
 *
 * Coût réseau : nul. Les deux listes surveillées sont déjà chargées globalement par GuideProvider,
 * on lit donc le cache react-query. La synchronisation elle-même n'écrit que si le profil CHANGE
 * réellement (cf. useLiveProfileSync).
 */
import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAccounts } from '../hooks/useAccounts';
import { useTransactions } from '../hooks/useTransactions';
import { useLiveProfileSync } from '../hooks/useFinancialProfile';

/** Laisse retomber les rafales (création rapide de comptes = N écritures d'affilée). */
const SETTLE_MS = 900;

export default function LiveProfileSync() {
  const { user, isImpersonating } = useAuth();
  const accountsQuery = useAccounts(user?.id);
  const txQuery = useTransactions(user?.id);
  const liveSync = useLiveProfileSync(user?.id);
  const lastSig = useRef<string | null>(null);

  /* ⚠️ `isSuccess`, jamais `isFetched` : une lecture EN ERREUR rend elle aussi une liste vide, et
     conclure dessus reviendrait à recalculer le profil de quelqu'un « sans épargne ni revenu ». */
  const ready = accountsQuery.isSuccess && txQuery.isSuccess;
  const accounts = accountsQuery.data;
  const transactions = txQuery.data;

  useEffect(() => {
    if (!ready || !user?.id || isImpersonating) return;

    /* Signature des SEULES données qui entrent dans le calcul du profil. Les soldes par type
       couvrent l'épargne et les placements ; le nombre d'opérations et la somme des montants
       couvrent le revenu constaté et les mises de côté (un montant modifié bouge la somme même si
       le nombre ne change pas). Trié pour être stable d'un rendu à l'autre. */
    const balances = (accounts ?? [])
      .map((a: any) => `${a.type}:${a.id}:${Number(a.balance)}`)
      .sort()
      .join('|');
    const txCount = (transactions ?? []).length;
    const txSum = (transactions ?? []).reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);
    const sig = `${balances}#${txCount}#${txSum.toFixed(2)}`;

    if (lastSig.current === sig) return;
    // Première signature connue : on synchronise aussi (le profil peut n'avoir jamais été calculé).
    lastSig.current = sig;
    const t = setTimeout(() => liveSync.mutate(), SETTLE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id, isImpersonating, accounts, transactions]);

  return null;
}
