/**
 * PLAN — l'abonnement du compte : le plan en cours, ce que Premium apporte, ce qu'il coûte,
 * et comment le résilier. C'est la page que les menus appellent « Plan ».
 *
 * ── CE QUE CETTE PAGE NE DOIT JAMAIS FAIRE ──────────────────────────────────────────────────────
 * Affirmer quoi que ce soit sur le plan de l'utilisateur AVANT de le savoir. `usePlan()` rend
 * `premiumEnabled: false` / `isPremium: false` tant que les drapeaux et le profil ne sont pas
 * revenus — une valeur par défaut, pas une réponse. La page annonçait donc « L'offre Premium n'est
 * pas encore disponible » à TOUT LE MONDE le temps du chargement (et indéfiniment hors-ligne),
 * abonnés payants compris, puis proposait « S'abonner » à quelqu'un qui paye déjà. On attend
 * `isResolved` (cf. Reporting et Conseils Intelligents, qui appliquent déjà cette règle).
 *
 * ── ET CE QU'ELLE DOIT TOUJOURS PERMETTRE ───────────────────────────────────────────────────────
 * Résilier. Le bloc « abonné » suit `hasEntitlement` (le DROIT du compte) et non `isPremium` (qui
 * tombe aussi quand l'administrateur désactive l'offre pour tout le monde) : sans cela, couper
 * l'offre en admin enlevait à des abonnés facturés le seul bouton qui mène à l'annulation.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import { useAuth } from '../../../contexts/AuthContext';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { usePlan, useAwaitPremiumFromServer } from '../../../hooks/config/usePlan';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useSubmitLock } from '../../../hooks/platform/useSubmitLock';
import { useGamificationConfig } from '../../../hooks/engagement/useGamificationConfig';
import { purchasePremium, restorePurchases, getSubscriptionInfo, getPlanPrices, PURCHASES_SUPPORTED, type SubscriptionInfo } from '../../../lib/platform/purchases';

/** Avantages Premium. `route` = page concernée : la ligne devient cliquable et y renvoie. */
const BENEFITS: { key: string; icon: string; title: string; desc: string; route?: string }[] = [
  { key: 'ads', icon: 'eye-off', title: 'Zéro publicité', desc: 'Une expérience 100% épurée, sans bannières.' },
  { key: 'shop', icon: 'pricetags', title: 'Remise boutique', desc: 'Une réduction sur tous les achats en relyks.', route: '/(tabs)/(secondary)/boutique' },
  { key: 'color', icon: 'color-palette', title: 'Couleur personnalisée', desc: 'Choisis la couleur d\'accent que tu veux.', route: '/(tabs)/(secondary)/apparence' },
  { key: 'reporting', icon: 'bar-chart', title: 'Reporting', desc: 'Tableaux et graphiques détaillés de tes finances dans le temps.', route: '/(tabs)/reporting' },
  { key: 'ai', icon: 'sparkles', title: 'Conseils Intelligents personnalisés', desc: 'Des analyses sur-mesure selon ton profil.', route: '/(tabs)/conseils-ia' },
];

/**
 * Prix de REPLI, utilisés seulement tant que le store n'a pas répondu (et sur le web, où il n'y a
 * pas de store). Le prix réellement affiché vient de RevenueCat — cf. `getPlanPrices` : c'est lui
 * qui est débité, et il est localisé (devise et montant varient selon le pays du compte store).
 */
const FALLBACK_PLAN_PRICES = { monthly: '1,99 €', annual: '19,99 €' } as const;

/**
 * Réglages d'abonnement du store — seul endroit d'où une résiliation est possible.
 *
 * L'app n'est PAS distribuée sur l'App Store aujourd'hui : Google Play est donc le seul chemin, et
 * on n'en propose pas d'autre (un lien Apple ne mènerait à aucun abonnement). L'entrée `ios` reste
 * pour le jour où l'app y sera publiée — elle n'est atteignable que depuis un appareil iOS.
 */
const STORE_SUBSCRIPTIONS = {
  ios: 'https://apps.apple.com/account/subscriptions',
  android: 'https://play.google.com/store/account/subscriptions',
} as const;

export default function PremiumScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const goBack = useNavBack();
  /* CONSULTATION ADMIN (« connecté en tant que ») : on REGARDE le plan du compte, on n'achète ni ne
     restaure rien en son nom. Le tunnel d'achat est celui du magasin de l'ADMINISTRATEUR : souscrire
     depuis ici aurait fait payer l'administrateur pour le compte consulté, et « restaurer » aurait
     transféré son propre abonnement sur ce compte. */
  const { user, isImpersonating } = useAuth();
  /* `hasEntitlement` = le droit du COMPTE ; `isPremium` = ce droit ET l'offre activée globalement.
     Voir l'en-tête de fichier : on retire (le bouton de résiliation) sur le premier, on propose
     (l'achat, les fonctions payantes) sur le second. */
  const { isPremium, premiumEnabled, hasEntitlement, isResolved, hasFailed: planFailed, retry: retryPlan } = usePlan(user?.id);
  // `is_premium` est verrouillé côté base (migration 203) : le client attend le serveur, il n'écrit plus.
  const awaitPremium = useAwaitPremiumFromServer(user?.id);
  const { data: gam, isSuccess: gamLoaded } = useGamificationConfig();
  /* La remise n'est affichée que si elle est CONNUE et réelle : `?? 0` promettait « −0 % » le temps
     du chargement, et gardait la promesse à l'écran si l'administrateur ramène la remise à zéro. */
  const discount = gamLoaded ? (gam?.premium_discount_pct ?? 0) : null;
  const [selectedPlan, setSelectedPlan] = React.useState<'monthly' | 'annual'>('annual');
  const [purchaseMsg, setPurchaseMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<null | 'buy' | 'restore'>(null);
  const [sub, setSub] = React.useState<SubscriptionInfo | null>(null);
  /* VERROU SYNCHRONE. `disabled={busy !== null}` n'agit qu'au rendu SUIVANT : deux appuis rapides
     sur « S'abonner » partaient tous les deux, donc deux tunnels d'achat store. */
  const submit = useSubmitLock();
  /* La page peut être quittée pendant l'attente du serveur (jusqu'à ~12 s) : on ne repose pas
     d'état sur un écran démonté. */
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const [storePrices, setStorePrices] = React.useState<{ monthly?: string; annual?: string }>({});
  /* TOUT DU STORE, OU RIEN. Les deux prix étaient repliés SÉPARÉMENT : si le store ne rendait qu'un
     des deux produits, l'écran affichait un vrai prix localisé (« $2.49 ») à côté d'un repli écrit
     en dur en euros (« 19,99 € ») — deux devises côte à côte, dont une fausse. */
  const storeReady = !!storePrices.monthly && !!storePrices.annual;
  const prices = storeReady
    ? { monthly: storePrices.monthly!, annual: storePrices.annual! }
    : FALLBACK_PLAN_PRICES;

  const refreshSub = React.useCallback(async () => {
    if (!PURCHASES_SUPPORTED) return;
    const info = await getSubscriptionInfo();
    if (alive.current) setSub(info);
  }, []);
  React.useEffect(() => { refreshSub(); }, [refreshSub, isPremium]);
  // Prix réels du store (localisés). Tant qu'ils n'arrivent pas, l'écran montre le repli.
  React.useEffect(() => { let ok = true; getPlanPrices().then((p) => { if (ok) setStorePrices(p); }).catch(() => {}); return () => { ok = false; }; }, []);

  const onSubscribe = async () => {
    if (isImpersonating || !submit.acquire()) return; // garde de sécurité, en plus du masquage

    setPurchaseMsg(null);
    setBusy('buy');
    try {
      const res = await purchasePremium(selectedPlan, user?.id);
      if (res.ok) {
        /* Achat confirmé par le store. Le droit Premium est posé par le SERVEUR (webhook RevenueCat,
           migration 203) : l'app ne se l'accorde plus elle-même — sans quoi n'importe qui pouvait
           envoyer la même écriture à la main. On attend la confirmation plutôt que de l'annoncer. */
        const confirmed = await awaitPremium(true);
        if (!alive.current) return;
        setPurchaseMsg(confirmed
          ? '🎉 Bienvenue dans Premium ! Ton abonnement est actif.'
          : 'Paiement bien reçu ✓ L\'activation prend parfois une minute — elle se fera toute seule.');
        refreshSub();
      } else if (res.reason === 'cancelled') {
        if (alive.current) setPurchaseMsg('Souscription annulée. Tu peux réessayer quand tu veux.');
      } else if (alive.current) {
        /* `not_configured` = le produit n'existe pas (encore) côté store. Le message technique
           remonté tel quel (« Produit introuvable dans le store. ») ne veut rien dire pour qui lit
           la page, et laisse croire à une panne de son compte. */
        setPurchaseMsg(res.reason === 'not_configured'
          ? "L'abonnement n'est pas encore disponible sur ce store. Réessaie un peu plus tard — rien n'a été débité."
          : res.message ?? 'Souscription indisponible pour le moment.');
      }
    } catch (e: any) {
      /* Un imprévu (module de paiement indisponible, promesse rejetée) laissait la page bloquée sur
         son indicateur, sans un mot : le `finally` rend la main, et l'utilisateur sait pourquoi. */
      if (alive.current) setPurchaseMsg(e?.message ?? "La souscription n'a pas pu aboutir. Réessaie dans un instant.");
    } finally {
      if (alive.current) setBusy(null);
      submit.release();
    }
  };

  const onRestore = async () => {
    if (isImpersonating || !submit.acquire()) return; // garde de sécurité, en plus du masquage

    setPurchaseMsg(null);
    setBusy('restore');
    try {
      const res = await restorePurchases();
      if (res.ok) {
        // Même principe : c'est le serveur qui rétablit le droit (événement TRANSFER de RevenueCat).
        const confirmed = await awaitPremium(true);
        if (!alive.current) return;
        setPurchaseMsg(confirmed
          ? 'Achats restaurés. Ton abonnement Premium est de nouveau actif.'
          : 'Abonnement retrouvé ✓ La réactivation prend parfois une minute.');
        refreshSub();
      } else if (alive.current) {
        setPurchaseMsg(res.message ?? 'Aucun abonnement à restaurer.');
      }
    } catch (e: any) {
      if (alive.current) setPurchaseMsg(e?.message ?? "La restauration n'a pas pu aboutir. Réessaie dans un instant.");
    } finally {
      if (alive.current) setBusy(null);
      submit.release();
    }
  };

  /**
   * Gérer / annuler l'abonnement. Une app ne peut PAS résilier elle-même : on renvoie vers les
   * réglages d'abonnement du store — Google Play, seul store où Relyka est distribuée (cf.
   * STORE_SUBSCRIPTIONS). Sur natif, RevenueCat donne l'adresse exacte du compte concerné.
   */
  const openManage = () => {
    const url = sub?.managementURL
      ?? STORE_SUBSCRIPTIONS[Platform.OS === 'ios' ? 'ios' : 'android'];
    if (Platform.OS === 'web' && typeof window !== 'undefined') { window.open(url, '_blank', 'noopener'); return; }
    Linking.openURL(url).catch(() => {
      setPurchaseMsg("Impossible d'ouvrir les réglages d'abonnement. Passe par les abonnements de ton store.");
    });
  };

  const fmtDate = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  /* ── Ce que la page montre, une fois le plan CONNU ─────────────────────────────────────────────
     • abonné (droit du compte) → statut + résiliation, toujours ;
     • offre ouverte, pas abonné → formules + achat ;
     • offre fermée, pas abonné → simple mot d'attente. */
  const showOffers = isResolved && premiumEnabled && !hasEntitlement;
  const showSubscriberBlock = isResolved && hasEntitlement;
  const showClosedNote = isResolved && !premiumEnabled && !hasEntitlement;

  const purchaseNotice = purchaseMsg ? (
    <View style={styles.msgBox}>
      <Text style={styles.purchaseMsg}>{purchaseMsg}</Text>
    </View>
  ) : null;

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'settings')]} edges={[]}>
        <TouchableOpacity style={styles.backRow} onPress={goBack} accessibilityRole="button" accessibilityLabel="Retour">
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          <Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          <View style={styles.hero}>
            <Ionicons name="star" size={36} color={COLORS.yellow} />
            <Text style={styles.heroTitle}>Premium</Text>
            <Text style={styles.heroSub}>Tire le maximum de Relyka.</Text>
          </View>

          {/* Le plan EN COURS — la page s'appelle « Plan », elle doit commencer par y répondre.
              Muet tant que la réponse n'est pas là : mieux vaut ne rien dire que dire « Gratuit »
              à un abonné le temps d'un chargement. */}
          <View style={styles.planRow}>
            <Text style={styles.planLabel}>Ton plan actuel</Text>
            {!isResolved ? (
              <ActivityIndicator size="small" color={COLORS.textSecondary} />
            ) : (
              <View style={[styles.planTag, hasEntitlement && { borderColor: COLORS.emerald, backgroundColor: COLORS.emerald + '1A' }]}>
                <Ionicons name={hasEntitlement ? 'star' : 'person-outline'} size={11} color={hasEntitlement ? COLORS.emerald : COLORS.textSecondary} />
                <Text style={[styles.planTagText, hasEntitlement && { color: COLORS.emerald }]}>{hasEntitlement ? 'Premium' : 'Gratuit'}</Text>
              </View>
            )}
          </View>

          {showClosedNote && (
            <View style={styles.note}><Text style={styles.noteText}>L'offre Premium n'est pas encore disponible. Reviens bientôt !</Text></View>
          )}
          {showSubscriberBlock && (
            <View style={[styles.note, { borderColor: COLORS.emerald + '66' }]}>
              <Text style={[styles.noteText, { color: COLORS.emerald }]}>Tu es Premium. Merci ! 💚</Text>
              {!premiumEnabled && (
                /* Droit actif mais offre coupée globalement : les fonctions payantes sont en pause
                   pour tout le monde. Le dire, plutôt que de laisser croire à un bug de compte. */
                <Text style={[styles.noteText, { marginTop: 6 }]}>Les fonctions Premium sont momentanément suspendues pour tout le monde. Ton abonnement, lui, reste actif — tu peux le gérer ci-dessous.</Text>
              )}
            </View>
          )}

          {BENEFITS.map((b) => {
            /* Une remise à 0 % n'est pas un avantage : on ne l'annonce pas. La ligne reste affichée
               tant qu'on ne sait pas (sans chiffre), pour éviter que la liste ne saute au chargement. */
            if (b.key === 'shop' && discount === 0) return null;
            const title = b.key === 'shop' && discount !== null ? `Remise boutique −${discount}%` : b.title;
            const inner = (
              <>
                <View style={[styles.benefitIcon, { backgroundColor: COLORS.emerald + '22' }]}>
                  <Ionicons name={b.icon as any} size={17} color={COLORS.emerald} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.benefitTitle}>{title}</Text>
                  <Text style={styles.benefitDesc}>{b.desc}</Text>
                </View>
                {!!b.route && <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />}
              </>
            );
            if (!b.route) return <View key={b.key} style={styles.benefit}>{inner}</View>;
            return (
              <TouchableOpacity
                key={b.key}
                style={[styles.benefit, styles.benefitLink]}
                activeOpacity={0.7}
                /* `navigate` et non `push` : depuis cette page on va voir une fonctionnalité, on
                   n'empile pas une n-ième copie de l'écran (l'aller-retour vitrine ↔ page premium
                   se fait souvent plusieurs fois de suite). */
                onPress={() => router.navigate(b.route as any)}
                accessibilityRole="button"
                accessibilityLabel={`${title} — ouvrir la page`}
              >
                {inner}
              </TouchableOpacity>
            );
          })}

          {/* Plan pas encore connu : ni offre, ni statut, ni message — juste l'attente…
              …SAUF si la lecture a échoué : un chargement raté n'est pas un chargement en cours, et
              un cercle qui tourne indéfiniment ne dit rien et n'offre aucun recours. */}
          {!isResolved && (planFailed ? (
            <View style={styles.errorBox}>
              <Ionicons name="cloud-offline-outline" size={18} color={COLORS.danger} />
              <View style={{ flex: 1 }}>
                <Text style={styles.errorText}>Ton plan n'a pas pu être vérifié. Vérifie ta connexion.</Text>
              </View>
              <TouchableOpacity onPress={retryPlan} style={styles.retryBtn} accessibilityRole="button">
                <Text style={styles.retryText}>Réessayer</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 24 }} />
          ))}

          {/* Offres */}
          {showOffers && (
            <>
              <View style={styles.offersRow}>
                <TouchableOpacity
                  style={[styles.offerCard, selectedPlan === 'monthly' && { borderColor: COLORS.emerald, borderWidth: 2 }]}
                  onPress={() => { setSelectedPlan('monthly'); setPurchaseMsg(null); }}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedPlan === 'monthly' }}
                  accessibilityLabel={`Formule mensuelle, ${prices.monthly} par mois`}
                >
                  {selectedPlan === 'monthly' && <View style={[styles.bestBadge, { backgroundColor: COLORS.emerald }]}><Text style={styles.bestBadgeText}>✓ Sélectionné</Text></View>}
                  <Text style={styles.offerName}>Mensuel</Text>
                  <Text style={styles.offerPrice}>{prices.monthly}<Text style={styles.offerPeriod}> / mois</Text></Text>
                  <Text style={styles.offerDesc}>Sans engagement, résiliable à tout moment.</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.offerCard, { borderColor: selectedPlan === 'annual' ? COLORS.emerald : COLORS.cardBorder, borderWidth: selectedPlan === 'annual' ? 2 : 1 }]}
                  onPress={() => { setSelectedPlan('annual'); setPurchaseMsg(null); }}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedPlan === 'annual' }}
                  accessibilityLabel={`Formule annuelle, ${prices.annual} par an`}
                >
                  <View style={[styles.bestBadge, { backgroundColor: selectedPlan === 'annual' ? COLORS.emerald : COLORS.yellow }]}>
                    <Text style={styles.bestBadgeText}>{selectedPlan === 'annual' ? '✓ Sélectionné' : 'Avantageux'}</Text>
                  </View>
                  <Text style={styles.offerName}>Annuel</Text>
                  <Text style={styles.offerPrice}>{prices.annual}<Text style={styles.offerPeriod}> / an</Text></Text>
                  <Text style={styles.offerDesc}>Le meilleur prix sur l'année.</Text>
                </TouchableOpacity>
              </View>

              {isImpersonating ? (
                <View style={styles.webNotice}>
                  <Ionicons name="eye-outline" size={18} color={COLORS.emerald} />
                  <Text style={styles.webNoticeText}>
                    Consultation d'un autre compte : l'abonnement ne peut pas être souscrit ni restauré depuis ici.
                  </Text>
                </View>
              ) : PURCHASES_SUPPORTED ? (
                <>
                  <TouchableOpacity
                    style={[styles.cta, { backgroundColor: COLORS.emerald }, busy !== null && { opacity: 0.7 }]}
                    activeOpacity={0.85}
                    onPress={onSubscribe}
                    disabled={busy !== null}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy !== null, busy: busy === 'buy' }}
                  >
                    {busy === 'buy' ? <ActivityIndicator color="#fff" /> : <Text style={[styles.ctaText, { color: '#fff' }]}>S'abonner — {selectedPlan === 'monthly' ? 'Mensuel' : 'Annuel'}</Text>}
                  </TouchableOpacity>

                  {purchaseNotice}

                  <TouchableOpacity style={styles.restoreBtn} activeOpacity={0.7} onPress={onRestore} disabled={busy !== null} accessibilityRole="button">
                    {busy === 'restore' ? <ActivityIndicator color={COLORS.textSecondary} size="small" /> : <Text style={styles.restoreText}>Restaurer mes achats</Text>}
                  </TouchableOpacity>

                  <Text style={styles.legal}>
                    L'abonnement se renouvelle automatiquement sauf annulation au moins 24 h avant l'échéance, depuis les réglages de ton compte Google Play. Le paiement est prélevé à la confirmation.
                  </Text>
                </>
              ) : (
                /* WEB — il n'y a pas de tunnel d'achat ici. Un grand bouton vert « S'abonner » qui
                   répond systématiquement « disponible sur mobile » est un piège : on le dit avant
                   le clic, pas après. Les prix affichés sont ceux du repli (le store, seul à les
                   connaître dans la devise de l'utilisateur, n'est pas joignable) — on ne les
                   présente donc pas comme le montant exact qui sera débité. */
                <View style={styles.webNotice}>
                  <Ionicons name="phone-portrait-outline" size={18} color={COLORS.emerald} />
                  <Text style={styles.webNoticeText}>
                    L'abonnement se souscrit depuis l'application mobile Relyka (Android). Les tarifs ci-dessus sont indicatifs : le montant exact, dans ta devise, s'affiche au moment de l'achat.
                  </Text>
                </View>
              )}
            </>
          )}

          {/* Abonné : statut + gestion / annulation */}
          {showSubscriberBlock && (
            <>
              {sub?.active && (
                <View style={styles.statusCard}>
                  <View style={styles.statusRow}>
                    <Text style={styles.statusLabel}>Statut</Text>
                    <Text style={[styles.statusValue, { color: COLORS.emerald }]}>Actif{sub.periodType === 'trial' ? ' (essai)' : ''}</Text>
                  </View>
                  {!!fmtDate(sub.expirationDate) && (
                    <View style={styles.statusRow}>
                      <Text style={styles.statusLabel}>{sub.willRenew ? 'Prochain renouvellement' : 'Actif jusqu’au'}</Text>
                      <Text style={styles.statusValue}>{fmtDate(sub.expirationDate)}</Text>
                    </View>
                  )}
                  {!sub.willRenew && (
                    /* « jusqu'à cette date » ne veut rien dire si aucune date n'a pu être affichée
                       (le store ne l'a pas donnée, ou elle est illisible) : on dit alors autre chose. */
                    <Text style={styles.cancelNote}>
                      {fmtDate(sub.expirationDate)
                        ? "Renouvellement automatique désactivé : tu garderas Premium jusqu'à cette date, puis l'abonnement prendra fin."
                        : "Renouvellement automatique désactivé : tu garderas Premium jusqu'à la fin de la période déjà payée, puis l'abonnement prendra fin."}
                    </Text>
                  )}
                </View>
              )}

              {isImpersonating ? (
                /* Les réglages d'abonnement qui s'ouvriraient seraient ceux de l'ADMINISTRATEUR :
                   croire résilier l'abonnement du compte consulté aurait résilié le sien. */
                <View style={styles.webNotice}>
                  <Ionicons name="eye-outline" size={18} color={COLORS.emerald} />
                  <Text style={styles.webNoticeText}>
                    Consultation d'un autre compte : la gestion de l'abonnement se fait depuis le compte lui-même (elle ouvrirait ici tes propres réglages de store).
                  </Text>
                </View>
              ) : (
                /* UN SEUL bouton, natif comme web : Relyka n'est distribuée que sur Google Play, il
                   n'existe donc pas d'autre endroit où un abonnement puisse être résilié. Proposer
                   aussi l'App Store enverrait vers une page où l'utilisateur ne trouverait rien. */
                <TouchableOpacity
                  style={[styles.cta, styles.ctaGhost]}
                  activeOpacity={0.85}
                  onPress={openManage}
                  accessibilityRole="button"
                >
                  <Ionicons name="open-outline" size={17} color={COLORS.text} />
                  <Text style={[styles.ctaText, { color: COLORS.text }]}>{sub && !sub.willRenew ? 'Gérer l’abonnement' : 'Gérer / annuler l’abonnement'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.legal}>
                {PURCHASES_SUPPORTED
                  ? "L'annulation se fait depuis les réglages d'abonnement de ton compte Google Play. L'accès Premium reste actif jusqu'à la fin de la période déjà payée."
                  : "L'abonnement se souscrit depuis l'application mobile Relyka, mais tu peux l'annuler ici : ce bouton ouvre tes réglages d'abonnement Google Play. L'accès Premium reste actif jusqu'à la fin de la période déjà payée."}
              </Text>
              {purchaseNotice}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, alignSelf: 'flex-start', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    backText: { fontSize: 14, fontWeight: '600', color: c.text },
    hero: { alignItems: 'center', gap: 4, marginTop: 6, marginBottom: 12 },
    heroTitle: { fontSize: 26, fontWeight: '900', color: c.text },
    heroSub: { fontSize: 13, color: c.textSecondary },
    planRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 26, marginBottom: 12 },
    planLabel: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
    planTag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
    planTagText: { fontSize: 11.5, fontWeight: '800', color: c.textSecondary },
    note: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, marginBottom: 12, backgroundColor: c.card },
    noteText: { fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 18 },
    benefit: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12, marginBottom: 7 },
    benefitLink: { ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    benefitIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    benefitTitle: { fontSize: 13.5, fontWeight: '700', color: c.text },
    benefitDesc: { fontSize: 11, color: c.textSecondary, marginTop: 1, lineHeight: 14 },
    cta: { backgroundColor: c.cardBorder, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 8 },
    ctaGhost: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder },
    ctaText: { fontSize: 15, fontWeight: '700', color: c.textSecondary },
    msgBox: { borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, borderRadius: 12, padding: 12, marginTop: 12 },
    errorBox: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: c.danger + '66', backgroundColor: c.danger + '14', borderRadius: 12, padding: 12, marginTop: 16 },
    errorText: { fontSize: 12.5, color: c.text, lineHeight: 17 },
    retryBtn: { borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    retryText: { fontSize: 12, fontWeight: '700', color: c.text },
    purchaseMsg: { fontSize: 13, color: c.text, textAlign: 'center', lineHeight: 18 },
    webNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderColor: c.emerald + '55', backgroundColor: c.emerald + '12', borderRadius: 12, padding: 12, marginTop: 12 },
    webNoticeText: { flex: 1, fontSize: 12.5, color: c.text, lineHeight: 17 },
    offersRow: { flexDirection: 'row', gap: 12, marginTop: 6, marginBottom: 4 },
    offerCard: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, gap: 4 },
    offerName: { fontSize: 15, fontWeight: '800', color: c.text },
    offerPrice: { fontSize: 18, fontWeight: '900', color: c.emerald, marginTop: 2 },
    offerPeriod: { fontSize: 12, fontWeight: '700', color: c.textSecondary },
    offerDesc: { fontSize: 11.5, color: c.textSecondary, lineHeight: 15 },
    bestBadge: { position: 'absolute', top: -9, right: 10, backgroundColor: c.emerald, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    bestBadgeText: { fontSize: 10, fontWeight: '800', color: c.onAccent },
    restoreBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12, marginTop: 4 },
    restoreText: { fontSize: 13, fontWeight: '600', color: c.textSecondary, textDecorationLine: 'underline' },
    legal: { fontSize: 11, color: c.textSecondary, textAlign: 'center', marginTop: 10, lineHeight: 15 },
    statusCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 16, marginTop: 8, gap: 10 },
    statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    statusLabel: { fontSize: 13, color: c.textSecondary },
    statusValue: { fontSize: 14, fontWeight: '700', color: c.text },
    cancelNote: { fontSize: 12, color: c.textSecondary, lineHeight: 16, marginTop: 2 },
  });
}
