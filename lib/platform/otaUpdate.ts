/**
 * OTA — application de la mise à jour Expo au lancement, et en particulier À LA TOUTE PREMIÈRE
 * OUVERTURE APRÈS INSTALLATION.
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ ON NE TÉLÉCHARGE JAMAIS DEPUIS LE JS. C'est le NATIF qui cherche et télécharge la mise à jour
 * (`updates.checkAutomatically = ON_LOAD` + `fallbackToCacheTimeout` dans app.json). Appeler
 * `fetchUpdateAsync()` en parallèle de ce téléchargement — ce que faisait la version précédente de
 * ce fichier — met DEUX mécanismes de mise à jour en concurrence pendant le démarrage : l'app se
 * fermait toute seule. C'est pour ça que le code JS avait été désactivé.
 *
 * ── CE QUI MANQUAIT, ET QUE CE FICHIER RÈGLE ───────────────────────────────────────────────────
 * `fallbackToCacheTimeout` est un DÉLAI D'ATTENTE (7 s) : passé ce délai, le natif démarre l'app sur
 * le bundle embarqué dans le build et POURSUIT le téléchargement en arrière-plan. La mise à jour
 * n'est alors appliquée qu'au lancement SUIVANT. Sur une première ouverture — celle qui suit
 * l'installation, souvent sur un réseau mobile et avec un bundle complet à télécharger — les 7 s
 * sont très régulièrement dépassées : le tout nouvel utilisateur découvre donc l'app dans la version
 * du store, avec les manques que l'OTA corrige justement.
 *
 * On n'ajoute pas un second téléchargeur : on ATTEND celui du natif. `useUpdates()` expose l'état de
 * la machine à états native (`isChecking`, `isDownloading`, `isUpdatePending`). Dès que le
 * téléchargement natif est terminé — et seulement là, donc sans rien de concurrent en cours — on
 * applique la mise à jour avec `reloadAsync()`, derrière un voile qui reprend le splash.
 *
 * Trois garde-fous, parce qu'un démarrage bloqué est pire qu'une version en retard :
 *   • UNE SEULE FOIS PAR INSTALLATION (drapeau AsyncStorage posé avant toute attente) ;
 *   • seulement si l'app tourne sur le bundle EMBARQUÉ (`isEmbeddedLaunch`) — sinon la mise à jour
 *     est déjà appliquée, il n'y a rien à attendre ;
 *   • plafond dur (`MAX_WAIT_MS`), plus un abandon immédiat dès que le natif ne fait plus rien.
 */
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';

/** Drapeau « la première ouverture a déjà eu lieu » — posé une fois, jamais relu ensuite. */
const FIRST_LAUNCH_KEY = 'ota_first_launch_v1';
/**
 * Plafond d'attente. Au-delà, on démarre sur le bundle embarqué et le natif appliquera la mise à
 * jour au lancement suivant — l'app s'ouvre toujours, même sur un réseau qui traîne.
 * 15 s s'ajoutent aux 7 s déjà attendues par le natif (`fallbackToCacheTimeout`) : au-delà, on n'est
 * plus en train d'installer une app, on est en train de faire attendre quelqu'un.
 */
const MAX_WAIT_MS = 15000;
/** Le natif ne fait plus rien depuis ce délai → il n'y a rien à attendre. */
const QUIET_MS = 1500;

export interface FirstLaunchUpdateState {
  /** true tant qu'on attend la mise à jour : l'écran d'attente doit rester affiché. */
  waiting: boolean;
  /** Téléchargement natif en cours (permet d'afficher une progression plutôt qu'un simple délai). */
  downloading: boolean;
  /** 0 → 1 quand le serveur annonce la taille des fichiers, `null` sinon. */
  progress: number | null;
}

/**
 * Attente de la mise à jour à la PREMIÈRE ouverture. Rend `waiting: false` dans tous les autres cas
 * (web, dev, ouvertures suivantes, app déjà démarrée sur une mise à jour).
 */
export function useFirstLaunchUpdate(): FirstLaunchUpdateState {
  const [waiting, setWaiting] = useState(false);
  /* `reloadAsync` ne rend jamais la main quand il réussit (l'app redémarre) : ce verrou évite qu'un
     rendu supplémentaire n'en déclenche un second pendant que le premier s'exécute. */
  const reloading = useRef(false);

  const {
    isUpdatePending, isChecking, isDownloading, isUpdateAvailable,
    checkError, downloadError, downloadProgress,
  } = Updates.useUpdates();

  // ── Éligibilité : une seule fois, au montage ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (Platform.OS === 'web') return;   // le web recharge la page, il est toujours à jour
      if (!Updates.isEnabled) return;      // développement / Expo Go : pas d'OTA
      let alreadyLaunched: string | null = null;
      try {
        alreadyLaunched = await AsyncStorage.getItem(FIRST_LAUNCH_KEY);
        /* Posé MAINTENANT, avant toute attente et avant le rechargement : quoi qu'il arrive
           ensuite (mise à jour appliquée, réseau absent, plafond atteint), l'ouverture suivante ne
           réattend pas. Une attente qui se répète à chaque lancement serait pire que le retard
           qu'elle corrige. */
        await AsyncStorage.setItem(FIRST_LAUNCH_KEY, '1');
      } catch { /* stockage indisponible : on n'attend pas, on démarre normalement */ return; }
      if (cancelled || alreadyLaunched) return;
      // Le natif a déjà réussi à appliquer la mise à jour dans son délai → rien à attendre.
      if (!Updates.isEmbeddedLaunch) return;
      setWaiting(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Plafond dur : on ne bloque jamais le démarrage au-delà de MAX_WAIT_MS ─────────────────────
  useEffect(() => {
    if (!waiting) return;
    const cap = setTimeout(() => { if (!reloading.current) setWaiting(false); }, MAX_WAIT_MS);
    return () => clearTimeout(cap);
  }, [waiting]);

  // ── Suivi de la machine à états NATIVE ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!waiting || reloading.current) return;

    /* Téléchargement natif TERMINÉ : la mise à jour est prête et plus rien ne tourne en parallèle.
       C'est le seul moment où recharger est sûr (cf. l'en-tête de ce fichier). */
    if (isUpdatePending) {
      reloading.current = true;
      Updates.reloadAsync().catch(() => { reloading.current = false; setWaiting(false); });
      return;
    }
    // Échec de la recherche ou du téléchargement (hors ligne, serveur indisponible) : on démarre.
    if (checkError || downloadError) { setWaiting(false); return; }
    // Ça travaille : on patiente (dans la limite du plafond ci-dessus).
    if (isChecking || isDownloading || isUpdateAvailable) return;
    // Plus rien en cours et rien à télécharger → il n'y a pas de mise à jour à attendre.
    const quiet = setTimeout(() => { if (!reloading.current) setWaiting(false); }, QUIET_MS);
    return () => clearTimeout(quiet);
  }, [waiting, isUpdatePending, isChecking, isDownloading, isUpdateAvailable, checkError, downloadError]);

  return {
    waiting,
    downloading: !!isDownloading,
    progress: typeof downloadProgress === 'number' ? downloadProgress : null,
  };
}
