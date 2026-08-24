import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePendingProfileChange, useMarkNotificationShown, useProfileNotificationMessages, useProfileAllocations, useFinancialProfile } from '../../hooks/pilotage/useFinancialProfile';
import { PROFILE_INFO, PROFILE_ALLOCATIONS, resolveProfileId } from '../../lib/finance/financialProfileEngine';
import type { FinancialProfileId } from '../../types/database';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useAuth } from '../../contexts/AuthContext';
import { useGuide } from '../../contexts/GuideContext';
import { useInterruptSlot } from '../../hooks/engagement/useInterruptSlot';
import { sheetWidth } from '../../lib/ui/appLayout';
import { usePilotageData } from '../../hooks/pilotage/usePilotageData';
import { resolveMonthlyAllocation, situationFromPilotage, type Allocation } from '../../lib/finance/financialPriorities';
import { resolveRecoMode } from '../../lib/finance/recoMode';
import { useProfile, useUpdateProfile } from '../../hooks/data/useProfile';
import { useProfileReliability } from '../../hooks/pilotage/useProfileReliability';


interface Props {
  userId: string | undefined;
}

interface TransitionKey {
  transition: string;
  direction: 'upgrade' | 'downgrade' | 'exceptional' | 'same';
  /** Nombre de paliers franchis. 1 = passage voisin, ≥ 2 = saut. */
  steps: number;
}

function getTransitionKey(prev: string | null, next: string, reason: string): TransitionKey | null {
  // Bilan mensuel : le profil n'a pas changé → message « maintien », clé = profil courant.
  if (reason === 'monthly_recap') {
    return { transition: next, direction: 'same', steps: 0 };
  }
  if (reason === 'exceptional_revenue_drop') {
    if (!prev) return null;
    const prevNum = parseInt(prev.replace('P', ''));
    const nextNum = parseInt(next.replace('P', ''));
    const diff = prevNum - nextNum;
    return { transition: diff >= 2 ? 'exceptional_two' : 'exceptional_one', direction: 'exceptional', steps: Math.abs(diff) };
  }

  if (!prev) return null;
  const prevNum = parseInt(prev.replace('P', ''));
  const nextNum = parseInt(next.replace('P', ''));
  const steps = Math.abs(nextNum - prevNum);
  if (nextNum > prevNum) {
    return { transition: `P${prevNum}_P${nextNum}`, direction: 'upgrade', steps };
  }
  return { transition: `P${nextNum}_P${prevNum}`, direction: 'downgrade', steps };
}

// Replis si la ligne n'existe pas en base — TUTOIEMENT, comme partout dans l'app (migration 145).
const DEFAULT_MESSAGES: Record<string, { title: string; body: string }> = {
  'P1_P2|upgrade':    { title: '🌿 Tu changes de profil', body: 'Ton matelas de sécurité commence à se constituer. C\'est une vraie avancée.' },
  'P2_P3|upgrade':    { title: '⚖️ Tu changes de profil', body: 'Ta base financière est solide et ton comportement d\'épargne est régulier.' },
  'P3_P4|upgrade':    { title: '🚀 Tu changes de profil', body: 'Excellent travail. Ta réserve est confortable et tu investis régulièrement.' },
  'P4_P5|upgrade':    { title: '🎯 Tu changes de profil', body: 'Tu as atteint un niveau de maturité financière remarquable.' },
  'P1_P2|downgrade':  { title: '🌱 Ton profil évolue', body: 'Ta réserve s\'est réduite ou ton épargne est à l\'arrêt. Pas d\'inquiétude.' },
  'P2_P3|downgrade':  { title: '🌿 Ton profil évolue', body: 'Ta réserve est en dessous du seuil recommandé.' },
  'P3_P4|downgrade':  { title: '⚖️ Ton profil évolue', body: 'Ta réserve ou ton épargne a baissé temporairement.' },
  'P4_P5|downgrade':  { title: '🚀 Ton profil évolue', body: 'Ton flux d\'investissement est passé en dessous du seuil.' },
  'exceptional_one|exceptional': { title: '⚠️ Profil ajusté suite à une baisse de revenus', body: 'Tes revenus des 2 derniers mois sont inférieurs à ta moyenne habituelle.' },
  'exceptional_two|exceptional': { title: '⚠️ Profil ajusté — aucun revenu détecté', body: 'Aucun revenu enregistré ces 2 derniers mois.' },
  'P1|same': { title: '🌱 Tu conserves le profil', body: 'Ce mois-ci, ton profil reste inchangé. \nContinue à constituer ton matelas de sécurité.' },
  'P2|same': { title: '🌿 Tu conserves le profil', body: 'Ton profil reste stable ce mois-ci. \nPoursuis le renforcement de ta réserve.' },
  'P3|same': { title: '⚖️ Tu conserves le profil', body: 'Ta situation reste stable ce mois-ci. \nContinue sur cette lancée.' },
  'P4|same': { title: '🚀 Tu conserves le profil', body: 'Ton profil reste solide ce mois-ci. \nTa dynamique d\'investissement se confirme.' },
  'P5|same': { title: '🎯 Tu conserves le profil', body: 'Ta maturité financière se maintient ce mois-ci. \nContinue à optimiser ton patrimoine.' },
};

/* Repli de DERNIER recours, par sens de variation ET par AMPLITUDE.
   Les libellés ci-dessus ne couvrent que les passages d'UN palier. Or depuis que le profil est
   évalué en temps réel, les sauts de plusieurs paliers sont devenus COURANTS — ajouter son compte
   d'épargne fait passer de P2 à P6 d'un coup. Un « ta situation s'est renforcée » générique gâche
   alors le seul moment où l'utilisateur mesure ce qu'il a accompli.
   On ne multiplie pas les libellés par paire (il en faudrait 45) : on parle de ce qui est
   réellement remarquable — le nombre de paliers franchis. */
const GENERIC_BY_DIRECTION: Record<string, string> = {
  upgrade: 'Ta situation s’est renforcée : Relyka en tient compte dans ce qu’il te recommande.',
  downgrade: 'Ta situation s’est resserrée : Relyka redevient plus prudent, le temps que ça remonte.',
  exceptional: 'Relyka s’adapte à ce que disent tes derniers mois.',
  /* ⚠️ Le MAINTIEN n'avait aucun repli, et c'était visible en production.
     Les libellés « same » n'existent en base que pour P1 à P5 : l'échelle est passée à dix paliers,
     les messages de maintien ne les ont jamais suivis. Le bilan mensuel d'un P6 à P9 (ou d'un P0)
     ne trouvait donc ni ligne en base, ni repli dans le code — il s'affichait avec un corps VIDE,
     sous un titre « Ton profil a changé » alors que, par définition, rien n'avait changé. Tous les
     mois. */
  same: 'Ton profil ne bouge pas ce mois-ci : Relyka continue de répartir ton Relyka de la même façon.',
};

/**
 * Titre de repli, par sens. Un bilan de MAINTIEN ne peut pas s'annoncer « ton profil a changé » :
 * c'est exactement le contraire de ce qu'il vient constater.
 */
const GENERIC_TITLE_BY_DIRECTION: Record<string, string> = {
  same: 'Tu conserves ton profil',
};

/** Message des SAUTS (2 paliers et plus), qu'aucun libellé par paire ne couvre. */
function leapMessage(direction: string, steps: number): string | null {
  if (steps < 2) return null;
  if (direction === 'upgrade') {
    return `Tu franchis ${steps} paliers d’un coup : ce que tu viens d’enregistrer change nettement ta situation. Relyka ajuste ses recommandations en conséquence.`;
  }
  if (direction === 'downgrade') {
    return `Ton profil recule de ${steps} paliers. Ce n’est pas un jugement : Relyka redevient simplement plus prudent tant que la situation ne s’est pas rétablie.`;
  }
  return null;
}

export default function ProfileChangeModal({ userId }: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isImpersonating } = useAuth();
  const guide = useGuide();
  const { data: pilotage } = usePilotageData(userId);
  const { data: pendingChange } = usePendingProfileChange(userId);
  /* Le palier ACTUEL, pas celui figé dans le journal — cf. `announcedProfile` plus bas. */
  const { data: currentProfileRow } = useFinancialProfile(userId);
  const { data: dbMessages = [] } = useProfileNotificationMessages();
  const markShown = useMarkNotificationShown(userId);
  /* Les pourcentages annoncés sont ceux qui seront appliqués : même table que le moteur. */
  const { data: allocTable = PROFILE_ALLOCATIONS } = useProfileAllocations();

  /* ── RÉPARTITION MANUELLE : ce changement de profil ne s'applique pas tout seul ────────────────
     Quelqu'un qui a posé ses propres pourcentages ne veut pas qu'un nouveau palier les efface — mais
     c'est précisément le moment où la question se pose, puisque sa situation vient de changer. On la
     pose donc ICI, une fois, sous forme de coche : ne rien faire garde ses pourcentages (c'est son
     choix initial, il n'a pas à le redire), cocher rend la main à l'app.
     Le profil, lui, a déjà été calculé et enregistré : il est à jour quoi qu'il décide. */
  const { data: userProfile } = useProfile(userId);
  const updateProfile = useUpdateProfile(userId);
  /* Sur quoi ce palier repose (cf. lib/finance/profileReliability) — information, jamais un frein. */
  const reliability = useProfileReliability(userId);
  const relColor = reliability?.tone === 'warn' ? COLORS.orange
    : reliability?.tone === 'bad' ? COLORS.danger : (COLORS.green ?? COLORS.emerald);
  const recoMode = useMemo(() => resolveRecoMode(userProfile), [userProfile]);
  const [backToAuto, setBackToAuto] = useState(false);
  // Une nouvelle annonce = une nouvelle question : la coche ne se souvient pas de la précédente.
  useEffect(() => { setBackToAuto(false); }, [pendingChange?.ids.join(',')]);

  /* PARCOURS DE DÉMARRAGE : on ne montre RIEN, et on consomme la notification en arrière-plan.
     Pendant l'installation, l'utilisateur saisit ses comptes puis ses récurrences : son profil se
     recalcule à chaque fois et grimpe (P1 → P3…). Chaque saut créait une notification, qui
     s'affichait par-dessus les écrans de présentation — un « ton profil a changé » avant même
     d'avoir vu l'app. On la marque donc comme vue sans la montrer : elle n'attend pas non plus la
     fin du guide pour resurgir hors contexte. */
  /* Silence pendant TOUT le parcours de démarrage, ET jusqu'à ce que sa conclusion ait été
     montrée (ProfileTourConclusion) : c'est elle qui présente le profil à la fin du tour, ce modal
     ne doit pas la doubler ni la précéder. */
  const duringGuide = guide.active || guide.booting || guide.tourJustFinished;

  /* ── UNIQUEMENT SUR LE TABLEAU DE BORD ────────────────────────────────────────────────────────
     Le profil se recalcule dès qu'une donnée bouge : la fenêtre pouvait donc s'ouvrir en pleine
     saisie de transaction, au milieu d'un virement ou dans un écran de réglages — c'est-à-dire
     précisément là où l'utilisateur est en train de faire autre chose. Elle interrompait pour
     annoncer la CONSÉQUENCE de ce qu'il venait de faire, avant même qu'il ait fini.
     Elle attend donc le Pilotage : c'est l'écran des recommandations, celui que le changement de
     palier modifie réellement, et le seul où l'annonce tombe au bon moment. Rien n'est perdu — les
     lignes non lues restent en attente aussi longtemps qu'il faut. */
  const segments = useSegments();
  const onPilotage = segments[segments.length - 1] === 'pilotage';
  /* Le changement de profil vient APRÈS la clôture et le bilan du mois : il en est la conséquence.
     L'annoncer avant, c'était livrer le verdict d'un calcul dont l'utilisateur n'a pas encore vu
     les données (cf. lib/interruptQueue). */
  const myTurn = useInterruptSlot(
    'profile_change',
    /* `onPilotage` entre AUSSI dans la candidature au créneau : sans ça, la fenêtre réserverait le
       créneau d'interruption depuis n'importe quel écran sans jamais s'afficher — et bloquerait les
       autres annonces qui, elles, avaient le droit de parler. */
    !isImpersonating && !duringGuide && onPilotage && !!pendingChange?.display,
  );
  /* Consommation SILENCIEUSE : pendant le parcours de démarrage (voir ci-dessus), et quand les
     changements en attente s'annulent entre eux (`display: false`) — il n'y a alors rien à
     annoncer, mais laisser les lignes en attente les ferait ressortir au prochain lancement. */
  const consumeSilently = !!pendingChange && !isImpersonating && (duringGuide || !pendingChange.display);
  useEffect(() => {
    if (!consumeSilently || !pendingChange) return;
    markShown.mutate(pendingChange.ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consumeSilently, pendingChange?.ids.join(',')]);

  // En consultation admin : ne pas afficher le message de bilan/changement de profil du compte
  // cible (ni le marquer comme « vu »). C'est une notification destinée à l'utilisateur lui-même.
  if (isImpersonating) return null;
  if (duringGuide) return null;
  // Ailleurs que sur le tableau de bord : on attend. La ligne non lue reste en attente.
  if (!onPilotage) return null;
  if (!pendingChange || !pendingChange.display) return null;
  // Pas encore notre tour : la clôture et/ou le bilan du mois parlent d'abord.
  if (!myTurn) return null;

  /* ── UN BILAN ANNONCE LE PALIER D'AUJOURD'HUI, PAS CELUI DU JOUR OÙ IL A ÉTÉ POSÉ ─────────────
     Le bilan mensuel est écrit au montage du tableau de bord ; le recalcul du profil, lui, arrive
     une seconde plus tard (le temps que les données se posent). Quand ce recalcul est SILENCIEUX —
     le cas d'un reclassement après changement des règles, marqué « déjà vu » — la seule ligne non
     lue qui reste est le bilan, et il porte le palier d'AVANT. La fenêtre annonçait donc
     « tu conserves ton profil Équilibre trouvé » à quelqu'un qui venait de passer ailleurs.
     Un bilan dit « voilà où tu en es » : il lit donc le profil courant. Les vraies transitions, elles,
     gardent le palier journalisé — c'est leur objet. */
  const announcedProfile = pendingChange.change_reason === 'monthly_recap' && currentProfileRow?.profile_id
    ? resolveProfileId(currentProfileRow.profile_id)
    : pendingChange.new_profile;

  const key = getTransitionKey(
    pendingChange.previous_profile,
    announcedProfile,
    pendingChange.change_reason,
  );

  // Le titre par défaut suit le SENS : un bilan de maintien n'annonce pas un changement.
  let title = (key && GENERIC_TITLE_BY_DIRECTION[key.direction]) || 'Ton profil a changé';
  let body = '';

  if (key) {
    const dbMsg = dbMessages.find(
      m => m.transition === key.transition && m.direction === key.direction,
    );
    if (dbMsg) {
      title = dbMsg.title;
      body = dbMsg.body;
    } else {
      /* Un SAUT de plusieurs paliers passe avant le libellé par paire : celui-ci n'existe de toute
         façon que pour les passages voisins, et il raconterait une étape que l'utilisateur n'a pas
         vécue. */
      const leap = leapMessage(key.direction, key.steps);
      const fallback = DEFAULT_MESSAGES[`${key.transition}|${key.direction}`];
      if (leap) body = leap;
      else if (fallback) { title = fallback.title; body = fallback.body; }
      else body = GENERIC_BY_DIRECTION[key.direction] ?? '';
    }
  }

  /* Ramené sur le référentiel de CE bundle : un identifiant venu d'une migration plus récente que
     l'application installée laissait la table des profils sans réponse, et la fenêtre s'ouvrait sans
     nom, sans emblème et sans répartition — un « ton profil a changé » qui ne dit pas en quoi.
     Le reste de l'app clampe déjà partout (cf. resolveProfileId). */
  const newProfileId = resolveProfileId(announcedProfile);
  const profileInfo = PROFILE_INFO[newProfileId];

  const isUpgrade = key?.direction === 'upgrade';
  const isDowngrade = key?.direction === 'downgrade';
  const isSame = key?.direction === 'same';
  const accentColor = profileInfo?.color ?? COLORS.emerald;

  /* ── CE QUE LE CHANGEMENT CHANGE POUR DE VRAI ──────────────────────────────────────────────────
     Le modal annonçait un profil sans jamais dire à quoi il sert. Or son UNIQUE rôle est de fixer
     la répartition du Relyka (cf. deriveRecoAllocations : le profil choisit directement la table
     d'allocation) : sans ça, un « ton profil évolue » se lisait comme un simple badge — surtout à
     la BAISSE, où la ligne de message est souvent vide (aucun libellé n'existe pour les sauts de
     plusieurs paliers, ex. P4 → P2) et où il ne restait donc que le nom du nouveau profil.
     On montre donc les nouveaux pourcentages, avec l'écart par poste quand il y a un avant : c'est
     exactement ce qui bouge, et ça se lit en une seconde. */
  /* Les pourcentages ANNONCÉS sont ceux qui seront APPLIQUÉS. La table brute du palier est ajustée
     par la priorité du mois (cf. resolveMonthlyAllocation) : afficher 30 % d'investissement dans la
     fenêtre qui célèbre un nouveau palier, pendant que le tableau de bord en recommande 0 parce que
     le mois ne se boucle pas, c'est se contredire à une seconde d'intervalle.
     La comparaison avant/après reste faite à priorité ÉGALE — c'est bien l'effet du CHANGEMENT DE
     PALIER qu'on montre, pas celui de la situation du mois, qui n'a pas bougé entre les deux. */
  /* Situation du mois : fonction PARTAGÉE (lib/financialPriorities). Recopiée ici, elle OMETTAIT
     le découvert chronique — cette fenêtre pouvait donc annoncer une répartition que le tableau de
     bord, lui, bornait autrement. */
  const situation = situationFromPilotage(pilotage);
  const applied = (id: FinancialProfileId, base?: Allocation | null) =>
    (situation ? resolveMonthlyAllocation(id, situation, base, allocTable).alloc : (base ?? allocTable[id]));

  const prevProfileId = pendingChange.previous_profile ? resolveProfileId(pendingChange.previous_profile) : null;
  /* En mode manuel, la répartition affichée est CELLE QUI S'APPLIQUERA après ce que l'utilisateur
     vient de décider dans cette fenêtre : ses pourcentages tant que la coche est vide, ceux du
     nouveau profil dès qu'il la coche. Elle bouge donc sous ses yeux au moment où il coche — c'est
     la réponse à sa question, il n'a pas à la chercher sur le tableau de bord. */
  const isManual = recoMode.mode === 'manual';
  const keepManual = isManual && !backToAuto;
  const nextAlloc = applied(newProfileId, keepManual ? recoMode.manualAllocation : null);
  const prevAlloc = isManual
    ? applied(prevProfileId ?? newProfileId, recoMode.manualAllocation)
    : (prevProfileId && prevProfileId !== newProfileId ? applied(prevProfileId) : null);
  const ALLOC_ROWS: { label: string; k: 'save' | 'invest' | 'enjoy' | 'keep'; color: string }[] = [
    { label: 'Épargner', k: 'save', color: COLORS.green ?? COLORS.emerald },
    { label: 'Investir', k: 'invest', color: COLORS.violet },
    { label: 'Confort', k: 'enjoy', color: COLORS.orange },
    { label: 'Conserver', k: 'keep', color: COLORS.blue },
  ];

  function handleClose() {
    // Retour à l'automatique DEMANDÉ dans cette fenêtre. Les pourcentages saisis restent enregistrés :
    // revenir en manuel plus tard ne demande pas de tout ressaisir (cf. RecoModeModal).
    if (isManual && backToAuto) {
      updateProfile.mutate({ reco_mode: 'auto' });
    }
    // TOUTES les lignes en attente, pas seulement celle annoncée : c'est ce qui évite l'enchaînement
    // de modaux (« j'ai compris » → un autre changement s'ouvre → un troisième…).
    markShown.mutate(pendingChange!.ids);
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>

            {/* Direction badge */}
            <View style={[styles.directionBadge, {
              backgroundColor: isUpgrade ? '#1a2f1a' : isDowngrade ? '#2a1a1a' : isSame ? '#16223a' : '#1a1a2a',
            }]}>
              <Ionicons
                name={isUpgrade ? 'trending-up' : isDowngrade ? 'trending-down' : isSame ? 'sync' : 'warning'}
                size={16}
                color={isUpgrade ? COLORS.emerald : isDowngrade ? '#f87171' : isSame ? '#60a5fa' : '#f59e0b'}
              />
              <Text style={[styles.directionText, {
                color: isUpgrade ? COLORS.emerald : isDowngrade ? '#f87171' : isSame ? '#60a5fa' : '#f59e0b',
              }]}>
                {/* Pas « Bilan du mois » : ce message n'est pas un bilan mensuel, il peut arriver
                    à n'importe quel moment dès que les données bougent. */}
                {isUpgrade ? 'Progression' : isDowngrade ? 'Ajustement' : isSame ? 'Ton profil' : 'Alerte'}
              </Text>
            </View>

            {/* Titre */}
            <Text style={styles.title}>{title}</Text>

            {/* Nouveau profil */}
            {profileInfo && (
              <View style={[styles.profileCard, { borderColor: accentColor }]}>
                <Text style={styles.profileEmoji}>{profileInfo.emoji}</Text>
                <View style={styles.profileInfo}>
                  <Text style={[styles.profileName, { color: accentColor }]}>{profileInfo.name}</Text>
                  <Text style={styles.profileTier}>{profileInfo.tier}</Text>
                </View>
              </View>
            )}

            {/* SUR QUOI CE PALIER REPOSE. Annoncer un profil sans dire ce qui l'a produit, c'est
                livrer un verdict : l'utilisateur ne peut ni le comprendre, ni savoir quoi faire
                pour qu'il change. On ne l'affiche que s'il y a quelque chose à signaler — sur un
                profil fiable, la mention n'apporterait rien. */}
            {!!reliability && reliability.level !== 'reliable' && (
              <View style={[styles.relRow, { borderColor: relColor + '55', backgroundColor: relColor + '12' }]}>
                <View style={[styles.relDot, { backgroundColor: relColor }]} />
                <Text style={styles.relText}>
                  {reliability.title} — {reliability.gaps[0]?.label ?? reliability.summary}
                </Text>
              </View>
            )}

            {/* Corps du message */}
            {!!body && <Text style={styles.body}>{body}</Text>}

            {/* Transition (masquée pour un bilan « maintien » : pas de changement à montrer) */}
            {pendingChange.previous_profile && !isSame && (
              <View style={styles.transitionRow}>
                <Text style={styles.transitionFrom}>
                  {/* `prevProfileId` est CLAMPÉ (cf. resolveProfileId) : lu brut, le côté gauche de
                      la transition s'affichait vide sur une application plus ancienne que la base,
                      et la fenêtre annonçait « → P4 » sans dire d'où l'on venait. */}
                  {prevProfileId ? PROFILE_INFO[prevProfileId].emoji : ''}
                  {' '}
                  {prevProfileId ? PROFILE_INFO[prevProfileId].name : ''}
                </Text>
                <Ionicons name="arrow-forward" size={16} color={COLORS.textSecondary} />
                <Text style={[styles.transitionTo, { color: accentColor }]}>
                  {profileInfo?.emoji} {profileInfo?.name}
                </Text>
              </View>
            )}

            {/* La conséquence CONCRÈTE du profil : la répartition des recommandations. */}
            {!!nextAlloc && (
              <View style={styles.allocCard}>
                <View style={styles.allocHead}>
                  <Ionicons name="pie-chart-outline" size={15} color={COLORS.textSecondary} />
                  <Text style={styles.allocNote}>
                    {keepManual
                      ? (isSame
                          ? 'Tes pourcentages restent appliqués : ton Relyka continue de se répartir ainsi.'
                          : 'Tes pourcentages restent appliqués : ce changement de profil ne modifie pas tes recommandations.')
                      : isManual
                        ? 'Tu reviens aux recommandations de l’app : ton Relyka se répartira ainsi.'
                        : isSame
                          ? 'Tes recommandations ne changent pas : ton Relyka continue de se répartir ainsi.'
                          : 'Tes recommandations s’adaptent : ton Relyka se répartira désormais ainsi.'}
                  </Text>
                </View>
                <View style={styles.allocGrid}>
                  {ALLOC_ROWS.map((r) => {
                    const pct = nextAlloc[r.k];
                    const delta = prevAlloc ? pct - prevAlloc[r.k] : 0;
                    return (
                      <View key={r.k} style={styles.allocChip}>
                        <Text style={styles.allocLabel}>{r.label}</Text>
                        <Text style={[styles.allocPct, { color: r.color }]}>{pct} %</Text>
                        {/* Écart NEUTRE (jamais en rouge/vert) : plus d'épargne n'est pas « mieux »
                            que plus d'investissement — ça dépend justement du profil. */}
                        {delta !== 0 && (
                          <Text style={styles.allocDelta}>{delta > 0 ? '+' : '−'}{Math.abs(delta)}</Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* ── La question posée à qui a réglé ses pourcentages lui-même ────────────────────────
                Ne rien faire = garder ses pourcentages. C'est volontairement le comportement par
                défaut : il a déjà exprimé ce choix, et une fenêtre qu'on ferme d'un geste ne doit
                pas défaire un réglage. Cocher rend la main à l'app, avec le nouveau palier.
                Seulement quand le PALIER A BOUGÉ : c'est ce qui rend la question pertinente (ses
                pourcentages ont été posés dans une autre situation). Sur le bilan mensuel, qui
                n'annonce aucun changement, ce serait une décision à prendre sans raison — le
                réglage reste accessible depuis la page « Profil financier ». */}
            {isManual && !isSame && (
              <TouchableOpacity
                style={[styles.switchRow, backToAuto && { borderColor: accentColor }]}
                onPress={() => setBackToAuto((v) => !v)}
                activeOpacity={0.8}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: backToAuto }}
              >
                <Ionicons
                  name={backToAuto ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={backToAuto ? accentColor : COLORS.textSecondary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchLabel}>Revenir aux recommandations de l’app</Text>
                  <Text style={styles.switchHint}>
                    Tes pourcentages sont conservés : tu pourras y revenir quand tu veux.
                  </Text>
                </View>
              </TouchableOpacity>
            )}

          </ScrollView>

          {/* CTA — SafeAreaView NATIF (edges bottom) : il mesure les insets de SA fenêtre (celle du
              Modal), donc le bouton reste au-dessus de la barre de navigation du téléphone, quelle
              qu'elle soit (3 boutons, geste, aucune). L'ancienne marge FIXE de 40 px tombait en
              plein dessous sur les téléphones à barre de boutons : le bouton passait dessous.
              (useSafeAreaInsets lirait le provider de la fenêtre PRINCIPALE : toujours faux ici.) */}
          <SafeAreaView edges={['bottom']}>
            <TouchableOpacity style={[styles.cta, { backgroundColor: accentColor }]} onPress={handleClose}>
              <Text style={styles.ctaText}>J'ai compris</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  sheet: {
    ...sheetWidth,
    backgroundColor: c.cardSolid,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: c.cardBorder,
    maxHeight: '85%',
  },
  // Rythme resserré (l'ancien : padding 28 / gap 20) : sur un téléphone de taille courante, badge +
  // titre sur deux lignes + carte de profil + message + transition dépassaient la hauteur utile, et
  // la feuille se retrouvait collée à la barre système.
  sheetContent: {
    paddingHorizontal: 24,
    paddingTop: 22,
    gap: 16,
    paddingBottom: 10,
  },

  directionBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  directionText: { fontSize: 13, fontWeight: '700' },

  title: { fontSize: 22, fontWeight: '800', color: c.text, lineHeight: 28 },

  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 2, borderRadius: 16, padding: 16,
    backgroundColor: c.card,
  },
  profileEmoji: { fontSize: 36 },
  profileInfo: { flex: 1, gap: 2 },
  profileName: { fontSize: 17, fontWeight: '800' },
  profileTier: { fontSize: 12, color: c.textSecondary },

  body: { color: c.text, fontSize: 15, lineHeight: 24 },

  transitionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: c.cardBorder,
  },
  transitionFrom: { color: c.textSecondary, fontSize: 13, fontWeight: '500', flex: 1 },
  transitionTo: { fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' },

  // Répartition des recos : volontairement compacte (la feuille est déjà dense) — une phrase, puis
  // les quatre postes sur une ligne qui se replie.
  allocCard: {
    backgroundColor: c.card, borderRadius: 12, padding: 14, gap: 12,
    borderWidth: 1, borderColor: c.cardBorder,
  },
  allocHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  allocNote: { flex: 1, fontSize: 12.5, color: c.textSecondary, lineHeight: 18 },
  allocGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  allocChip: {
    flexDirection: 'row', alignItems: 'baseline', gap: 5,
    backgroundColor: c.bg, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 6,
    borderWidth: 1, borderColor: c.cardBorder,
  },
  allocLabel: { fontSize: 11.5, color: c.textSecondary },
  allocPct: { fontSize: 13, fontWeight: '800' },
  allocDelta: { fontSize: 10.5, color: c.textSecondary, fontWeight: '700' },

  // Coche « revenir à l'automatique » — bordure seule, aucun aplat : c'est une option, pas l'action
  // principale de la fenêtre (qui reste « J'ai compris »).
  switchRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: c.card, borderRadius: 12, padding: 13,
    borderWidth: 1, borderColor: c.cardBorder,
  },
  // Fiabilité : une pastille de ton + la cause principale, sous la carte du profil.
  relRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 8,
  },
  relDot: { width: 8, height: 8, borderRadius: 4 },
  relText: { flex: 1, fontSize: 12, color: c.textSecondary, lineHeight: 17 },

  switchLabel: { fontSize: 13.5, fontWeight: '700', color: c.text },
  switchHint: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16, marginTop: 2 },

  // Marge basse MINIMALE : c'est le SafeAreaView autour qui ajoute la hauteur réelle de la barre
  // système. Cumuler les deux repoussait le bouton hors de la feuille sur les petits écrans.
  cta: {
    marginHorizontal: 24, marginBottom: 14, marginTop: 8,
    paddingVertical: 16, borderRadius: 16, alignItems: 'center',
  },
  ctaText: { fontSize: 16, fontWeight: '800', color: c.bg },
});
}
