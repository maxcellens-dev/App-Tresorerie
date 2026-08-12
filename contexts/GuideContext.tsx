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
import { useIsMutating } from '@tanstack/react-query';
import { useAuth } from './AuthContext';
import { useProfile } from '../hooks/data/useProfile';
import { useAccounts } from '../hooks/data/useAccounts';
import { useTransactions } from '../hooks/data/useTransactions';
import { useCategories, useSeedDefaultCategories } from '../hooks/data/useCategories';
import { useUpdateOnboarding } from '../hooks/engagement/useOnboarding';

/* La MACHINE À ÉTATS du parcours (ordre des étapes, éligibilité, conditions d'arrêt) vit
   désormais dans lib/guideStages — logique pure, donc testable : voir __tests__/guideStages.test.ts.
   Ce contexte ne fait plus que collecter l'état réel et le lui passer. Types et constantes sont
   réexportés ici pour que rien de ce qui importait `GuideStage`/`SETUP_STAGES` n'ait à bouger. */
import {
  SETUP_STAGES, computeGuideStage, isGuideActive, isGuideInPlay, isTourJustFinished,
  type GuideFlag, type GuideInput, type GuideStage,
} from '../lib/engagement/guideStages';
export type { GuideFlag, GuideStage } from '../lib/engagement/guideStages';
export { SETUP_STAGES } from '../lib/engagement/guideStages';

interface GuideCtx {
  /** Le parcours concerne-t-il cet utilisateur (et n'est-il pas terminé) ? */
  active: boolean;
  /** Le parcours est en jeu mais on ne sait pas encore À QUELLE ÉTAPE : l'écran doit rester couvert
   *  (sinon l'app se montre une seconde avant que la présentation ne prenne la main). */
  booting: boolean;
  stage: GuideStage;
  /** Raccourci de lecture : `guide.is('tx_recurring')`. */
  is: (s: GuideStage) => boolean;
  /** Marque un drapeau (optimiste + persisté) → l'étape suivante s'active. */
  done: (flag: GuideFlag) => void;
  /** L'utilisateur a des comptes ? (utile aux écrans pour adapter leur texte) */
  hasChecking: boolean;
  hasSavings: boolean;
  /** Le tour vient de se terminer et sa CONCLUSION (le profil financier) reste à montrer. */
  tourJustFinished: boolean;
  /** L'installation n'est pas assez avancée pour que le tableau de bord ait un sens (cf. SETUP_STAGES). */
  inSetup: boolean;
}

const Ctx = createContext<GuideCtx>({
  active: false, booting: false, stage: 'idle', is: () => false, done: () => {},
  hasChecking: false, hasSavings: false, tourJustFinished: false, inSetup: false,
});

/* Délai après la dernière écriture avant de reconclure sur les données. Assez long pour couvrir
   l'invalidation + le départ de la relecture sur un téléphone lent, assez court pour qu'une étape
   légitime n'attende pas. Si l'écriture a réellement échoué, l'étape revient après ce délai : rien
   n'est perdu, c'est juste différé. */
const WRITE_GRACE_MS = 1200;

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
  /* ⚠️ Et il reste un TROU que `isFetching` ne couvre pas, celui qui ramenait le modal « Étape 1 »
     sous le nez de l'utilisateur : entre la fin de l'écriture et le début de la relecture, la
     requête n'est NI en cours d'écriture NI en cours de lecture — elle rend encore l'ancienne
     liste, vide. Sur un téléphone lent, cette fenêtre dure assez pour que le modal se rouvre.
     On considère donc l'état comme non conclu tant qu'une écriture est en vol, plus un court
     délai après la dernière : le temps que l'invalidation ait déclenché la relecture.
     Vaut pour TOUTES les étapes déduites des données, pas seulement les comptes. */
  const mutating = useIsMutating();
  const [writeSettled, setWriteSettled] = useState(true);
  useEffect(() => {
    if (mutating > 0) { setWriteSettled(false); return; }
    const t = setTimeout(() => setWriteSettled(true), WRITE_GRACE_MS);
    return () => clearTimeout(t);
  }, [mutating]);

  const accountsSettled = !accountsQuery.isFetching && writeSettled;
  /* Même règle pour les RÉCURRENCES : au retour de l'écran de saisie, la liste est encore en cours
     de relecture — le guide en concluait « aucune récurrente » et rouvrait le modal « Étape 2 »
     par-dessus, alors que l'utilisateur venait précisément d'en créer une. */
  const txSettled = !txQuery.isFetching && writeSettled;

  // Drapeaux posés dans CE rendu, avant retour serveur (fermeture immédiate des modaux).
  const [justSet, setJustSet] = useState<Record<string, boolean>>({});
  const state = ((profile as any)?.onboarding_state ?? {}) as Record<string, any>;
  const flag = (f: GuideFlag) => Boolean(justSet[f] ?? state[f]);

  const done = useCallback((f: GuideFlag) => {
    setJustSet((prev) => (prev[f] ? prev : { ...prev, [f]: true }));
    if (isImpersonating) return;
    update.mutate({ flags: { [f]: true } as any });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isImpersonating, update.mutate]);

  // ── État réel des données ──────────────────────────────────────────────────────────────────────
  const hasChecking = accounts.some((a: any) => a.type === 'checking');
  const hasSavings = accounts.some((a: any) => a.type === 'savings' || a.type === 'investment');
  const hasRecurring = (transactions as any[]).some((t) => t.is_recurring && t.recurrence_rule);

  /* Tout ce que la machine à états a besoin de savoir, et rien de plus. C'est le SEUL point de
     contact entre le monde asynchrone (requêtes, mutations) et la décision : les règles d'ordre,
     elles, sont pures et testées (lib/guideStages). */
  const input: GuideInput = useMemo(() => ({
    hasProfile: !!profile,
    isImpersonating,
    flags: { ...state, ...justSet } as GuideInput['flags'],
    appTourDone: Boolean((profile as any)?.app_tour_done),
    discoveryIntroSeen: Boolean(state.discovery_intro_seen),
    dataReady, accountsSettled, txSettled,
    accountsCount: accounts.length,
    hasChecking, hasSavings, hasRecurring,
  }), [profile, isImpersonating, state, justSet, dataReady, accountsSettled, txSettled,
       accounts.length, hasChecking, hasSavings, hasRecurring]);

  const started = flag('g2_started');
  const active = isGuideActive(input);

  /* ── Le guide est-il « en jeu » ? ──────────────────────────────────────────────────────────────
     Se lit sur le PROFIL SEUL (pas sur les comptes) : soit le parcours est commencé, soit il n'y a
     aucune trace d'un ancien parcours. C'est ce qui permet de couvrir l'écran PENDANT que comptes et
     transactions se chargent — sans ce voile, l'app s'affichait une seconde (tableau de bord vide)
     avant que le carrousel de présentation ne prenne la main. Un compte existant n'est jamais
     concerné : il porte `app_tour_done` ou `discovery_intro_seen`. */
  const guideInPlay = isGuideInPlay(input);
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

  /* L'ORDRE des étapes (et les deux façons d'être « idle » : plus rien à faire, ou pas encore su)
     est entièrement décrit par `computeGuideStage`, testé pas à pas. */
  const stage: GuideStage = useMemo(() => computeGuideStage(input), [input]);

  /* Installation en cours : le Relyka n'a pas encore de quoi être calculé. Le Pilotage remplace
     alors tout son contenu par l'accueil, qui porte la PROCHAINE action — afficher une grille de
     zéros ferait croire que l'app ne marche pas, et n'indiquerait nulle part par où commencer. */
  const inSetup = active && SETUP_STAGES.includes(stage);

  /* CONCLUSION : le parcours est fini (dernière étape franchie) mais le profil financier n'a pas
     encore été présenté. C'est le seul moment où on le montre — pas pendant l'installation, où il
     bouge à chaque saisie. */
  const tourJustFinished = isTourJustFinished(input);

  // Fin du parcours : toutes les étapes franchies → on referme définitivement.
  // La marge de sécurité (g2_margin) est désormais la DERNIÈRE étape réelle (cf. `stage` ci-dessus :
  // les présentations en bulles qui suivaient — Relyka, menu — ont été retirées).
  const closedRef = useRef(false);
  const lastStepDone = flag('g2_margin');
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

  /* ── CHANGEMENT D'UTILISATEUR : tout ce parcours est local, il doit repartir de zéro ───────────
     `GuideProvider` est monté une seule fois à la racine et n'est JAMAIS démonté : se déconnecter
     ne fait que naviguer et vider le cache des requêtes (cf. AuthContext.signOut). Les drapeaux
     optimistes (`justSet`) et les verrous « une seule fois » ci-dessus survivaient donc au
     changement de compte — sans purge, quelqu'un qui se connecte après un autre sur le même
     appareil HÉRITAIT de son avancement : étapes sautées, et parcours entièrement escamoté si le
     précédent portait `g2_done`. Exactement le symptôme « les modaux n'apparaissent pas dans
     l'ordre ». On les remet à l'état neuf dès que l'identité change. */
  const lastUserRef = useRef(user?.id);
  useEffect(() => {
    if (lastUserRef.current === user?.id) return;
    lastUserRef.current = user?.id;
    bootRef.current = false;
    seededRef.current = false;
    closedRef.current = false;
    setJustSet((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, [user?.id]);

  const value = useMemo<GuideCtx>(() => ({
    active, booting, stage, is: (s: GuideStage) => stage === s, done, hasChecking, hasSavings,
    tourJustFinished, inSetup,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [active, booting, stage, done, hasChecking, hasSavings, tourJustFinished, inSetup]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useGuide = () => useContext(Ctx);
