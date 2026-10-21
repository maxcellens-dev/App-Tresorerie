/**
 * Modal « Transactions récurrentes » — vue UNIFIÉE de toutes les récurrences actives (virements,
 * dépenses, recettes). Tap sur une ligne → écran d'édition (qui gère la sémantique de troncature).
 * Ouvert depuis un bouton de la page Transactions et un raccourci du modal « dépenses récurrentes ».
 */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { CURRENCY_SYMBOL, currencySymbolFor } from '../../lib/finance/currency';
import { sheetWidth, useSheetBottomPadding, useSheetFixedHeight } from '../../lib/ui/appLayout';
import { RootPortal } from '../../lib/rootPortal';
import { useRecurringTransactions, ruleBadge, type RecurringItem, type RecurKind } from '../../hooks/data/useRecurringTransactions';
import { todayISO } from '../../lib/dateUtils';
import { GARDEN_COLORS as G } from '../../lib/garden/theme';
import { GARDEN_FONTS as GF } from '../../lib/garden/fontFamilies';

/**
 * `tab` = libellé COURT de l'onglet, `empty` = ce qu'on dit quand cet onglet-là n'a rien.
 * Les trois natures se lisaient auparavant à la suite, dans une seule liste défilante : au-delà
 * d'une dizaine de récurrentes, retrouver un virement demandait de traverser toutes les dépenses.
 */
const KIND_META: Record<RecurKind, {
  tab: string; icon: string; colorKey: 'blue' | 'danger' | 'green'; empty: string;
}> = {
  transfer: {
    tab: 'Virements', icon: 'swap-horizontal', colorKey: 'blue',
    empty: 'Aucun virement récurrent.',
  },
  expense: {
    tab: 'Dépenses', icon: 'arrow-down', colorKey: 'danger',
    empty: 'Aucune dépense récurrente.',
  },
  income: {
    tab: 'Recettes', icon: 'arrow-up', colorKey: 'green',
    empty: 'Aucune recette récurrente.',
  },
};

const KINDS: RecurKind[] = ['transfer', 'expense', 'income'];

export default function RecurringTransactionsModal({ visible, onClose, userId, portal }: {
  visible: boolean;
  onClose: () => void;
  userId: string | undefined;
  /** Rendu dans la MÊME fenêtre que le guide (lib/rootPortal) au lieu d'un <Modal>.
   *  Un <Modal> vit dans une fenêtre à part : la bulle du guide, dessinée dans la fenêtre
   *  principale, passait DESSOUS — d'où l'ancienne carte « Elles vivent ici » qui commentait la
   *  feuille de loin. Par le portail, bulle et feuille coexistent et se superposent correctement. */
  portal?: boolean;
}) {
  const c = useAppColors();
  const s = useMemo(() => makeStyles(c), [c]);
  // Feuilles du bas : marge basse incluant la barre de navigation Android (cf. useSheetBottomPadding).
  const sheetPad = useSheetBottomPadding(26);
  /* Hauteur FIGÉE (cf. useSheetFixedHeight) : les trois onglets n'ont pas le même nombre de lignes,
     et une feuille qui se dimensionne à son contenu déplace son bord haut — titre et onglets
     compris — à chaque bascule. Ici le haut reste au niveau du début de la liste de la page. */
  const sheetHeight = useSheetFixedHeight();
  const router = useRouter();
  const { data: items = [], isLoading, refetch } = useRecurringTransactions(userId);

  /* Onglet choisi par l'utilisateur. `null` = « pas encore choisi » → on retombe sur le premier
     onglet REMPLI (cf. `activeKind`). Sans ce distinguo, ouvrir la feuille sur « Virements » alors
     qu'on n'en a aucun donnerait une liste vide, avec le contenu caché derrière un onglet. */
  const [picked, setPicked] = useState<RecurKind | null>(null);

  // À l'ouverture : on relit → une récurrence créée à l'instant apparaît sans rafraîchir la page.
  useEffect(() => { if (visible) refetch(); }, [visible, refetch]);

  /* Réinitialisation de l'onglet à CHAQUE ouverture, dans un effet à part, qui ne dépend QUE de
     `visible`. Le mêler au rafraîchissement ci-dessus le rendrait tributaire de l'identité de
     `refetch` : le jour où elle cesse d'être stable, le choix d'onglet de l'utilisateur serait
     annulé à chaque rendu, en pleine consultation. */
  useEffect(() => { if (visible) setPicked(null); }, [visible]);

  const countByKind = useMemo(() => {
    const m: Record<RecurKind, number> = { transfer: 0, expense: 0, income: 0 };
    for (const i of items) m[i.kind] += 1;
    return m;
  }, [items]);

  /* Onglet AFFICHÉ. Le choix de l'utilisateur prime toujours ; à défaut, le premier onglet non
     vide, dans l'ordre naturel (virements → dépenses → recettes). Le repli sur 'expense' ne sert
     que lorsqu'il n'y a rien du tout — auquel cas le message général prend la place de la liste. */
  const activeKind: RecurKind = picked ?? KINDS.find((k) => countByKind[k] > 0) ?? 'expense';
  const visibleItems = useMemo(
    () => items.filter((i) => i.kind === activeKind),
    [items, activeKind],
  );
  const activeMeta = KIND_META[activeKind];
  const activeColor = (c as any)[activeMeta.colorKey];
  /* Une récurrente est prélevée sur UN compte : son montant est libellé dans la devise de CE
     compte, pas dans la devise de référence — c'est ce montant-là qui sortira. */
  const eur = (n: number, currency?: string | null) =>
    `${Math.round(n).toLocaleString('fr-FR')} ${currency ? currencySymbolFor(currency) : CURRENCY_SYMBOL}`;

  const thisMonth = todayISO().slice(0, 7);
  const openEdit = (id: string) => { onClose(); router.push(`/(tabs)/transactions/edit/${id}` as any); };

  const body = (
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={[s.sheet, { height: sheetHeight, paddingBottom: sheetPad }]} onPress={() => {}}>
          {/* Anneau tracé par la feuille elle-même : le guide peut la désigner en même temps que
              le bouton qui l'ouvre, sans aucune position à mesurer. */}
          <View style={s.grabber} />
          <View style={s.header}>
            <Ionicons name="repeat" size={20} color={c.text} />
            <Text style={s.title}>Tes opérations récurrentes</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} hitSlop={12}><Ionicons name="close" size={22} color={c.textSecondary} /></Pressable>
          </View>
          {/* Ce n'est PAS le suivi du mois : c'est le catalogue de toutes les récurrentes, pour les
              modifier. Ce qui tombe ce mois-ci se lit dans Mon argent › Ce mois. */}
          <Text style={s.intro}>Toutes tes opérations récurrentes, quel que soit leur mois. Ce qui tombe ce mois-ci est repéré.</Text>

          {/* La feuille ayant une hauteur fixe, chargement et messages vides se posent au MILIEU de
              l'espace restant plutôt que collés sous le titre, avec un grand vide dessous. */}
          {isLoading ? (
            <View style={s.fill}><ActivityIndicator color={c.emerald} /></View>
          ) : items.length === 0 ? (
            <View style={s.fill}>
              <Text style={s.empty}>Aucune transaction récurrente active. Coche « Récurrente » à la saisie pour en créer.</Text>
            </View>
          ) : (
            <>
              {/* Onglets par NATURE. Le compteur reste visible sur chaque onglet : c'est ce qui
                  permet de savoir qu'il y a quelque chose ailleurs sans avoir à y aller. */}
              <View style={s.tabs}>
                {KINDS.map((k) => {
                  const meta = KIND_META[k];
                  const color = (c as any)[meta.colorKey];
                  const on = k === activeKind;
                  const n = countByKind[k];
                  return (
                    <TouchableOpacity
                      key={k}
                      style={[s.tab, on && { backgroundColor: G.card, shadowColor: '#1E3A2C', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 }]}
                      onPress={() => setPicked(k)}
                      activeOpacity={0.8}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${meta.tab} — ${n} récurrente${n > 1 ? 's' : ''}`}
                    >
                      <Ionicons name={meta.icon as any} size={15} color={color} />
                      <Text style={[s.tabText, on && { color }]} numberOfLines={1}>{meta.tab}</Text>
                      {/* Un onglet vide garde son compteur à 0, en retrait : mieux vaut un « 0 »
                          lisible qu'un onglet qui semble cacher quelque chose. */}
                      <Text style={[s.tabCount, on ? { color, opacity: 0.85 } : n === 0 && { opacity: 0.45 }]}>{n}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {visibleItems.length === 0 ? (
                <View style={s.fill}><Text style={s.empty}>{activeMeta.empty}</Text></View>
              ) : (
                /* `flex: 1` (et non plus une hauteur plafond) : la liste occupe tout ce que la
                   feuille lui laisse, donc l'onglet le plus fourni défile au lieu de pousser. */
                <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }}>
                  <View style={s.list}>
                  {visibleItems.map((it: RecurringItem, idx: number) => (
                    <TouchableOpacity key={it.id} style={[s.row, idx === visibleItems.length - 1 && { borderBottomWidth: 0 }]} activeOpacity={0.7} onPress={() => openEdit(it.id)}>
                        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: activeColor + '22', alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name={activeMeta.icon as any} size={17} color={activeColor} />
                        </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.rowLabel} numberOfLines={1}>{it.label}</Text>
                        <View style={s.rowSubLine}>
                          <View style={s.freqBadge}><Text style={s.freqBadgeText}>{ruleBadge(it.rule)}</Text></View>
                          {it.nextDate.slice(0, 7) === thisMonth ? (
                            <View style={[s.freqBadge, { backgroundColor: activeColor + '22', borderColor: 'transparent' }]}><Text style={[s.freqBadgeText, { color: activeColor }]}>ce mois-ci</Text></View>
                          ) : null}
                          <Text style={s.rowSub} numberOfLines={1}>{it.accountName && it.kind !== 'transfer' ? `${it.accountName} · ` : ''}prochaine {it.nextDate.slice(8, 10)}/{it.nextDate.slice(5, 7)}</Text>
                        </View>
                      </View>
                      <Text style={[s.rowAmount, { color: activeColor }]}>{eur(it.amount, it.accountCurrency)}</Text>
                      <Ionicons name="chevron-forward" size={16} color={c.textSecondary} />
                    </TouchableOpacity>
                  ))}
                  </View>
                  <Text style={s.hint}>Touche une ligne pour la modifier ou l'arrêter.</Text>
                </ScrollView>
              )}
            </>
          )}
        </Pressable>
      </Pressable>
  );

  if (portal) {
    if (!visible) return null;
    return (
      <RootPortal>
        {/* zIndex sous celui de la bulle du guide (1000) : la feuille remonte, l'explication reste
            lisible par-dessus, quel que soit l'ordre de montage des deux portails. */}
        <View style={s.portalFill}>{body}</View>
      </RootPortal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      {body}
    </Modal>
  );
}

/* JARDIN : feuille aux arrondis du Jardin, onglets en pilule (l'actif en blanc, texte de sa couleur),
   lignes regroupées dans UNE carte avec une pastille par ligne, polices du Jardin (une famille par
   graisse, jamais de fontWeight — sinon Android retombe sur Roboto). */
function makeStyles(c: any) {
  const base = makeBaseStyles(c);
  const font = (w: 'body' | 'bodyBold' | 'bodyHeavy' | 'display') => ({ fontFamily: GF[w], fontWeight: 'normal' as const });
  return {
    ...base,
    ...StyleSheet.create({
      overlay: { flex: 1, backgroundColor: 'rgba(30,58,44,0.4)', justifyContent: 'flex-end' },
      sheet: { ...sheetWidth, backgroundColor: G.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 26 },
      grabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: G.line, alignSelf: 'center', marginBottom: 14 },
      title: { ...font('display'), flex: 1, fontSize: 20, color: G.ink },
      intro: { ...font('body'), fontSize: 13, color: G.muted, marginTop: -6, marginBottom: 12, lineHeight: 18 },
      empty: { ...font('body'), fontSize: 14.5, color: G.inkSoft, textAlign: 'center', paddingVertical: 30, lineHeight: 21 },
      tabs: { flexDirection: 'row', backgroundColor: G.track, borderRadius: 999, padding: 4, marginBottom: 14, gap: 4 },
      tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 999 },
      tabText: { ...font('bodyBold'), fontSize: 13.5, color: G.inkSoft, flexShrink: 1 },
      tabCount: { ...font('bodyHeavy'), fontSize: 12, color: G.muted },
      list: { backgroundColor: G.card, borderRadius: 24, borderWidth: 1, borderColor: G.line, overflow: 'hidden' },
      row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: G.line },
      rowLabel: { ...font('bodyBold'), fontSize: 15, color: G.ink },
      freqBadge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: G.field, alignItems: 'center', justifyContent: 'center' },
      freqBadgeText: { ...font('bodyHeavy'), fontSize: 10, color: G.inkSoft },
      rowSub: { ...font('body'), flex: 1, fontSize: 12.5, color: G.muted },
      rowAmount: { ...font('bodyHeavy'), fontSize: 15 },
      hint: { ...font('body'), fontSize: 12.5, color: G.muted, textAlign: 'center', marginTop: 10 },
    }),
  };
}

function makeBaseStyles(c: any) {
  return StyleSheet.create({
    portalFill: { ...StyleSheet.absoluteFill, zIndex: 500 },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: { ...sheetWidth, backgroundColor: c.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 26 },
    grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.cardBorder, alignSelf: 'center', marginBottom: 12 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 14 },
    title: { flex: 1, fontSize: 17, fontWeight: '800', color: c.text },
    intro: { fontSize: 12.5, color: c.textSecondary, marginTop: -6, marginBottom: 12 },
    empty: { fontSize: 13.5, color: c.textSecondary, textAlign: 'center', paddingVertical: 30, lineHeight: 20 },
    // Occupe la place restante d'une feuille à hauteur fixe et y centre son contenu.
    fill: { flex: 1, justifyContent: 'center' },
    // Même barre d'onglets que le reste de l'app (cf. le projet partagé) : coquille sur fond carte,
    // onglet actif en aplat de sa couleur sémantique.
    tabs: { flexDirection: 'row', backgroundColor: c.card, borderRadius: 12, padding: 4, marginBottom: 14, borderWidth: 1, borderColor: c.cardBorder, gap: 2 },
    tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, paddingHorizontal: 4, borderRadius: 9 },
    tabText: { fontSize: 13, fontWeight: '700', color: c.textSecondary, flexShrink: 1 },
    tabCount: { fontSize: 11, fontWeight: '800', color: c.textSecondary },
    list: {},
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, marginBottom: 7 },
    rowLabel: { fontSize: 14, fontWeight: '700', color: c.text },
    rowSubLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, minWidth: 0 },
    freqBadge: { minWidth: 16, height: 16, borderRadius: 5, paddingHorizontal: 4, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center', justifyContent: 'center' },
    freqBadgeText: { fontSize: 9.5, fontWeight: '800', color: c.textSecondary },
    rowSub: { flex: 1, fontSize: 11.5, color: c.textSecondary },
    rowAmount: { fontSize: 14, fontWeight: '800' },
    hint: { fontSize: 11.5, color: c.textSecondary, textAlign: 'center', marginTop: 4 },
  });
}
