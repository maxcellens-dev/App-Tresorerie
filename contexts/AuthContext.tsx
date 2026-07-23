/**
 * AuthContext - État de connexion Supabase pour toute l'app.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { clearCachedUserTheme } from '../lib/themeBoot';

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
    setState({
      user: session?.user ?? null,
      session: session ?? null,
      loading: false,
    });
  }, []);

  useEffect(() => {
    if (!supabase) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }

    // Session initiale (persistée)
    supabase.auth.getSession().then(({ data: { session } }) => {
      updateState(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Diagnostic (dev) : permet de voir quel événement survient au retour en avant-plan
      // (TOKEN_REFRESHED = OK ; SIGNED_OUT = échec du refresh → déconnexion à investiguer).
      if (__DEV__) console.log('[auth] onAuthStateChange', _event, !!session);
      if (_event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      // Session nulle non sollicitée → on garde la session courante (rester connecté tant que
      // l'utilisateur ne se déconnecte pas lui-même). On ne vide que sur déconnexion explicite.
      if (!session) {
        if (explicitSignOut.current) { explicitSignOut.current = false; updateState(null); }
        return;
      }
      updateState(session);
    });

    return () => subscription.unsubscribe();
  }, [updateState]);

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
  const signOut = useCallback(async () => {
    if (signOutInFlight.current) return;
    signOutInFlight.current = true;
    setSigningOut(true);
    setSignOutSettled(false);
    explicitSignOut.current = true; // autorise le vidage de session sur le SIGNED_OUT qui suit
    setImpersonatedUserId(null);
    setImpersonatedEmail(null);
    router.replace('/welcome');

    // Révocation serveur en arrière-plan. Si elle échoue (hors-ligne), supabase-js ne vide PAS la
    // session locale → repli en portée `local`, qui ne dépend que du stockage : sans lui, l'app
    // rouvrirait connectée au redémarrage.
    if (supabase) {
      const local = () => { supabase!.auth.signOut({ scope: 'local' }).catch(() => {}); };
      supabase.auth.signOut().then(({ error }) => { if (error) local(); }).catch(local);
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
  }, [queryClient]);

  const endSignOut = useCallback(() => setSigningOut(false), []);

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
