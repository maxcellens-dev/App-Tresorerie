/**
 * Boutique — dépense les relyks gagnés (couleurs, cosmétiques, titres, thèmes, bons hors-app).
 * Les abonnés Premium bénéficient d'une remise globale (premium_discount_pct).
 */
import { useMemo, useState, useRef, useEffect } from 'react';
import { withDeferredMount } from '../../../hooks/platform/useDeferredMount';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, ActivityIndicator, Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile } from '../../../hooks/data/useProfile';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { useGamification } from '../../../hooks/engagement/useGamification';
import { useGamificationConfig } from '../../../hooks/engagement/useGamificationConfig';
import { useStyleConfig } from '../../../hooks/theme/useStyleConfig';
import { usePlan } from '../../../hooks/config/usePlan';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useSubmitLock } from '../../../hooks/platform/useSubmitLock';
import { isImageIcon, isUniqueItem, formatCurrency, SHOP_CATEGORY_ORDER, SHOP_CATEGORY_LABELS, SHOP_CATEGORY_ICONS, COSMETIC_DEFS, shopFinalPrice, type ShopItem, type ShopCategory } from '../../../lib/engagement/gamification';
import { purchaseGemsPack, PURCHASES_SUPPORTED } from '../../../lib/platform/purchases';

type ShopTab = 'app' | 'relyka';

/** Services Relyka — à développer dans le futur (rendez-vous, paiement à l'usage…). */
const RELYKA_SERVICES = [
  { icon: 'sparkles', title: 'Conseiller IA', desc: 'Une IA dédiée à ta gestion financière, paiement à l’usage.', soon: true },
  { icon: 'videocam', title: 'Conseiller en visio (1-on-1)', desc: 'Un échange en direct avec un conseiller pour t’aider sur ta gestion.', soon: true },
] as const;

export default withDeferredMount(BoutiqueScreen);
function BoutiqueScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = (profile as any)?.is_admin === true;
  const { state, config, inventory, buyItem, creditGems, canClaimDailyGems, isReady, isError, isImpersonating } = useGamification(user?.id);
  // Même requête (même clé) que celle du hook ci-dessus : on ne lit ici que son ÉTAT, pour savoir
  // distinguer « config en route » de « config illisible » — les deux donnent `config` indéfini.
  const cfgQuery = useGamificationConfig();
  const { isPremium, premiumEnabled } = usePlan(user?.id);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /* Le message d'issue porte son TON, il ne se devine plus à son texte. La couleur se décidait sur
     `msg.startsWith('Acheté')` : un pack de relyks payé en argent réel (« +500 Relyks ✓ ») ou un
     crédit administrateur s'affichaient donc en ROUGE, comme un échec. */
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const say = (text: string, tone: 'ok' | 'error') => setMsg({ text, tone });
  /* VERROU SYNCHRONE : les achats ne sont PAS idempotents (débit du solde, crédit du cadeau du
     jour, ajout à l'inventaire) et ne sont protégés que par `busyKey`, un état React — il ne prend
     effet qu'au rendu SUIVANT. Deux taps rapprochés passaient donc tous les deux : le cadeau
     quotidien était encaissé deux fois (relyks gratuits à volonté), et un article unique débité
     deux fois pour un seul exemplaire livré. Une référence se pose immédiatement. */
  const submit = useSubmitLock();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const [tab, setTab] = useState<ShopTab>('app');
  // focus=gems (depuis « mes Relyks ») → pré-sélectionne « Recharger en relyks ».
  const [catFilter, setCatFilter] = useState<ShopCategory | 'all'>(focus === 'gems' ? 'gems' : 'all');
  const [confirmItem, setConfirmItem] = useState<{ key: string; label: string; price: number } | null>(null);
  // « Recharger en relyks » est le dernier filtre (tout à droite) : quand on l'active (clic sur les
  // relyks depuis la boutique ou la page Succès), on défile la barre de filtres jusqu'au bout pour
  // le rendre visible.
  const filterScrollRef = useRef<ScrollView>(null);

  const gems = state?.gems ?? 0;
  const discountPct = config?.premium_discount_pct ?? 0;
  /* Prix final : la remise Premium, et rien d'autre. La « Sélection du mois » (2 articles tournants
     à −30 %) a été retirée — elle encombrait la page et faisait cohabiter deux prix par article. */
  const priceOf = (base: number) => shopFinalPrice(base, { isPremium, premiumPct: discountPct });
  const currencyName = config?.identity.currencyName ?? 'Relyk';
  // Libellé / description calculés pour les articles « monnaie » (toujours au nom courant + pluriel).
  const gemsOf = (item: ShopItem) => Number((item.payload as any)?.gems) || 0;
  const itemLabel = (item: ShopItem) => (item.type === 'gems_iap' ? formatCurrency(gemsOf(item), currencyName) : item.label);
  const itemDesc = (item: ShopItem) => (item.type === 'daily_gems'
    ? `${formatCurrency(gemsOf(item) || 5, currencyName)} offert${(gemsOf(item) || 5) > 1 ? 's' : ''}, une fois par jour.`
    : item.description);

  // L'onglet « Relyka » est masquable en admin : si masqué, pas de barre d'onglets (seulement « App »).
  const relykaTabEnabled = config?.relyka_tab_enabled ?? true;
  const activeTab: ShopTab = relykaTabEnabled ? tab : 'app';
  /* Gamification coupée globalement (admin) : plus de série, plus de succès… mais la boutique en
     relyks restait ouverte. On ferme la partie « App » (toute l'économie en relyks) ; les services
     Relyka, qui ne dépendent pas de la monnaie, continuent d'être présentés. */
  const gamificationOff = !!config && config.identity.enabled === false;

  /* NE PAS VENDRE CE QU'ON NE PEUT PAS LIVRER.
     Le « Pack couleurs » débloque les couleurs d'accent supplémentaires définies dans l'éditeur de
     style. Si l'administration n'en a défini aucune, l'article restait pourtant en rayon à 200
     relyks : on payait, et il ne se passait strictement rien — aucune couleur de plus dans
     Apparence, et l'article devenant « acquis », impossible de recommencer ou de se faire
     rembourser. Tant qu'il n'y a rien à livrer, l'article n'est pas proposé. */
  const { data: styleConfig } = useStyleConfig();
  const accentPackDeliverable = (styleConfig?.extra_presets?.length ?? 0) > 0;

  // Articles regroupés par catégorie (dans l'ordre défini). Un article sans catégorie retombe sur
  // « Apparence » — la catégorie « Séries » n'existe plus (gels et rachat de série ont disparu
  // avec la remise à zéro : la flamme ne redescend plus).
  const accentPackCount = styleConfig?.extra_presets?.length ?? 0;
  const sellableShop = (config?.shop ?? [])
    .filter((s) => s.type !== 'accent_pack' || accentPackDeliverable)
    /* La description du pack annonçait « 7 couleurs » en dur, alors que le nombre réellement livré
       est celui des couleurs définies dans l'éditeur de style : en ajouter ou en retirer une
       transformait la fiche produit en promesse fausse. On annonce ce qui sera livré. */
    .map((s) => (s.type === 'accent_pack'
      ? { ...s, description: `${accentPackCount} couleur${accentPackCount > 1 ? 's' : ''} d'accent supplémentaire${accentPackCount > 1 ? 's' : ''} pour personnaliser ton espace.` }
      : s));
  const shopByCategory = SHOP_CATEGORY_ORDER
    .map((cat) => ({ cat, items: sellableShop.filter((s) => (s.category ?? 'apparence') === cat) }))
    .filter((g) => g.items.length > 0);
  const visibleGroups = catFilter === 'all' ? shopByCategory : shopByCategory.filter((g) => g.cat === catFilter);

  // Défile la barre de filtres jusqu'à « Recharger en relyks » (dernier, tout à droite) dès qu'il
  // est sélectionné et que la liste est rendue (dépend de la longueur, donc rejoue après le chargement).
  useEffect(() => {
    if (catFilter !== 'gems' || activeTab !== 'app' || shopByCategory.length <= 1) return;
    const t = setTimeout(() => filterScrollRef.current?.scrollToEnd({ animated: true }), 250);
    return () => clearTimeout(t);
  }, [catFilter, activeTab, shopByCategory.length]);

  /* Le message d'issue s'efface tout seul. Il restait affiché indéfiniment : on lisait encore
     « Impossible : relyks insuffisants » plusieurs achats plus tard, sans savoir à quoi il se
     rapportait. Les échecs restent plus longtemps que les réussites — il y a quelque chose à y
     comprendre. */
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.tone === 'ok' ? 3500 : 7000);
    return () => clearTimeout(t);
  }, [msg]);

  /* « Connecté en tant que » : la boutique dépenserait les relyks de la personne visitée. La RLS
     refuse l'écriture (403), mais l'utilisateur n'en lisait qu'un « Impossible : connexion perdue »
     incompréhensible. On le dit franchement, et on ne tente rien. */
  const blockedByImpersonation = () => {
    if (!isImpersonating) return false;
    say("Consultation seule : tu es connecté en tant qu'un autre utilisateur.", 'error');
    return true;
  };

  const onBuy = async (key: string) => {
    if (blockedByImpersonation()) return;
    if (!submit.acquire()) return;
    setBusyKey(key); setMsg(null);
    try {
      const res = await buyItem(key);
      if (res.ok) say('Acheté ✓', 'ok');
      else say(`Impossible : ${res.reason}`, 'error');
    } catch {
      // `buyItem` interrompt l'achat plutôt que d'écrire à partir d'une lecture ratée (le stock
      // serait écrasé). Sans ce filet, le bouton restait bloqué sur son indicateur d'attente.
      say('Impossible : connexion perdue, réessaie.', 'error');
    } finally {
      setBusyKey(null);
      submit.release();
    }
  };

  // Pack de gemmes en argent réel (RevenueCat) → crédite les gemmes si l'achat aboutit.
  const onBuyGems = async (item: ShopItem) => {
    if (blockedByImpersonation()) return;
    if (!submit.acquire()) return;
    const productId = String((item.payload as any)?.productId ?? '');
    const gemsAmount = Number((item.payload as any)?.gems) || 0;
    setBusyKey(item.key); setMsg(null);
    try {
      const res = await purchaseGemsPack(productId);
      if (res.ok) {
        /* ARGENT RÉEL DÉJÀ DÉBITÉ : on ne peut pas se contenter d'un essai. Le pack est un
           consommable — une fois payé, rien ne le rejoue. On réessaie donc le crédit plusieurs fois
           avant d'abandonner, et si ça échoue vraiment, on dit la VÉRITÉ : le message promettait
           « rouvre la boutique pour le récupérer » alors qu'aucun mécanisme de rattrapage n'existe.
           Laisser quelqu'un attendre un crédit qui ne viendra jamais est pire que de lui dire quoi
           faire. */
        let credited = await creditGems(gemsAmount);
        for (let attempt = 0; attempt < 2 && !credited.ok; attempt++) {
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
          credited = await creditGems(gemsAmount);
        }
        if (credited.ok) say(`+${formatCurrency(gemsAmount, currencyName)} ✓`, 'ok');
        else say(`Achat validé, mais tes ${formatCurrency(gemsAmount, currencyName)} n'ont pas pu être crédités. Écris-nous depuis Réglages → Aide : on les ajoute à ton compte.`, 'error');
      }
      else if (res.reason === 'cancelled') say('Achat annulé.', 'error');
      else say(res.message ?? 'Achat indisponible.', 'error');
    } finally {
      setBusyKey(null);
      submit.release();
    }
  };

  // Bouton d'achat selon le type d'article (cadeau du jour / pack gemmes / achat en gemmes).
  const renderBuyButton = (item: ShopItem) => {
    const busy = busyKey === item.key;
    // Article exclusif Premium et utilisateur non-Premium → bouton verrouillé (renvoie vers l'offre Premium).
    if (item.premiumOnly && !isPremium) {
      return (
        <TouchableOpacity style={[styles.buyBtn, { backgroundColor: COLORS.yellow + '22', borderWidth: 1, borderColor: COLORS.yellow + '66', paddingHorizontal: 12 }]} onPress={() => router.push('/(tabs)/(secondary)/premium' as any)} activeOpacity={0.85}>
          <Ionicons name="lock-closed" size={12} color={COLORS.yellow} />
          <Text style={[styles.buyText, { color: COLORS.yellow }]}>Premium</Text>
        </TouchableOpacity>
      );
    }
    if (item.type === 'daily_gems') {
      /* `canClaimDailyGems` se déduit d'une donnée pas encore lue : tant que l'état n'est pas
         chargé, il vaut `true` par construction (aucune date de dernier cadeau connue). Le bouton
         invitait donc à « Réclamer » un cadeau déjà pris, pour répondre « déjà réclamé » en rouge.
         On attend de SAVOIR. */
      const claimable = canClaimDailyGems && isReady;
      return (
        <TouchableOpacity style={[styles.buyBtn, { backgroundColor: claimable ? COLORS.green : COLORS.cardBorder, paddingHorizontal: 14 }]} onPress={() => claimable && onBuy(item.key)} disabled={!claimable || busy} activeOpacity={0.85}>
          {busy || !isReady ? <ActivityIndicator size="small" color={isReady ? '#fff' : COLORS.textSecondary} /> : <Text style={[styles.buyText, { color: claimable ? '#fff' : COLORS.textSecondary }]}>{claimable ? 'Réclamer' : 'Demain'}</Text>}
        </TouchableOpacity>
      );
    }
    if (item.type === 'gems_iap') {
      return (
        <TouchableOpacity style={[styles.buyBtn, { backgroundColor: COLORS.yellow, paddingHorizontal: 14 }]} onPress={() => !busy && onBuyGems(item)} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[styles.buyText, { color: '#fff' }]}>Acheter</Text>}
        </TouchableOpacity>
      );
    }
    // Produit unique déjà acquis : prix grisé, achat impossible (même avec assez de relyks).
    if (isUniqueItem(item) && (inventory.find((i) => i.item_key === item.key)?.qty ?? 0) > 0) {
      return (
        <View style={[styles.buyBtn, { backgroundColor: COLORS.cardBorder }]}>
          <Ionicons name="checkmark" size={12} color={COLORS.textSecondary} />
          <Text style={[styles.buyText, { color: COLORS.textSecondary }]}>Acquis</Text>
        </View>
      );
    }
    const price = priceOf(item.price);
    const canBuy = gems >= price && !busy;
    return (
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        {/* Prix barré : uniquement quand la remise Premium s'applique réellement. */}
        {price < item.price && <Text style={styles.gridStrike}>{item.price}</Text>}
        <TouchableOpacity style={[styles.buyBtn, { backgroundColor: canBuy ? COLORS.emerald : COLORS.cardBorder }]} onPress={() => canBuy && setConfirmItem({ key: item.key, label: item.label, price })} disabled={!canBuy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator size="small" color="#fff" /> : (
            <>
              <Ionicons name="diamond" size={12} color={canBuy ? '#fff' : COLORS.textSecondary} />
              <Text style={[styles.buyText, { color: canBuy ? '#fff' : COLORS.textSecondary }]}>{price}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'list')]} edges={[]}>
        <TouchableOpacity style={styles.backRow} onPress={goBack}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          <Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Boutique</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {/* Admin uniquement : crédite 100 relyks pour tester les achats facilement. */}
            {isAdmin && (
              <TouchableOpacity
                style={styles.adminGemBtn}
                // Le résultat était ignoré : un crédit refusé annonçait quand même « +100 relyks ».
                onPress={async () => {
                  if (blockedByImpersonation()) return;
                  if (!submit.acquire()) return;
                  try {
                    const r = await creditGems(100);
                    if (r.ok) say('+100 relyks (admin)', 'ok');
                    else say("Le crédit administrateur n'a pas pu être enregistré.", 'error');
                  } finally { submit.release(); }
                }}
                activeOpacity={0.85}
                accessibilityLabel="Ajouter 100 relyks (admin)"
              >
                <Ionicons name="add" size={14} color="#fff" />
                <Text style={styles.adminGemBtnText}>100</Text>
              </TouchableOpacity>
            )}
            {/* Toucher son solde → accès direct à « Recharger en relyks ». */}
            <TouchableOpacity
              style={styles.gemPill}
              onPress={() => { setTab('app'); setCatFilter('gems'); }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Recharger en relyks"
            >
              <Ionicons name="diamond" size={14} color={COLORS.blue} />
              {/* Un solde inconnu n'est pas un solde à zéro : tant que la lecture n'a pas abouti,
                  afficher « 0 » laissait croire que tous les relyks avaient disparu. */}
              <Text style={styles.gemText}>{isReady ? gems : '…'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Onglets : App (gemmes/items) · Relyka (services) — la barre disparaît si Relyka masqué en admin */}
        {relykaTabEnabled && (
          <View style={styles.tabsRow}>
            <TouchableOpacity style={[styles.tabBtn, activeTab === 'app' && styles.tabBtnActive]} onPress={() => setTab('app')} activeOpacity={0.85}>
              <Ionicons name="diamond-outline" size={15} color={activeTab === 'app' ? COLORS.emerald : COLORS.textSecondary} />
              <Text style={[styles.tabText, activeTab === 'app' && styles.tabTextActive]}>App</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tabBtn, activeTab === 'relyka' && styles.tabBtnActive]} onPress={() => setTab('relyka')} activeOpacity={0.85}>
              <Ionicons name="sparkles-outline" size={15} color={activeTab === 'relyka' ? COLORS.emerald : COLORS.textSecondary} />
              <Text style={[styles.tabText, activeTab === 'relyka' && styles.tabTextActive]}>Relyka</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ISSUE DE LA DERNIÈRE ACTION — au-dessus de la liste, jamais dedans.
            Elle s'affichait tout en bas, après toutes les catégories : sur une page qui fait
            plusieurs écrans de haut, personne ne voyait ni « Acheté ✓ » ni la raison d'un refus.
            Un achat semblait alors n'avoir aucun effet. */}
        {msg && (
          <View style={[styles.msgBox, { borderColor: (msg.tone === 'ok' ? COLORS.emerald : COLORS.danger) + '66', backgroundColor: (msg.tone === 'ok' ? COLORS.emerald : COLORS.danger) + '14' }]}>
            <Ionicons name={msg.tone === 'ok' ? 'checkmark-circle' : 'alert-circle'} size={15} color={msg.tone === 'ok' ? COLORS.emerald : COLORS.danger} />
            <Text style={[styles.msg, { color: msg.tone === 'ok' ? COLORS.emerald : COLORS.danger }]}>{msg.text}</Text>
            <TouchableOpacity onPress={() => setMsg(null)} hitSlop={8} accessibilityLabel="Masquer le message">
              <Ionicons name="close" size={15} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
        )}

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {activeTab === 'app' ? (
            gamificationOff ? (
              /* Interrupteur global de la gamification (admin) : il coupait la série et les succès,
                 mais laissait la boutique entièrement fonctionnelle — on pouvait continuer à gagner
                 et à dépenser des relyks dans une économie officiellement éteinte. */
              <Text style={styles.empty}>
                La boutique est fermée pour le moment. Reviens plus tard !
              </Text>
            ) : (
            <>
              {/* Le solde n'a pas pu être lu : tous les articles paraissent hors de portée sans que
                  rien ne l'explique. On le dit, avec de quoi réessayer. */}
              {isError && (
                <View style={[styles.msgBox, { borderColor: COLORS.danger + '66', backgroundColor: COLORS.danger + '14', marginBottom: 12 }]}>
                  <Ionicons name="cloud-offline-outline" size={15} color={COLORS.danger} />
                  <Text style={[styles.msg, { color: COLORS.danger }]}>Ton solde de relyks n'a pas pu être lu — les achats sont indisponibles.</Text>
                </View>
              )}

              {/* Bandeau premium */}
              {premiumEnabled && (
                isPremium ? (
                  <View style={[styles.premiumBanner, { borderColor: COLORS.emerald + '66' }]}>
                    <Ionicons name="star" size={16} color={COLORS.emerald} />
                    <Text style={styles.premiumText}>Premium actif — remise de {discountPct}% appliquée.</Text>
                  </View>
                ) : (
                  <TouchableOpacity style={[styles.premiumBanner, { borderColor: COLORS.yellow + '66' }]} onPress={() => router.push('/(tabs)/(secondary)/premium' as any)} activeOpacity={0.85}>
                    <Ionicons name="star-outline" size={16} color={COLORS.yellow} />
                    <Text style={styles.premiumText}>Passe Premium : −{discountPct}% sur la boutique + zéro pub.</Text>
                    <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                )
              )}

              {/* Filtres par catégorie — navigation compacte (évite une page à rallonge).
                  « Premium » est placé en 3ᵉ raccourci (après « Tout »), uniquement ici. */}
              {shopByCategory.length > 1 && (
                <ScrollView ref={filterScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} style={{ marginBottom: 6 }}>
                  {(() => {
                    /* Ordre voulu : Tout · Premium · Relyks · le reste.
                       « Gratuit » n'a pas de pastille : c'est déjà la première section de la page,
                       un raccourci vers ce qu'on a sous les yeux n'apporte rien. */
                    const present = (c: ShopCategory) => shopByCategory.some((g) => g.cat === c);
                    const head: ShopCategory[] = (['premium', 'gems'] as ShopCategory[]).filter(present);
                    const rest = shopByCategory
                      .map((g) => g.cat)
                      .filter((c) => c !== 'gratuit' && !head.includes(c));
                    return [
                      { cat: 'all' as const, label: 'Tout', icon: 'apps-outline' },
                      ...[...head, ...rest].map((c) => ({
                        cat: c,
                        // « Recharger en relyks » est le titre de SECTION ; sur une pastille, il déborde.
                        label: c === 'premium' ? 'Premium' : c === 'gems' ? 'Relyks' : SHOP_CATEGORY_LABELS[c as ShopCategory],
                        icon: SHOP_CATEGORY_ICONS[c as ShopCategory],
                      })),
                    ];
                  })().map((f) => {
                    const active = catFilter === f.cat;
                    return (
                      <TouchableOpacity key={f.cat} style={[styles.filterChip, active && styles.filterChipActive]} onPress={() => setCatFilter(f.cat as any)} activeOpacity={0.85}>
                        <Ionicons name={f.icon as any} size={13} color={active ? COLORS.emerald : COLORS.textSecondary} />
                        <Text style={[styles.filterChipText, active && { color: COLORS.emerald }]} numberOfLines={1}>{f.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              {visibleGroups.map(({ cat, items }) => {
                const compact = cat === 'gems';
                return (
                  <View key={cat}>
                    <View style={styles.catHeaderRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={styles.catHeader}>{SHOP_CATEGORY_LABELS[cat as ShopCategory]}</Text>
                        {/* Badge « Premium » au niveau de la section (le mot entier ici, juste l'étoile sur les produits) */}
                        {cat === 'premium' && (
                          <View style={[styles.premiumPill, { marginBottom: 8, marginTop: 6 }]}>
                            <Ionicons name="star" size={10} color={COLORS.yellow} />
                            <Text style={styles.premiumPillText}>Premium</Text>
                          </View>
                        )}
                      </View>
                      {/* Lien « Consulter mes achats » → Apparence (cosmétiques équipables : cadres, titres, flammes…) */}
                      {(cat === 'apparence' || cat === 'cosmetiques' || cat === 'titres' || cat === 'premium') && (
                        <TouchableOpacity style={styles.apparenceLink} onPress={() => router.push('/(tabs)/(secondary)/apparence?origin=/(tabs)/(secondary)/boutique' as any)} activeOpacity={0.7}>
                          <Ionicons name="color-palette-outline" size={13} color={COLORS.emerald} />
                          <Text style={styles.apparenceLinkText}>Consulter mes achats</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {compact ? (
                      <View style={styles.compactGrid}>
                        {items.map((item) => {
                          const accentColor = item.type === 'gems_iap' ? COLORS.yellow : COLORS.blue;
                          return (
                            <View key={item.key} style={[styles.compactCard, cat === 'gems' ? styles.compactThird : styles.compactHalf]}>
                              <View style={[styles.itemIcon, { backgroundColor: accentColor + '22' }]}>
                                {isImageIcon(item.icon) ? <Image source={{ uri: item.icon! }} style={styles.itemImg} /> : <Ionicons name={(item.icon || 'pricetag') as any} size={20} color={accentColor} />}
                              </View>
                              <Text style={styles.compactLabel} numberOfLines={2}>{itemLabel(item)}</Text>
                              {renderBuyButton(item)}
                            </View>
                          );
                        })}
                      </View>
                    ) : (
                      items.map((item) => {
                        const frozen = !!item.premiumOnly && !isPremium; // exclusif Premium, non débloqué
                        // Cosmétiques (cadres/flammes) : teinte = leur vraie couleur → style cohérent (ex. flamme bleue ≈ flamme dorée).
                        const cosmeticColor = COSMETIC_DEFS[item.key] && /^#[0-9A-Fa-f]{6}$/.test(COSMETIC_DEFS[item.key].value) ? COSMETIC_DEFS[item.key].value : null;
                        const accentColor = cosmeticColor ?? (item.premiumOnly ? COLORS.yellow : COLORS.blue);
                        return (
                          <View key={item.key} style={[styles.card, frozen && styles.cardFrozen]}>
                            <View style={[styles.itemIcon, { backgroundColor: accentColor + '22' }]}>
                              {isImageIcon(item.icon) ? <Image source={{ uri: item.icon! }} style={styles.itemImg} /> : <Ionicons name={(item.icon || 'pricetag') as any} size={22} color={accentColor} />}
                              {frozen && <View style={styles.frozenLock}><Ionicons name="lock-closed" size={11} color="#fff" /></View>}
                            </View>
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <Text style={styles.itemLabel}>
                                  {itemLabel(item)}
                                </Text>
                                {item.premiumOnly && (
                                  <View style={styles.premiumDot}>
                                    <Ionicons name="star" size={10} color={COLORS.yellow} />
                                  </View>
                                )}
                              </View>
                              {!!itemDesc(item) && <Text style={styles.itemDesc}>{itemDesc(item)}</Text>}
                            </View>
                            {renderBuyButton(item)}
                          </View>
                        );
                      })
                    )}
                    {cat === 'gems' && !PURCHASES_SUPPORTED && (
                      <Text style={styles.gemsNote}>Les achats de relyks se font depuis l'application mobile Relyka.</Text>
                    )}
                  </View>
                );
              })}
              {/* « Vide » ne se dit QUE lorsqu'on sait qu'elle l'est. Sans config chargée, la page
                  annonçait « La boutique est vide pour le moment » pendant tout le chargement — et
                  aussi quand la lecture échouait, ce qui est un mensonge doublé d'une impasse. */}
              {!config ? (
                cfgQuery.isError ? (
                  <View style={{ alignItems: 'center', marginTop: 30, gap: 10 }}>
                    <Text style={styles.empty}>La boutique n'a pas pu être chargée.</Text>
                    <TouchableOpacity onPress={() => cfgQuery.refetch()} activeOpacity={0.8}>
                      <Text style={[styles.apparenceLinkText, { fontSize: 13 }]}>Réessayer</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <ActivityIndicator style={{ marginTop: 30 }} color={COLORS.emerald} />
                )
              ) : shopByCategory.length === 0 ? (
                <Text style={styles.empty}>La boutique est vide pour le moment.</Text>
              ) : visibleGroups.length === 0 ? (
                /* Filtre qui ne correspond à rien — on y arrive sans le vouloir : la page peut
                   s'ouvrir directement sur « Recharger en relyks » (lien depuis les Succès) alors
                   que l'administration a retiré cette catégorie. Sans issue, c'était une page
                   blanche : la barre de filtres, elle, ne s'affiche qu'à partir de deux catégories. */
                <View style={{ alignItems: 'center', marginTop: 30, gap: 10 }}>
                  <Text style={styles.empty}>Aucun article dans cette catégorie.</Text>
                  <TouchableOpacity onPress={() => setCatFilter('all')} activeOpacity={0.8}>
                    <Text style={[styles.apparenceLinkText, { fontSize: 13 }]}>Voir toute la boutique</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </>
            )
          ) : (
            <>
              <Text style={styles.sectionIntro}>Des accompagnements humains et IA pour t’aider à mieux gérer tes finances.</Text>
              {RELYKA_SERVICES.map((svc) => (
                <View key={svc.title} style={styles.card}>
                  <View style={[styles.itemIcon, { backgroundColor: COLORS.emerald + '22' }]}>
                    <Ionicons name={svc.icon as any} size={22} color={COLORS.emerald} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemLabel}>{svc.title}</Text>
                    <Text style={styles.itemDesc}>{svc.desc}</Text>
                  </View>
                  {svc.soon && (
                    <View style={styles.soonPill}>
                      <Text style={styles.soonText}>Bientôt</Text>
                    </View>
                  )}
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Confirmation d'achat (évite les dépenses accidentelles en un clic) */}
      {/* `statusBarTranslucent` : sans lui, le voile s'arrête sous la barre de statut sur Android —
          la modale flotte alors dans un cadre blanc. Même réglage que les autres modales de l'app. */}
      <Modal visible={!!confirmItem} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setConfirmItem(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setConfirmItem(null)}>
          <Pressable style={{ width: '100%', alignItems: 'center' }} onPress={() => {}}>
          <View style={styles.modalCard}>
            <View style={[styles.modalIcon, { backgroundColor: COLORS.blue + '22' }]}>
              <Ionicons name="diamond" size={26} color={COLORS.blue} />
            </View>
            <Text style={styles.modalTitle}>Confirmer l'achat</Text>
            <Text style={styles.modalText}>
              Acheter « {confirmItem?.label} » pour{' '}
              <Text style={{ fontWeight: '800', color: COLORS.text }}>{formatCurrency(confirmItem?.price ?? 0, currencyName)}</Text> ?
            </Text>
            <Text style={styles.modalBalance}>Solde après achat : {formatCurrency(Math.max(0, gems - (confirmItem?.price ?? 0)), currencyName)}</Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setConfirmItem(null)} activeOpacity={0.85}>
                <Text style={styles.modalCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirm}
                onPress={() => { const k = confirmItem!.key; setConfirmItem(null); onBuy(k); }}
                activeOpacity={0.85}
              >
                <Ionicons name="checkmark" size={16} color="#fff" />
                <Text style={styles.modalConfirmText}>Confirmer</Text>
              </TouchableOpacity>
            </View>
          </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, alignSelf: 'flex-start', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    backText: { fontSize: 14, fontWeight: '600', color: c.text },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    apparenceLink: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8, marginTop: 6 },
    apparenceLinkText: { fontSize: 11.5, fontWeight: '700', color: c.emerald },
    title: { fontSize: 26, fontWeight: '800', color: c.text },
    gemPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    gemText: { fontSize: 14, fontWeight: '800', color: c.text },
    adminGemBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: c.emerald, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
    adminGemBtnText: { fontSize: 13, fontWeight: '800', color: c.onAccent },
    tabsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
    tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 10, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    tabBtnActive: { borderColor: c.emerald, backgroundColor: c.emerald + '14' },
    tabText: { fontSize: 14, fontWeight: '700', color: c.textSecondary },
    tabTextActive: { color: c.emerald },
    sectionIntro: { fontSize: 13, color: c.textSecondary, lineHeight: 18, marginBottom: 14 },
    catHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    gridStrike: { fontSize: 10.5, color: c.textSecondary, textDecorationLine: 'line-through' },
    catHeader: { fontSize: 12, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 6 },
    gemsNote: { fontSize: 11.5, color: c.textSecondary, marginTop: -4, marginBottom: 8, lineHeight: 15 },
    soonPill: { backgroundColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    soonText: { fontSize: 11, fontWeight: '800', color: c.textSecondary },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 60 },
    premiumBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.card, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 },
    premiumText: { flex: 1, fontSize: 12.5, color: c.text, fontWeight: '600' },
    card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, marginBottom: 12 },
    cardFrozen: { opacity: 0.6, borderStyle: 'dashed', borderColor: c.yellow + '55' },
    frozenLock: { position: 'absolute', bottom: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: c.textSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: c.card },
    premiumPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: c.yellow + '22', borderWidth: 1, borderColor: c.yellow + '66', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
    premiumPillText: { fontSize: 10.5, fontWeight: '800', color: c.yellow },
    premiumDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: c.yellow + '22', borderWidth: 1, borderColor: c.yellow + '66', alignItems: 'center', justifyContent: 'center' },
    filterRow: { gap: 8, paddingVertical: 2, paddingRight: 8 },
    filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    filterChipActive: { borderColor: c.emerald, backgroundColor: c.emerald + '14' },
    filterChipText: { fontSize: 12.5, fontWeight: '700', color: c.textSecondary },
    compactGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
    compactCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 12, alignItems: 'center', gap: 8 },
    compactHalf: { flexBasis: '47%', flexGrow: 1 },
    compactThird: { flexBasis: '30%', flexGrow: 1 },
    compactLabel: { fontSize: 12.5, fontWeight: '700', color: c.text, textAlign: 'center' },
    ownedText: { fontSize: 11, fontWeight: '600', color: c.textSecondary, marginTop: -2 },
    countBadge: { position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.blue, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
    countBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },
    itemIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    itemImg: { width: 28, height: 28, borderRadius: 6 },
    itemLabel: { fontSize: 14, fontWeight: '700', color: c.text },
    itemDesc: { fontSize: 11.5, color: c.textSecondary, marginTop: 2, lineHeight: 15 },
    buyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, minWidth: 64, justifyContent: 'center' },
    buyText: { fontSize: 13, fontWeight: '800' },
    empty: { color: c.textSecondary, textAlign: 'center', marginTop: 30 },
    msgBox: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10,
    },
    msg: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 17 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 28 },
    modalCard: { width: '100%', maxWidth: 380, backgroundColor: c.cardSolid ?? c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 20, padding: 24, alignItems: 'center' },
    modalIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
    modalTitle: { fontSize: 18, fontWeight: '800', color: c.text, marginBottom: 8 },
    modalText: { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20 },
    modalBalance: { fontSize: 12, color: c.textSecondary, marginTop: 8 },
    modalBtns: { flexDirection: 'row', gap: 10, marginTop: 20, width: '100%' },
    modalCancel: { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 13 },
    modalCancelText: { fontSize: 14, fontWeight: '700', color: c.text },
    modalConfirm: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 13 },
    modalConfirmText: { fontSize: 14, fontWeight: '800', color: c.onAccent },
  });
}
