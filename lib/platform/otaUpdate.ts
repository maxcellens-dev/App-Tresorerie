/**
 * OTA — appliquer la mise à jour SUR LE LANCEMENT EN COURS, et pas au suivant.
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ ON NE TÉLÉCHARGE JAMAIS DEPUIS LE JS. C'est le NATIF qui cherche et télécharge la mise à jour
 * (`updates.checkAutomatically = ON_LOAD` + `fallbackToCacheTimeout` dans app.json). Appeler
 * `fetchUpdateAsync()` en parallèle de ce téléchargement — ce que faisait une version précédente de
 * ce fichier — met DEUX mécanismes de mise à jour en concurrence pendant le démarrage : l'app se
 * fermait toute seule. Ici, on ne fait qu'ATTENDRE le natif, puis appliquer.
 *
 * ── LE PROBLÈME QUE ÇA RÈGLE ───────────────────────────────────────────────────────────────────
 * `fallbackToCacheTimeout` est un DÉLAI D'ATTENTE (7 s) : passé ce délai, le natif démarre l'app sur
 * le bundle qu'il a déjà et POURSUIT le téléchargement en arrière-plan. La mise à jour n'est alors
 * appliquée qu'au lancement SUIVANT. Sur une première ouverture après installation — réseau mobile,
 * bundle complet à télécharger — les 7 s sont très régulièrement dépassées : le nouvel utilisateur
 * découvrait l'app dans la version du store, avec les manques que l'OTA corrige justement. Et sur
 * les lancements suivants, une mise à jour publiée la veille n'arrivait qu'à la deuxième ouverture.
 *
 * ── LA RÈGLE ───────────────────────────────────────────────────────────────────────────────────
 * On regarde ce que le natif est EN TRAIN de faire au moment où le JS démarre (`useUpdates()` expose
 * l'état de sa machine à états, initialisée depuis le natif) :
 *   • il ne se passe rien (cas de très loin le plus fréquent : pas de mise à jour) → on n'attend
 *     RIEN, le démarrage n'est pas ralenti d'une milliseconde ;
 *   • il cherche ou il télécharge → on patiente derrière un voile, et dès que la mise à jour est
 *     prête (`isUpdatePending`) on l'applique par `reloadAsync()`. À ce moment-là, plus rien ne
 *     tourne en parallèle : c'est le seul instant où recharger est sûr.
 *
 * Trois garde-fous, parce qu'un démarrage bloqué est pire qu'une version en retard :
 *   • on n'attend une simple RECHERCHE que `CHECK_ONLY_WAIT_MS` (elle doit être brève ; au-delà,
 *     c'est le réseau qui traîne, pas une mise à jour qui arrive) ;
 *   • plafond dur `MAX_WAIT_MS` sur l'attente totale, téléchargement compris ;
 *   • jamais de rechargement vers la version DÉJÀ en cours d'exécution — c'est ce qui pourrait
 *     boucler si une mise à jour échouait à démarrer.
 */
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

/** Attente maximale quand le natif n'en est qu'à CHERCHER une mise à jour. */
const CHECK_ONLY_WAIT_MS = 4000;
/**
 * Plafond dur, téléchargement compris. Au-delà, on démarre sur le bundle en cache et le natif
 * appliquera au lancement suivant — l'app s'ouvre toujours, même sur un réseau qui traîne.
 * 15 s s'ajoutent aux 7 s déjà attendues par le natif (`fallbackToCacheTimeout`) : au-delà, on n'est
 * plus en train d'installer une mise à jour, on est en train de faire attendre quelqu'un.
 */
const MAX_WAIT_MS = 15000;

export interface UpdateOnLaunchState {
  /** true tant qu'on attend la mise à jour : l'écran d'attente doit rester affiché. */
  waiting: boolean;
  /** Téléchargement en cours (permet d'afficher une progression plutôt qu'un simple délai). */
  downloading: boolean;
  /** 0 → 1 quand le serveur annonce la taille des fichiers, `null` sinon. */
  progress: number | null;
}

/**
 * Applique la mise à jour OTA sur le lancement en cours quand le natif est en train de l'apporter.
 * Rend `waiting: false` partout ailleurs (web, développement, et tous les démarrages où il n'y a
 * rien à attendre — c'est-à-dire presque tous).
 */
export function useUpdateOnLaunch(): UpdateOnLaunchState {
  const [waiting, setWaiting] = useState(false);
  /* `reloadAsync` ne rend jamais la main quand il réussit (l'app redémarre) : ce verrou évite qu'un
     rendu supplémentaire n'en déclenche un second pendant que le premier s'exécute. */
  const reloading = useRef(false);
  /** Le natif a-t-il RÉELLEMENT commencé à télécharger ? Décide du plafond applicable. */
  const sawDownload = useRef(false);
  const startedAt = useRef<number>(Date.now());

  const {
    currentlyRunning, downloadedUpdate,
    isUpdatePending, isChecking, isDownloading, isUpdateAvailable,
    checkError, downloadError, downloadProgress,
  } = Updates.useUpdates();

  /* État du natif AU DÉMARRAGE DU JS. `useUpdates()` initialise son état depuis la machine à états
     native, donc ces valeurs-là décrivent ce que le natif faisait pendant que le bundle se chargeait
     — c'est exactement ce qu'on a besoin de savoir. Figées dans une ref : la décision « faut-il
     attendre ? » se prend une fois, sur l'instant du démarrage. */
  const atLaunch = useRef({ isUpdatePending, isChecking, isDownloading, isUpdateAvailable });

  // ── Faut-il attendre ? Décidé une seule fois, au montage ──────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'web') return;   // le web recharge la page, il est toujours à jour
    if (!Updates.isEnabled) return;      // développement / Expo Go : pas d'OTA
    const s = atLaunch.current;
    // Rien en cours au démarrage → il n'y a pas de mise à jour à attendre. Aucun coût.
    if (!s.isUpdatePending && !s.isChecking && !s.isDownloading && !s.isUpdateAvailable) return;
    if (s.isDownloading) sawDownload.current = true;
    startedAt.current = Date.now();
    setWaiting(true);
  }, []);

  // ── Plafonds : on ne bloque jamais le démarrage indéfiniment ──────────────────────────────────
  useEffect(() => {
    if (!waiting) return;
    const tick = setInterval(() => {
      if (reloading.current) return;
      const elapsed = Date.now() - startedAt.current;
      /* Une RECHERCHE qui s'éternise n'annonce rien de bon (réseau qui traîne, serveur injoignable) :
         on ne lui accorde que quelques secondes. Un TÉLÉCHARGEMENT, lui, aboutit à quelque chose. */
      const cap = sawDownload.current ? MAX_WAIT_MS : CHECK_ONLY_WAIT_MS;
      if (elapsed >= cap) { setWaiting(false); clearInterval(tick); }
    }, 250);
    return () => clearInterval(tick);
  }, [waiting]);

  // ── Suivi de la machine à états NATIVE ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!waiting || reloading.current) return;
    if (isDownloading) sawDownload.current = true;

    /* Téléchargement natif TERMINÉ : la mise à jour est prête et plus rien ne tourne en parallèle.
       C'est le seul moment où recharger est sûr (cf. l'en-tête de ce fichier). */
    if (isUpdatePending) {
      /* Sauf si c'est DÉJÀ elle qui tourne : recharger vers la version en cours ne changerait rien
         et pourrait boucler d'un démarrage à l'autre si une mise à jour échouait à se lancer. */
      if (downloadedUpdate?.updateId && downloadedUpdate.updateId === currentlyRunning?.updateId) {
        setWaiting(false);
        return;
      }
      reloading.current = true;
      Updates.reloadAsync().catch(() => { reloading.current = false; setWaiting(false); });
      return;
    }
    // Échec de la recherche ou du téléchargement (hors ligne, serveur indisponible) : on démarre.
    if (checkError || downloadError) { setWaiting(false); return; }
    // Ça travaille : on patiente (dans la limite des plafonds ci-dessus).
    if (isChecking || isDownloading || isUpdateAvailable) return;
    // Plus rien en cours et rien à télécharger → il n'y a plus de mise à jour à attendre.
    setWaiting(false);
  }, [
    waiting, isUpdatePending, isChecking, isDownloading, isUpdateAvailable,
    checkError, downloadError, downloadedUpdate, currentlyRunning,
  ]);

  return {
    waiting,
    downloading: !!isDownloading,
    progress: typeof downloadProgress === 'number' ? downloadProgress : null,
  };
}
