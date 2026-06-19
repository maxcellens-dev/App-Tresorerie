/**
 * AuthContext - État de connexion Supabase pour toute l'app.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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

const AuthContext = createContext<AuthState & { signOut: () => Promise<void>; passwordRecovery: boolean; clearPasswordRecovery: () => void } & ImpersonationApi | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
  });
  // true quand l'utilisateur arrive via un lien de réinitialisation de mot de passe.
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  // Mode admin « connecté en tant que » : on substitue l'identifiant de données, sans toucher à l'auth réelle.
  const [impersonatedUserId, setImpersonatedUserId] = useState<string | null>(null);
  const [impersonatedEmail, setImpersonatedEmail] = useState<string | null>(null);
  const queryClient = useQueryClient();
  // Vrai uniquement quand l'utilisateur se déconnecte volontairement (bouton). Tout autre
  // événement « session nulle » (refresh échoué/token expiré au retour d'arrière-plan) est ignoré.
  const explicitSignOut = useRef(false);

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

  const signOut = useCallback(async () => {
    explicitSignOut.current = true; // autorise le vidage de session sur le SIGNED_OUT qui suit
    setImpersonatedUserId(null);
    setImpersonatedEmail(null);
    if (supabase) await supabase.auth.signOut();
    setState({ user: null, session: null, loading: false });
    // Vide le cache des requêtes : évite qu'une donnée périmée d'une session précédente
    // (ex. profil financier null) ne fausse la redirection de la session suivante.
    queryClient.clear();
    // Oublie le thème utilisateur mémorisé → le prochain rendu (pré-auth) reprend le thème admin.
    clearCachedUserTheme();
  }, [queryClient]);

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
      passwordRecovery,
      clearPasswordRecovery,
      realUser,
      isImpersonating,
      impersonatedEmail,
      impersonate,
      stopImpersonating,
    }),
    [effectiveUser, state.session, state.loading, signOut, passwordRecovery, clearPasswordRecovery, realUser, isImpersonating, impersonatedEmail, impersonate, stopImpersonating],
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
