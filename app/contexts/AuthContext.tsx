/**
 * AuthContext - État de connexion Supabase pour toute l'app.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

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
      if (_event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      updateState(session);
    });

    return () => subscription.unsubscribe();
  }, [updateState]);

  const signOut = useCallback(async () => {
    setImpersonatedUserId(null);
    setImpersonatedEmail(null);
    if (supabase) await supabase.auth.signOut();
    setState({ user: null, session: null, loading: false });
    // Vide le cache des requêtes : évite qu'une donnée périmée d'une session précédente
    // (ex. profil financier null) ne fausse la redirection de la session suivante.
    queryClient.clear();
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
  const effectiveUser: User | null = isImpersonating
    ? ({ ...(realUser as User), id: impersonatedUserId!, email: impersonatedEmail ?? (realUser as User).email })
    : realUser;

  const value = {
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
