/**
 * GUIDE UTILISATEUR — le parcours de démarrage, en modaux posés PAR-DESSUS l'app.
 *
 * Il remplace le questionnaire d'arrivée (app/onboarding.tsx, conservé mais plus branché) : au lieu
 * de 5 écrans hors de l'app, l'utilisateur atterrit directement sur le Pilotage et fait les gestes
 * RÉELS de l'app, guidé étape par étape. L'objectif n'est pas de collecter des réponses, c'est
 * d'avoir vite de VRAIES données — donc un vrai Relyka, donc de vraies recommandations.
 *
 * Règles du parcours :
 *  • une seule étape active à la fois, déduite de l'ÉTAT RÉEL (comptes, récurrences, réglages) et de
 *    drapeaux `g2_*` dans profiles.onboarding_state — rien n'est stocké en mémoire volatile, donc
 *    fermer l'app ne perd pas la place ;
 *  • l'utilisateur peut se promener librement : chaque écran affiche l'étape qui le concerne quand il
 *    y arrive. Le modal ne disparaît que quand l'ACTION est faite (pas au tap à côté) ;
 *  • AUCUNE redirection automatique : les écrans de présentation rendent la main sur le TABLEAU DE
 *    BORD, qui reprend les trois étapes et porte le bouton « Créer mes comptes ».
 *
 * Écriture des drapeaux : optimiste en local (`justSet`) pour que le modal se referme AU TAP, puis
 * persistée. Sans ça, chaque étape attendait l'aller-retour Supabase pour disparaître.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useProfile } from '../hooks/useProfile';
import { useAccounts } from '../hooks/useAccounts';
import { useTransactions } from '../hooks/useTransactions';
import { useCategories, useSeedDefaultCategories } from '../hooks/useCategories';
import { useUpdateOnboarding, ALL_PAGE_INTRO_KEYS } from '../hooks/useOnboarding';

/** Drapeaux du parcours (dans profiles.onboarding_state — aucune migration). */
export type GuideFlag =
  | 'g2_started'        // le parcours a démarré (fige l'éligibilité : plus de dépendance aux données)
  | 'g2_intro'          // explication initiale lue (« J'ai compris »)
  | 'g2_comptes_tour'   // présentation de la page Comptes + repères vus
  | 'g2_nudge_savings'  // invitation « ajoute une épargne » passée ou honorée
  | 'g2_tx_tour'        // présentation de la page Transactions + repères vus
  | 'g2_pilot_tour'     // repères du Pilotage vus
  | 'g2_variable'       // estimation des dépenses variables saisie (> 0)
  | 'g2_margin'         // marge de sécurité enregistrée (0 accepté)
  | 'g2_relyka'         // détail du Relyka ouvert
  | 'g2_menu'           // menu de l'entête présenté (dernier geste du parcours)
  | 'g2_done'           // parcours terminé
  | 'g2_profile_shown'; // conclusion « ton profil financier » montrée (une seule fois, à la fin)

/** Étape active. Une seule à la fois, dans cet ordre. */
export type GuideStage =
  | 'idle'
  | 'intro'
  | 'accounts'            // aucun compte : modal à 2 choix (création rapide / créer un compte)
  | 'comptes_tour'        // 1er compte créé → présentation de la page Comptes
  | 'accounts_checking'   // des comptes, mais aucun compte courant (bloquant)
  | 'accounts_savings'    // aucune épargne (recommandé, passable)
  | 'tx_tour'             // présentation de la page Transactions
  | 'tx_recurring'        // créer au moins une dépense/recette récurrente (bloquant)
  | 'pilotage_tour'       // repères du Pilotage
  | 'pilotage_variable'   // « Tu devrais encore dépenser » → estimation obligatoire
  | 'pilotage_margin'     // « Tu veux garder au moins » → enregistrement obligatoire
  | 'pilotage_relyka'     // ouvrir le détail du Relyka
  | 'pilotage_menu';      // le menu de l'entête — en DERNIER, sinon il passait par-dessus le
                          // déploiement du bouton « + » et son cadre ne se remarquait pas

interface GuideCtx {
  /** Le parcours concerne-t-il cet utilisateur (et n'est-il pas terminé) ? */
  active: boolean;
  /** Le parcours est en jeu mais on ne sait pas encore À QUELLE ÉTAPE : l'écran doit rester couvert
   *  (sinon l'app se montre une seconde avant que la présentation ne prenne la main). */
  booting: boolean;
  stage: GuideStage;
  /** Raccourci de lecture : `guide.is('tx_tour')`. */
  is: (s: GuideStage) => boolean;
  /** Marque un drapeau (optimiste + persisté) → l'étape suivante s'active. */
  done: (flag: GuideFlag) => void;
  /** L'utilisateur a des comptes ? (utile aux écrans pour adapter leur texte) */
  hasChecking: boolean;
  hasSavings: boolean;
  /** Le tour vient de se terminer et sa CONCLUSION (le profil financier) reste à montrer. */
  tourJustFinished: boolean;
}

const Ctx = createContext<GuideCtx>({
  active: false, booting: false, stage: 'idle', is: () => false, done: () => {},
  hasChecking: false, hasSavings: false, tourJustFinished: false,
});

export function GuideProvider({ children }: { children: React.ReactNode }) {
  const { user, isImpersonating } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const accountsQuery = useAccounts(user?.id);
  const txQuery = useTransactions(user?.id);
  const update = useUpdateOnboarding(user?.id);
  const accounts = accountsQuery.data ?? [];
  const transactions = txQuery.data ?? [];
  // ⚠️ TOUT ce qui suit se déduit de l'ABSENCE de données (« aucun compte » = étape 1). Une lecture
  // simplement EN COURS renvoie elle aussi une liste vide : sans cette garde, un compte existant
  // serait vu comme neuf au démarrage — guide relancé et tableau de bord basculé en simplifié.
  const dataReady = accountsQuery.isSuccess && txQuery.isSuccess;
  /* ⚠️ Et une lecture EN COURS DE RAFRAÎCHISSEMENT rend l'ANCIENNE liste, donc encore vide juste
     après la création des premiers comptes. La page Comptes lit `useAllAccounts` (autre requête,
     autre réponse réseau) : elle affichait déjà les comptes créés pendant que le guide, lui, en
     était encore à « tu n'as aucun compte » et rouvrait le modal « Étape 1 » par-dessus.
     Tant que la liste est vide ET en cours de lecture, on ne conclut rien. */
  const accountsSettled = !accountsQuery.isFetching;
  /* Même règle pour les RÉCURRENCES : au retour de l'écran de saisie, la liste est encore en cours
     de relecture — le guide en concluait « aucune récurrente » et rouvrait le modal « Étape 2 »
     par-dessus, alors que l'utilisateur venait précisément d'en créer une. */
  const txSettled = !txQuery.isFetching;

  // Drapeaux posés dans CE rendu, avant retour serveur (fermeture immédiate des modaux).
  const [justSet, setJustSet] = useState<Record<string, boolean>>({});
  const state = ((profile as any)?.onboarding_state ?? {}) as Record<string, any>;
  const flag = (f: GuideFlag) => Boolean(justSet[f] ?? state[f]);

  const done = useCallback((f: GuideFlag) => {
    setJustSet((prev) => (prev[f] ? prev : { ...prev, [f]: true }));
    if (isImpersonating) return;
    // Fin des écrans de présentation : ils ont déjà raconté chaque page (leurs textes en viennent).
    // On éteint donc les présentations « 1ʳᵉ visite » de chaque onglet — sinon l'utilisateur se
    // reprend le même discours en modal, cette fois en plein milieu d'une action.
    const extra = f === 'g2_intro'
      ? Object.fromEntries(ALL_PAGE_INTRO_KEYS.map((k) => ['intro_seen_' + k, true]))
      : {};
    update.mutate({ flags: { [f]: true, ...extra } as any });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isImpersonating, update.mutate]);

  // ── Éligibilité ────────────────────────────────────────────────────────────────────────────────
  // Un compte NEUF : aucun compte bancaire, et aucune trace des anciens parcours (tour ancré, vue de
  // découverte). Les comptes existants ne doivent jamais voir ce guide — d'où ces deux garde-fous.
  const fresh =
    !!profile && !isImpersonating && dataReady
    && accounts.length === 0
    && !(profile as any).app_tour_done
    && !state.discovery_intro_seen;
  const started = flag('g2_started');
  const active = !flag('g2_done') && (started || fresh) && !isImpersonating;

  /* ── Le guide est-il « en jeu » ? ──────────────────────────────────────────────────────────────
     Se lit sur le PROFIL SEUL (pas sur les comptes) : soit le parcours est commencé, soit il n'y a
     aucune trace d'un ancien parcours. C'est ce qui permet de couvrir l'écran PENDANT que comptes et
     transactions se chargent — sans ce voile, l'app s'affichait une seconde (tableau de bord vide)
     avant que le carrousel de présentation ne prenne la main. Un compte existant n'est jamais
     concerné : il porte `app_tour_done` ou `discovery_intro_seen`. */
  const guideInPlay = !!profile && !isImpersonating && !flag('g2_done')
    && (started || (!(profile as any).app_tour_done && !state.discovery_intro_seen));
  // ⚠️ Filet OBLIGATOIRE : hors-ligne, les requêtes restent « en pause » et `dataReady` ne vient
  // jamais. Sans borne, le voile ne se lèverait plus et l'app serait inutilisable.
  const [bootTimedOut, setBootTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setBootTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const booting = guideInPlay && !dataReady && !bootTimedOut;

  // Démarrage : on fige l'entrée dans le parcours ET on neutralise les anciennes présentations
  // (vue de découverte, intro de la checklist) qui feraient doublon par-dessus.
  // (`pilotage_simple` n'est plus posé ici : le tableau de bord n'a plus qu'UNE mise en page.)
  const bootRef = useRef(false);
  useEffect(() => {
    if (!active || started || bootRef.current) return;
    bootRef.current = true;
    setJustSet((prev) => ({ ...prev, g2_started: true }));
    update.mutate({ flags: {
      g2_started: true,
      discovery_intro_seen: true, checklist_intro_shown: true,
    } as any });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, started]);

  /* ── Catégories par défaut ─────────────────────────────────────────────────────────────────────
     Elles étaient créées par le questionnaire de démarrage (app/onboarding.tsx). Celui-ci n'étant
     plus la porte d'entrée, un compte neuf arrivait dans l'app SANS AUCUNE catégorie — et la
     sous-catégorie étant obligatoire à la saisie, il ne pouvait enregistrer ni dépense ni recette :
     l'étape 2 du guide était infranchissable. On les sème donc ici, une fois, dès l'entrée. */
  const categoriesQuery = useCategories(user?.id);
  const seedCategories = useSeedDefaultCategories(user?.id);
  const seededRef = useRef(false);
  useEffect(() => {
    if (!active || isImpersonating || seededRef.current) return;
    if (!categoriesQuery.isSuccess || (categoriesQuery.data?.length ?? 0) > 0) return;
    seededRef.current = true;
    seedCategories.mutate(undefined, { onError: () => { seededRef.current = false; } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, isImpersonating, categoriesQuery.isSuccess, categoriesQuery.data?.length]);

  // ── État réel ──────────────────────────────────────────────────────────────────────────────────
  const hasChecking = accounts.some((a: any) => a.type === 'checking');
  const hasSavings = accounts.some((a: any) => a.type === 'savings' || a.type === 'investment');
  const hasRecurring = (transactions as any[]).some((t) => t.is_recurring && t.recurrence_rule);

  const stage: GuideStage = useMemo(() => {
    if (!active) return 'idle';
    if (!flag('g2_intro')) return 'intro';
    // Au-delà de l'explication initiale, chaque étape se déduit des données : on attend qu'elles
    // soient réellement lues (un cache vide au démarrage renverrait l'utilisateur créer un compte
    // qu'il possède déjà).
    if (!dataReady) return 'idle';
    // Liste vide : ce n'est « aucun compte » que si la lecture est POSÉE (cf. accountsSettled).
    if (accounts.length === 0) return accountsSettled ? 'accounts' : 'idle';
    if (!flag('g2_comptes_tour')) return 'comptes_tour';
    if (!hasChecking) return 'accounts_checking';
    if (!hasSavings && !flag('g2_nudge_savings')) return 'accounts_savings';
    if (!flag('g2_tx_tour')) return 'tx_tour';
    // Aucune récurrente : on ne le conclut que si la lecture est POSÉE (cf. txSettled).
    if (!hasRecurring) return txSettled ? 'tx_recurring' : 'idle';
    if (!flag('g2_pilot_tour')) return 'pilotage_tour';
    if (!flag('g2_variable')) return 'pilotage_variable';
    if (!flag('g2_margin')) return 'pilotage_margin';
    if (!flag('g2_relyka')) return 'pilotage_relyka';
    if (!flag('g2_menu')) return 'pilotage_menu';
    return 'idle';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, justSet, state, dataReady, accountsSettled, txSettled, accounts.length, hasChecking, hasSavings, hasRecurring]);

  /* CONCLUSION : le parcours est fini (dernière bulle passée) mais le profil financier n'a pas
     encore été présenté. C'est le seul moment où on le montre — pas pendant l'installation, où il
     bouge à chaque saisie. */
  const tourJustFinished = !!profile && !isImpersonating && flag('g2_done') && !flag('g2_profile_shown');

  // Fin du parcours : toutes les étapes franchies → on referme définitivement.
  const closedRef = useRef(false);
  const lastStepDone = flag('g2_menu');
  useEffect(() => {
    if (!active || stage !== 'idle' || !lastStepDone || closedRef.current) return;
    closedRef.current = true;
    done('g2_done');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stage, lastStepDone]);

  // ── AUCUNE redirection automatique ──────────────────────────────────────────────────────────────
  // À la fin des écrans de présentation, l'utilisateur atterrit sur le TABLEAU DE BORD (la porte
  // d'entrée de l'app, cf. app/index.tsx) — pas sur Comptes. Le carrousel se termine sur les trois
  // étapes, et le tableau de bord les reprend aussitôt (components/PilotageWelcome) avec le bouton
  // qui emmène créer les comptes : le déplacer d'autorité privait l'utilisateur de cette page de
  // départ. Partout ailleurs il reste maître de sa navigation — l'étape l'attend sur la page
  // concernée dès qu'il y arrive.

  const value = useMemo<GuideCtx>(() => ({
    active, booting, stage, is: (s: GuideStage) => stage === s, done, hasChecking, hasSavings,
    tourJustFinished,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [active, booting, stage, done, hasChecking, hasSavings, tourJustFinished]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useGuide = () => useContext(Ctx);
