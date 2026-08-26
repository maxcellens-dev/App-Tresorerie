/**
 * AuthContext - État de connexion Supabase pour toute l'app.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/platform/supabase';
import { clearCachedUserTheme } from '../lib/platform/themeBoot';
import { parseAuthLink } from '../lib/auth/authDeepLink';
import { isUnreachableServerError } from '../lib/auth/authErrors';
import { clearSessionMark, markSessionAlive, reportSessionLossIfUnexpected } from '../lib/auth/sessionWatchdog';

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
};

type ImpersonationApi = {
  /** Admin réel (toujours la vraie session, même en mode consultation). */
  realUser: User | null;
  isImpersonating: boolean;
  impersonatedEmail: string | null;
  impersonate: (userId: string, email: string | null) => void;
  stopImpersonating: () => void;
};

type SignOutApi = {
  signOut: () => Promise<void>;
  /** Déconnexion en cours : le garde d'auth se tait et un voile opaque masque la transition. */
  signingOut: boolean;
  /** Purge terminée (session, caches, thème) : plus rien ne bougera à l'écran, le voile peut se lever. */
  signOutSettled: boolean;
  /** Levé par le voile une fois le fondu terminé. */
  endSignOut: () => void;
};

const AuthContext = createContext<AuthState & SignOutApi & { passwordRecovery: boolean; clearPasswordRecovery: () => void } & ImpersonationApi | null>(null);

/** Délai laissé à la transition de route pour se poser avant la purge (cf. signOut). Sous le voile.
 *  Calé au-delà du fondu du Stack (~200-300 ms) : l'écran d'onglet est démonté quand le cache tombe. */
const TEARDOWN_DELAY_MS = 350;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
  });
  // true quand l'utilisateur arrive via un lien de réinitialisation de mot de passe.
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutSettled, setSignOutSettled] = useState(false);
  // Mode admin « connecté en tant que » : on substitue l'identifiant de données, sans toucher à l'auth réelle.
  const [impersonatedUserId, setImpersonatedUserId] = useState<string | null>(null);
  const [impersonatedEmail, setImpersonatedEmail] = useState<string | null>(null);
  const queryClient = useQueryClient();
  // Vrai uniquement quand l'utilisateur se déconnecte volontairement (bouton). Tout autre
  // événement « session nulle » (refresh échoué/token expiré au retour d'arrière-plan) est ignoré.
  const explicitSignOut = useRef(false);
  // Anti-réentrance : deux appuis (ou un appelant qui `await` pendant qu'un autre relance) ne
  // doivent pas rejouer la séquence — le voile se lèverait au milieu du second passage.
  const signOutInFlight = useRef(false);

  const updateState = useCallback((session: Session | null) => {
    // Marqueur local « une session existait » — c'est lui qui permet de CONSTATER une déconnexion
    // subie au prochain démarrage (cf. lib/auth/sessionWatchdog). Aucun jeton n'y est écrit.
    if (session?.user?.id) markSessionAlive(session.user.id);
    setState({
      user: session?.user ?? null,
      session: session ?? null,
      loading: false,
    });
  }, []);

  /* Le jeton de rafraîchissement courant, lu SANS repasser par un rendu.
     Il sert à re-tester une session que supabase-js vient de déclarer morte : la bibliothèque a
     déjà vidé son stockage à ce moment-là, donc `refreshSession()` sans argument ne trouverait plus
     rien et conclurait « session absente » — exactement la réponse qu'on cherche à vérifier. */
  const refreshTokenRef = useRef<string | null>(null);
  useEffect(() => { refreshTokenRef.current = state.session?.refresh_token ?? null; }, [state.session]);
  // Une seule vérification à la fois : le test lui-même peut refaire émettre SIGNED_OUT.
  const verifyingRef = useRef(false);
  // Renseignée plus bas (runSignOut est défini après) — évite une dépendance circulaire de hooks.
  const forceSignOutRef = useRef<((notice: string) => void) | null>(null);

  /**
   * SESSION DÉCLARÉE MORTE PAR SUPABASE — vérifier avant de croire, mais croire quand c'est vrai.
   *
   * Ce que faisait l'app AVANT : tout événement « session nulle » non sollicité était PUREMENT
   * IGNORÉ. C'était une protection contre les fausses alertes (échec de rafraîchissement au retour
   * d'arrière-plan), mais elle avalait aussi les vraies : compte supprimé, jeton révoqué, mot de
   * passe changé sur un autre appareil, « déconnecter tous les appareils ». L'app restait alors
   * « connectée » avec un jeton mort — chaque requête refusée, des écrans vides sans explication, et
   * aucun moyen évident de s'en sortir puisque l'app se croyait en session.
   *
   * On tranche donc au lieu de deviner : on redemande un rafraîchissement au serveur.
   *   • une session revient  → fausse alerte, on la reprend, rien n'a bougé pour l'utilisateur ;
   *   • le serveur REFUSE    → la session est bien morte, on déconnecte proprement et on le dit ;
   *   • serveur injoignable  → on ne touche à rien (l'app doit rester utilisable hors-ligne).
   */
  const verifySessionStillValid = useCallback(async () => {
    if (verifyingRef.current) return;
    const token = refreshTokenRef.current;
    if (!supabase || !token) return; // rien à perdre : on n'était pas connecté
    verifyingRef.current = true;
    try {
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: token });
      if (data?.session) { updateState(data.session); return; }
      if (isUnreachableServerError(error)) return; // hors-ligne : on garde la session
      forceSignOutRef.current?.(
        'Ta session n’est plus valable. Cela arrive après un changement de mot de passe ou une déconnexion à distance. Reconnecte-toi pour continuer.',
      );
    } catch (e) {
      if (!isUnreachableServerError(e)) {
        forceSignOutRef.current?.('Ta session n’est plus valable. Reconnecte-toi pour continuer.');
      }
    } finally {
      verifyingRef.current = false;
    }
  }, [updateState]);

  useEffect(() => {
    if (!supabase) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }

    /* Session initiale (persistée).
       ⚠️ Le `catch` n'est pas décoratif : si la lecture du stockage lève (coffre Keychain/Keystore
       inaccessible), la promesse est rejetée, `loading` resterait à `true` POUR TOUJOURS et l'app
       ne dépasserait jamais le splash. On retombe alors sur « pas de session » — l'app reste
       utilisable — et le veilleur ci-dessous remonte l'incident. */
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        updateState(session);
        // Aucune session au démarrage alors qu'il y en avait une au lancement précédent = perte
        // subie (mise à jour, coffre en panne, écriture interrompue). On la remonte, sinon elle
        // reste invisible : l'app affiche l'accueil et rien ne distingue ça d'un simple visiteur.
        if (!session) void reportSessionLossIfUnexpected();
      })
      .catch(() => {
        setState({ user: null, session: null, loading: false });
        void reportSessionLossIfUnexpected();
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Diagnostic (dev) : permet de voir quel événement survient au retour en avant-plan
      // (TOKEN_REFRESHED = OK ; SIGNED_OUT = échec du refresh → déconnexion à investiguer).
      if (__DEV__) console.log('[auth] onAuthStateChange', _event, !!session);
      if (_event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (!session) {
        // Déconnexion demandée par l'utilisateur : rien à vérifier, on vide.
        if (explicitSignOut.current) { explicitSignOut.current = false; updateState(null); return; }
        // Sinon : on ne déconnecte pas sur parole, on va demander au serveur (cf. ci-dessus).
        void verifySessionStillValid();
        return;
      }
      updateState(session);
    });

    return () => subscription.unsubscribe();
  }, [updateState, verifySessionStillValid]);

  /**
   * DÉCONNEXION — la navigation fait partie de l'opération, elle n'est plus à la charge des
   * appelants. Trois d'entre eux l'ordonnaient différemment, dont un à l'envers (session vidée
   * PUIS navigation → l'écran courant se re-rendait « vide » avant de partir).
   *
   * Ordre imposé, dans cet ordre exact :
   *  1. `signingOut` → voile opaque immédiat + garde d'auth mis en sourdine. Sans ce garde, la
   *     redirection vers /welcome arrivait alors que `user` était ENCORE renseigné (le signOut
   *     réseau n'avait pas répondu) → le garde renvoyait aussitôt sur '/' , et l'accueil n'était
   *     atteint qu'au 2ᵉ rebond : c'est le flash « on reste sur la page puis ça part ».
   *  2. Navigation, tant que les données sont encore là (rien ne peut se re-rendre à vide).
   *  3. Session + caches vidés, sous le voile, une fois la transition posée.
   *  4. `signOutSettled` → seulement MAINTENANT le voile a le droit de se lever.
   *
   * ⚠️ LE RÉSEAU N'EST PAS SUR LE CHEMIN CRITIQUE. On l'attendait avant : le voile, lui, se levait
   * dès l'arrivée sur /welcome (~320 ms), donc bien AVANT la réponse — `user` était encore
   * renseigné, le garde d'auth se réveillait et renvoyait sur '/' → index → /(tabs)/pilotage, puis
   * la session tombait enfin et on repartait sur /welcome. C'était le clignotement
   * « accueil → pilotage → accueil ». La purge locale est donc immédiate et la révocation serveur
   * part en arrière-plan.
   */
  const runSignOut = useCallback(async (opts: { revokeOnServer: boolean; notice?: string }) => {
    if (signOutInFlight.current) return;
    signOutInFlight.current = true;
    setSigningOut(true);
    setSignOutSettled(false);
    explicitSignOut.current = true; // autorise le vidage de session sur le SIGNED_OUT qui suit
    // Déconnexion VOULUE ou EXPLIQUÉE : au prochain démarrage, l'absence de session est normale.
    clearSessionMark();
    setImpersonatedUserId(null);
    setImpersonatedEmail(null);
    /* PIÈGE À RÉINITIALISATION — ce drapeau devait tomber ici aussi.
       Tant qu'il est levé, le garde d'app/_layout renvoie sur /reset-password DEPUIS N'IMPORTE OÙ.
       Se déconnecter au milieu d'une réinitialisation (ou après l'avoir abandonnée) reconduisait
       donc aussitôt sur l'écran « Nouveau mot de passe » — mais SANS session : l'enregistrement
       échouait, l'accueil était inatteignable, l'utilisateur tournait en rond jusqu'à tuer l'app. */
    setPasswordRecovery(false);
    router.replace('/welcome');

    // Révocation serveur en arrière-plan. Si elle échoue (hors-ligne), supabase-js ne vide PAS la
    // session locale → repli en portée `local`, qui ne dépend que du stockage : sans lui, l'app
    // rouvrirait connectée au redémarrage.
    //
    // `revokeOnServer: false` = la session est DÉJÀ morte côté serveur (jeton révoqué, compte
    // supprimé) : demander sa révocation ne ferait qu'un aller-retour refusé de plus. On se contente
    // de la purge locale, qui est la seule chose qui reste à faire.
    if (supabase) {
      const local = () => { supabase!.auth.signOut({ scope: 'local' }).catch(() => {}); };
      if (opts.revokeOnServer) supabase.auth.signOut().then(({ error }) => { if (error) local(); }).catch(local);
      else local();
    }

    // Laisse la transition de route se poser avant de couper les données sous les pieds des écrans
    // encore montés (un écran d'onglet qui se re-rend sans profil peut lever). Tout se joue sous le
    // voile : c'est invisible, mais borné — on ne dépend plus d'une réponse réseau.
    await new Promise((r) => setTimeout(r, TEARDOWN_DELAY_MS));

    setState({ user: null, session: null, loading: false });
    // Vide le cache des requêtes : évite qu'une donnée périmée d'une session précédente
    // (ex. profil financier null) ne fausse la redirection de la session suivante.
    queryClient.clear();
    // Oublie le thème utilisateur mémorisé → le prochain rendu (pré-auth) reprend le thème admin.
    clearCachedUserTheme();
    signOutInFlight.current = false;
    setSignOutSettled(true);

    /* DIRE POURQUOI. Une déconnexion SUBIE (session révoquée, compte supprimé) qui se contente de
       ramener sur l'accueil ressemble à un bug : l'utilisateur a « perdu » son app sans explication
       et ne sait pas s'il doit se reconnecter ou attendre. On l'annonce, une fois le voile retombé
       (sinon le dialogue s'ouvrirait pendant le fondu). */
    if (opts.notice) {
      setTimeout(() => Alert.alert('Session expirée', opts.notice!), 500);
    }
  }, [queryClient]);

  /** Déconnexion VOLONTAIRE (bouton) : on révoque aussi la session côté serveur. */
  const signOut = useCallback(() => runSignOut({ revokeOnServer: true }), [runSignOut]);

  /* Déconnexion SUBIE : même séquence exactement (voile, navigation, purge), mais sans révocation
     serveur et avec un message d'explication. Passée par une référence parce que le vérificateur est
     déclaré plus haut — il ne peut pas fermer sur une fonction qui n'existe pas encore. */
  useEffect(() => {
    forceSignOutRef.current = (notice: string) => { void runSignOut({ revokeOnServer: false, notice }); };
    return () => { forceSignOutRef.current = null; };
  }, [runSignOut]);

  const endSignOut = useCallback(() => setSigningOut(false), []);

  /**
   * LIEN DE RÉINITIALISATION REÇU PAR E-MAIL — version NATIVE.
   *
   * Sur web, supabase-js lit les jetons dans l'URL tout seul (`detectSessionInUrl`) et émet
   * `PASSWORD_RECOVERY`. Sur natif, cette détection est coupée : personne ne lisait le lien, et
   * `resetPasswordForEmail` n'envoyait donc AUCUN `redirectTo` depuis le téléphone. Le lien
   * retombait sur le site, et quelqu'un qui n'a que l'app devait terminer sa réinitialisation dans
   * un navigateur — sur une autre session, avec un mot de passe à ressaisir ensuite dans l'app.
   *
   * Ici, le lien rouvre l'APP : on ouvre la session de récupération et on lève le drapeau, que le
   * garde d'app/_layout traduit en navigation vers /reset-password.
   *
   * ⚠️ Le drapeau est levé AVANT d'ouvrir la session : l'événement `SIGNED_IN` qui suit réveille le
   * garde d'auth, et sans le drapeau déjà posé celui-ci enverrait droit dans l'app (Pilotage) — le
   * mot de passe ne serait jamais changé.
   *
   * ⚠️ Ce lecteur ne touche QUE les retours de réinitialisation (cf. parseAuthLink) : le retour de
   * connexion sociale est déjà consommé par `WebBrowser.openAuthSessionAsync`.
   */
  useEffect(() => {
    if (Platform.OS === 'web' || !supabase) return;
    let cancelled = false;
    /* Un démarrage À FROID par le lien le fait arriver DEUX fois : une fois par `getInitialURL()`,
       une fois par l'événement `url`. Sans ce garde, on échangeait le code deux fois — le second
       échange est refusé (code à usage unique) et l'écran annonçait « lien expiré » alors que la
       session venait d'être ouverte correctement. */
    let handledUrl: string | null = null;

    const goToReset = (expired: boolean) => {
      try {
        router.replace({ pathname: '/reset-password', params: expired ? { expired: '1' } : {} } as any);
      } catch { /* navigation pas encore prête : l'app s'ouvre normalement, rien de cassé */ }
    };

    const handle = async (url: string | null) => {
      if (cancelled || !url || url === handledUrl) return;
      const link = parseAuthLink(url);
      if (link.kind === 'none') return;
      handledUrl = url;

      if (link.kind === 'error') {
        // Lien périmé ou déjà utilisé : on ouvre l'écran sur « redemande un lien » plutôt que sur un
        // formulaire qui ne pourra rien enregistrer.
        goToReset(link.expired);
        return;
      }

      /* ── CONFIRMATION D'UN CHANGEMENT D'ADRESSE E-MAIL ────────────────────────────────────────
         Rien à faire signer à l'utilisateur : Supabase a déjà remplacé l'adresse en ouvrant le
         lien. Il reste à mettre NOTRE côté à jour — la session porte encore l'ancienne adresse, et
         les écrans (Profil, Assistance) la liraient telle quelle. On rafraîchit la session, puis on
         relit le profil (dont la copie de l'adresse est synchronisée côté base, migration 214), et
         on le dit : sans un mot, on ne saurait pas si le changement a pris. */
      if (link.kind === 'email_change') {
        try {
          const { data } = await supabase!.auth.refreshSession();
          if (data?.session) updateState(data.session);
          queryClient.invalidateQueries({ queryKey: ['profile'] });
          const now = data?.session?.user?.email;
          setTimeout(() => Alert.alert(
            'Adresse confirmée',
            now ? `Tu te connectes désormais avec ${now}.` : 'Ta nouvelle adresse e-mail est active.',
          ), 400);
        } catch {
          setTimeout(() => Alert.alert(
            'Adresse confirmée',
            'Reconnecte-toi avec ta nouvelle adresse pour terminer.',
          ), 400);
        }
        return;
      }

      setPasswordRecovery(true);
      try {
        // Les deux flux possibles selon la configuration du projet Supabase (PKCE / implicite).
        const { error } = link.code
          ? await supabase!.auth.exchangeCodeForSession(link.code)
          : await supabase!.auth.setSession({ access_token: link.accessToken!, refresh_token: link.refreshToken! });
        if (error) throw error;
        // Rien à naviguer ici : le drapeau suffit, le garde d'app/_layout amène sur /reset-password.
      } catch {
        if (cancelled) return;
        setPasswordRecovery(false);
        goToReset(true);
      }
    };

    /* Ouverture À FROID (l'app était fermée) : on laisse la navigation d'expo-router se poser avant
       de lire l'URL de lancement. Trop tôt, `router.replace` est sans effet et le lien serait perdu
       sans le moindre message. Le splash couvre largement ce délai. */
    const t = setTimeout(() => { Linking.getInitialURL().then(handle).catch(() => {}); }, 300);
    // App DÉJÀ ouverte : le lien arrive par cet événement.
    const sub = Linking.addEventListener('url', (e) => { void handle(e.url); });
    return () => { cancelled = true; clearTimeout(t); sub.remove(); };
    // `updateState` et `queryClient` sont stables (useCallback / provider) : l'abonnement ne doit
    // se poser qu'UNE fois, sous peine de traiter deux fois le même lien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearPasswordRecovery = useCallback(() => setPasswordRecovery(false), []);

  const impersonate = useCallback((userId: string, email: string | null) => {
    setImpersonatedUserId(userId);
    setImpersonatedEmail(email);
  }, []);
  const stopImpersonating = useCallback(() => {
    setImpersonatedUserId(null);
    setImpersonatedEmail(null);
  }, []);

  const realUser = state.user;
  const isImpersonating = !!impersonatedUserId && !!realUser;
  // En mode consultation : tout l'app lit/écrit les données du compte cible (id substitué),
  // mais l'authentification (token, Google…) reste celle de l'admin réel.
  // Mémoïsé : sinon un nouvel objet à chaque rendu re-rendrait tous les consommateurs de useAuth.
  const effectiveUser: User | null = useMemo(
    () => (isImpersonating
      ? ({ ...(realUser as User), id: impersonatedUserId!, email: impersonatedEmail ?? (realUser as User).email })
      : realUser),
    [isImpersonating, realUser, impersonatedUserId, impersonatedEmail],
  );

  // value mémoïsé → les consommateurs (useAuth → useAppColors → quasi tout l'app) ne se re-rendent
  // que sur un vrai changement, pas à chaque rendu du provider.
  const value = useMemo(
    () => ({
      user: effectiveUser,
      session: state.session,
      loading: state.loading,
      signOut,
      signingOut,
      signOutSettled,
      endSignOut,
      passwordRecovery,
      clearPasswordRecovery,
      realUser,
      isImpersonating,
      impersonatedEmail,
      impersonate,
      stopImpersonating,
    }),
    [effectiveUser, state.session, state.loading, signOut, signingOut, signOutSettled, endSignOut, passwordRecovery, clearPasswordRecovery, realUser, isImpersonating, impersonatedEmail, impersonate, stopImpersonating],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
