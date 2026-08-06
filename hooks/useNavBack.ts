/**
 * useNavBack — retour fiable vers la page réellement précédente.
 *
 * Contourne l'accumulation de la pile imbriquée des pages secondaires : au lieu de `router.back()`
 * (qui peut dépiler vers une page secondaire obsolète), on navigue vers le chemin précédent suivi
 * dans navHistory.
 *
 * QUAND L'HISTORIQUE EST VIDE (ouverture directe par URL, rechargement de la page web, reprise de
 * session, arrivée sur la page juste après la connexion), on ne renvoie plus bêtement sur le
 * tableau de bord : on REMONTE D'UN CRAN dans le chemin (`parentRoute`). « Retour » depuis
 * /admin/seo-center mène alors au panneau /admin, ce que l'utilisateur attend — le tableau de bord
 * ne reste que le dernier recours, pour les pages déjà à la racine.
 */
import { useRouter, usePathname } from 'expo-router';
import { consumePreviousRoute, parentRoute, resetRouteTo } from '../lib/navHistory';

export function useNavBack(fallback: string = '/(tabs)/pilotage') {
  const router = useRouter();
  const pathname = usePathname();
  return () => {
    const prev = consumePreviousRoute();
    if (prev) { router.navigate(prev as any); return; }
    // Pas d'historique : on remonte d'un cran. L'historique repart de cette destination — sinon la
    // page qu'on quitte deviendrait la « précédente » de son propre parent, et « Retour » y
    // redescendrait aussitôt.
    const target = parentRoute(pathname) ?? fallback;
    resetRouteTo(target);
    router.navigate(target as any);
  };
}
