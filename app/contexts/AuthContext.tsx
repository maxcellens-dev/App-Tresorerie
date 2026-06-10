/**
 * AuthContext - État de connexion Supabase pour toute l'app.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
};

const AuthContext = createContext<AuthState & { signOut: () => Promise<void>; passwordRecovery: boolean; clearPasswordRecovery: () => void } | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
  });
  // true quand l'utilisateur arrive via un lien de réinitialisation de mot de passe.
  const [passwordRecovery, setPasswordRecovery] = useState(false);

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
    if (supabase) await supabase.auth.signOut();
    setState({ user: null, session: null, loading: false });
  }, []);

  const clearPasswordRecovery = useCallback(() => setPasswordRecovery(false), []);

  const value = { ...state, signOut, passwordRecovery, clearPasswordRecovery };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
