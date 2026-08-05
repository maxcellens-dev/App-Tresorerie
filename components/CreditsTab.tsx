/**
 * CreditsTab (#6 module Crédit) — onglet « Crédits ». Liste des crédits (CRD + mensualité), section
 * « Crédits partagés » (reçus d'autres users), invitations en attente, et création perso/partagé.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppColors } from '../hooks/useAppColors';
import { useResponsive } from '../hooks/useResponsive';
import { useAuth } from '../contexts/AuthContext';
import { useCredits } from '../hooks/useCredits';
import { useCreditInvitations, useRespondCreditInvitation, useSharedCreditsRealtime } from '../hooks/useSharedCredits';
import { computeAmortization } from '../lib/amortization';
import { todayISO } from '../lib/dateUtils';
import type { Credit } from '../types/database';

const TYPE_META: Record<string, { label: string; icon: string }> = {
  immobilier: { label: 'Immobilier', icon: 'home-outline' },
  consommation: { label: 'Consommation', icon: 'cart-outline' },
  auto: { label: 'Crédit auto', icon: 'car-outline' },
  autre: { label: 'Autre', icon: 'ellipsis-horizontal' },
};

/**
 * `openCreateSignal` : jeton posé par la page Comptes quand une bannière interne cible
 * « Ajouter un crédit » → ouvre directement la modale « Quel type de crédit ? ».
 */
export default function CreditsTab({ userId, openCreateSignal }: { userId?: string; openCreateSignal?: string }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const { isImpersonating } = useAuth();
  const { data: credits = [], isLoading } = useCredits(userId);
  const { data: invitations = [] } = useCreditInvitations(userId);
  const respond = useRespondCreditInvitation(userId);
  useSharedCreditsRealtime(userId);
  const [showType, setShowType] = useState(false);
  useEffect(() => { if (openCreateSignal) setShowType(true); }, [openCreateSignal]);
  const fmt = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  /** Récap : euros pleins (pas de centimes sur un cumul de crédits). */
  const money = (v: number) => Math.round(v).toLocaleString('fr-FR') + ' €';
  const today = todayISO();
  // ≥ 768 px (web bureau/tablette, tablette native) : le récap tient sur une seule ligne.
  const oneLine = !useResponsive().isCompact;

  /* Regroupement par RESPONSABILITÉ (`is_shared`, migration 166) et non par droit d'accès.
     Un crédit qu'on a simplement montré à quelqu'un en consultation reste une dette perso ; un
     crédit souscrit à deux reste partagé même si personne d'autre ne l'a ouvert dans l'app.
     Le rôle (`_role`) continue d'exister — il décide qui peut modifier — mais il ne trie plus rien. */
  const perso = credits.filter((c) => !c.is_shared);
  const shared = credits.filter((c) => c.is_shared);
  /* Tant qu'aucun crédit n'est marqué « partagé », il n'y a qu'UN récap et aucun intertitre :
     l'écran reste exactement celui d'avant pour qui ne s'en sert pas. */
  const splitView = perso.length > 0 && shared.length > 0;

  /* Récap d'un ENSEMBLE de crédits actifs (hors simulation). Le seul « capital restant dû » ne
     disait pas ce qu'il reste réellement à sortir du compte : on coupe donc chaque échéancier à
     aujourd'hui. « Reste à payer » et « Déjà payé » sont des ÉCHÉANCES, assurance comprise (ce qui
     quitte le compte) ; « Intérêts restants » est la part d'intérêts des échéances à venir.

     ⚠️ Un récap ne décrit QUE la liste qu'il surplombe : perso et partagés ont chacun le leur.
     Un total unique mélangeait des crédits dont l'utilisateur n'est pas le débiteur — et, quand il
     n'avait QUE des crédits partagés, aucun total ne s'affichait du tout. */
  const recapOf = (list: Credit[]) => {
    let crd = 0, interestLeft = 0, leftToPay = 0, paid = 0;
    for (const c of list) {
      if (!c.is_active || c.is_simulation) continue;
      const a = computeAmortization(c);
      crd += a.crdAtDate(today);
      for (const r of a.schedule) {
        const due = r.payment + r.insurance;
        if (r.date <= today) paid += due;
        else { leftToPay += due; interestLeft += r.interest; }
      }
    }
    return { crd, interestLeft, leftToPay, paid };
  };

  /* Les 4 chiffres du récap, dans l'ordre de lecture. Montants ARRONDIS à l'euro : sur un total de
     crédits, les centimes n'apportent rien et rendaient la grille illisible (le détail d'un crédit,
     lui, garde ses centimes). Couleurs : ce qui coûte en orange, ce qui est acquis en vert. */
  const cellsOf = (r: ReturnType<typeof recapOf>) => [
    { label: 'Capital restant', value: r.crd, color: COLORS.text, lead: true },
    { label: 'Intérêts restants', value: r.interestLeft, color: COLORS.orange },
    { label: 'Reste à payer', value: r.leftToPay, color: COLORS.text, lead: true },
    { label: 'Déjà payé', value: r.paid, color: COLORS.emerald },
  ];

  const persoCells = useMemo(() => cellsOf(recapOf(perso)), [credits, today, COLORS]);
  const sharedCells = useMemo(() => cellsOf(recapOf(shared)), [credits, today, COLORS]);

  /**
   * Grille des 4 totaux. `adjustsFontSizeToFit` N'EXISTE PAS sur react-native-web (la prop est
   * simplement ignorée) et reste peu fiable sur Android : s'y fier, c'est laisser un montant long
   * se faire tronquer par `numberOfLines={1}` sans que rien ne le rattrape. On dimensionne donc la
   * police NOUS-MÊMES, à partir de la longueur réelle du texte — même rendu sur toutes les plateformes.
   */
  const SummaryGrid = ({ cells }: { cells: ReturnType<typeof cellsOf> }) => (
    <View style={[styles.summary, !oneLine && styles.summaryWrap]}>
      {cells.map((cell, i) => {
        const text = money(cell.value);
        const size = text.length > 13 ? 11 : text.length > 10 ? 12.5 : cell.lead ? 14 : 13;
        return (
          <View
            key={cell.label}
            style={[
              styles.summaryCell,
              oneLine ? styles.summaryCellFlex : styles.summaryCellHalf,
              (oneLine ? i > 0 : i % 2 === 1) && styles.summaryCellSepLeft,
              !oneLine && i >= 2 && styles.summaryCellSepTop,
            ]}
          >
            <Text style={styles.summaryLabel} numberOfLines={1}>{cell.label}</Text>
            <Text style={[styles.summaryValue, cell.lead && styles.summaryValueLead, { fontSize: size, color: cell.color }]} numberOfLines={1}>
              {text}
            </Text>
          </View>
        );
      })}
    </View>
  );

  const row = (c: Credit, idx: number) => {
    const a = computeAmortization(c);
    const meta = TYPE_META[c.type] ?? TYPE_META.autre;
    /* Deux étiquettes, deux sens :
       - `received` = ACCÈS (le crédit appartient à quelqu'un d'autre, je le consulte ou l'édite) ;
       - la pastille « Partagé » = RESPONSABILITÉ, affichée seulement quand rien d'autre ne la dit
         (sans intertitre de section, la nature d'un crédit doit rester lisible sur sa ligne). */
    const received = !!c._role && c._role !== 'owner';
    /* Dénominateur = le NOMBRE DE LIGNES de l'échéancier, pas `duration_months` : un différé ajoute
       des échéances en tête, que le compteur de gauche compte déjà. « 19/300 » avec 6 mois de
       différé annonçait donc un rapport entre deux choses différentes.
       Mensualité = la PROCHAINE échéance réelle (différé, paliers, modulation…) et non la mensualité
       nominale : c'est elle qui explique « déjà payé » et « reste à payer », et son écart avec le
       montant nominal est exactement ce qui faisait douter des totaux. */
    const total = a.schedule.length || c.duration_months;
    const next = a.schedule.find((r) => r.date > today);
    const monthly = next ? next.payment + next.insurance : a.monthlyWithInsurance;
    /* Chiffre de droite = RESTE À PAYER (échéances à venir, assurance comprise) et non le capital
       restant dû. C'est ce qui va réellement sortir du compte : le capital seul sous-estime toujours
       la charge — il ignore les intérêts et l'assurance encore à verser. Le récap garde les deux. */
    let leftToPay = 0;
    for (const r of a.schedule) if (r.date > today) leftToPay += r.payment + r.insurance;
    return (
      <TouchableOpacity key={c.id} style={[styles.row, idx > 0 && styles.rowBorder]} activeOpacity={0.7} onPress={() => router.push(`/(tabs)/comptes/credit/${c.id}` as any)}>
        <View style={[styles.icon, { backgroundColor: COLORS.blue + '1A' }]}><Ionicons name={meta.icon as any} size={18} color={COLORS.blue} /></View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.name} numberOfLines={1}>{c.label}</Text>
            {c.is_simulation && <View style={styles.simTag}><Text style={styles.simTagText}>Simu</Text></View>}
            {c.is_shared && !splitView && <View style={styles.shareTag}><Text style={styles.shareTagText}>Partagé</Text></View>}
            {received && <View style={styles.roleTag}><Text style={styles.roleTagText}>{c._role === 'read' ? 'Consult.' : 'Écriture'}</Text></View>}
          </View>
          <Text style={styles.sub}>{meta.label} · {a.paidCountAtDate(today)}/{total} échéances · {fmt(monthly)}/mois</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.crd}>{fmt(leftToPay)}</Text>
          <Text style={styles.crdLabel}>reste à payer</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.wrap}>
      {/* Écran large (web bureau / tablette) : les 4 chiffres tiennent sur UNE ligne, séparés par
          des filets. Téléphone : la grille se replie en 2 × 2 sans changer de code (flexWrap).
          Un seul groupe → un seul récap, sans intertitre (cas de la très grande majorité). */}
      {!splitView && credits.length > 0 && <SummaryGrid cells={perso.length > 0 ? persoCells : sharedCells} />}
      {splitView && (
        <>
          <Text style={[styles.sectionLabel, { marginTop: 0 }]}>Mes crédits</Text>
          <SummaryGrid cells={persoCells} />
        </>
      )}

      {/* Invitations en attente — même forme que les invitations de comptes partagés/joints. */}
      {invitations.map((inv) => (
        <View key={inv.invite_id} style={styles.inviteCard}>
          <View style={[styles.inviteIcon, { backgroundColor: COLORS.emerald + '1A' }]}>
            <Ionicons name="card-outline" size={18} color={COLORS.emerald} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.inviteName} numberOfLines={1}>{inv.credit_label}</Text>
            <Text style={styles.inviteSub} numberOfLines={1}>{inv.from_name} t'invite · crédit partagé · {inv.role === 'read' ? 'consultation' : 'écriture'}</Text>
          </View>
          {/* En consultation admin, les boutons restent visibles (harmonisé avec les comptes) mais
              l'acceptation se fait côté user (le serveur n'accepte qu'au nom de l'invité réel). */}
          <TouchableOpacity style={styles.inviteDecline} onPress={() => respond.mutate({ inviteId: inv.invite_id, accept: false })} disabled={respond.isPending || isImpersonating}>
            <Ionicons name="close" size={18} color={COLORS.danger} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.inviteAccept} onPress={() => respond.mutate({ inviteId: inv.invite_id, accept: true })} disabled={respond.isPending || isImpersonating}>
            <Ionicons name="checkmark" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      ))}

      {isLoading ? null : credits.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={[styles.emptyIcon, { backgroundColor: COLORS.blue + '1A' }]}><Ionicons name="card-outline" size={26} color={COLORS.blue} /></View>
          <Text style={styles.emptyTitle}>Aucun crédit pour l'instant</Text>
          <Text style={styles.emptyText}>Suis tes crédits immobilier, conso, auto… : capital restant dû, tableau d'amortissement, impact trésorerie.</Text>
        </View>
      ) : (
        <>
          {perso.length > 0 && <View style={styles.list}>{perso.map((c, i) => row(c, i))}</View>}
          {shared.length > 0 && (
            <>
              {/* Le récap des dettes portées à plusieurs est SÉPARÉ de celui des dettes perso :
                  ce ne sont pas les mêmes engagements, les additionner ne veut rien dire. */}
              {splitView && (
                <>
                  <Text style={styles.sectionLabel}>Crédits partagés</Text>
                  <SummaryGrid cells={sharedCells} />
                </>
              )}
              <View style={styles.list}>{shared.map((c, i) => row(c, i))}</View>
            </>
          )}
        </>
      )}

      <TouchableOpacity style={styles.addBtn} onPress={() => setShowType(true)} accessibilityRole="button">
        <Ionicons name="add" size={18} color={COLORS.bg} />
        <Text style={styles.addBtnLabel}>Ajouter un crédit</Text>
      </TouchableOpacity>

      {/* Modal type de crédit (perso / partagé) */}
      <Modal visible={showType} transparent animationType="fade" onRequestClose={() => setShowType(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowType(false)}>
          <TouchableOpacity style={styles.card} activeOpacity={1} onPress={() => {}}>
            <Text style={styles.cardTitle}>Quel type de crédit ?</Text>
            <TouchableOpacity style={styles.opt} onPress={() => { setShowType(false); router.push('/(tabs)/comptes/credit-add' as any); }}>
              <View style={[styles.optIcon, { backgroundColor: COLORS.emerald + '22' }]}><Ionicons name="person" size={22} color={COLORS.emerald} /></View>
              <View style={{ flex: 1 }}><Text style={styles.optTitle}>Personnel</Text><Text style={styles.optSub}>Une dette que tu portes seul.</Text></View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.opt} onPress={() => { setShowType(false); router.push('/(tabs)/comptes/credit-add?shared=1' as any); }}>
              <View style={[styles.optIcon, { backgroundColor: '#3b82f6' + '22' }]}><Ionicons name="people" size={22} color="#3b82f6" /></View>
              <View style={{ flex: 1 }}><Text style={styles.optTitle}>Partagé</Text><Text style={styles.optSub}>Une dette portée à plusieurs. Totalisée à part ; tu donneras les accès après création.</Text></View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: { paddingHorizontal: 16, paddingTop: 8 },
    summary: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 4, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, marginBottom: 12 },
    summaryWrap: { flexWrap: 'wrap' },
    summaryCell: { paddingVertical: 7, paddingHorizontal: 11 },
    summaryCellFlex: { flex: 1 },
    summaryCellHalf: { width: '50%' },
    summaryCellSepLeft: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.cardBorder },
    summaryCellSepTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.cardBorder },
    summaryLabel: { fontSize: 10.5, color: c.textSecondary, fontWeight: '600', letterSpacing: 0.2 },
    // Montants alignés à DROITE : les ordres de grandeur se comparent d'un coup d'œil, colonne
    // par colonne, sans lire les chiffres (les unités sont les unes sous/à côté des autres).
    summaryValue: { fontSize: 13, fontWeight: '700', marginTop: 2, textAlign: 'right' },
    summaryValueLead: { fontSize: 14, fontWeight: '800' },
    sectionLabel: { fontSize: 13, fontWeight: '700', color: c.textSecondary, marginTop: 16, marginBottom: 8, paddingHorizontal: 4 },
    list: { borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.cardBorder },
    icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    name: { fontSize: 15, fontWeight: '700', color: c.text, flexShrink: 1 },
    sub: { fontSize: 11.5, color: c.textSecondary, marginTop: 2 },
    crd: { fontSize: 15, fontWeight: '800', color: c.text },
    crdLabel: { fontSize: 10, color: c.textSecondary },
    simTag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: c.orange + '1A', borderWidth: 1, borderColor: c.orange + '44' },
    simTagText: { fontSize: 9.5, fontWeight: '700', color: c.orange },
    // Nature (dette portée à plusieurs) — bleu, comme le partage ailleurs dans l'app.
    shareTag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: c.blue + '1A', borderWidth: 1, borderColor: c.blue + '44' },
    shareTagText: { fontSize: 9.5, fontWeight: '700', color: c.blue },
    // Accès reçu (crédit de quelqu'un d'autre) — neutre : ce n'est pas une information d'argent.
    roleTag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: c.textSecondary + '18', borderWidth: 1, borderColor: c.textSecondary + '40' },
    roleTagText: { fontSize: 9.5, fontWeight: '700', color: c.textSecondary },
    inviteCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.emerald + '55', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
    inviteIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    inviteName: { fontSize: 14.5, fontWeight: '700', color: c.text },
    inviteSub: { fontSize: 11.5, color: c.textSecondary, marginTop: 1 },
    inviteDecline: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.danger + '55' },
    inviteAccept: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: c.emerald },
    emptyCard: { alignItems: 'center', padding: 24, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, gap: 8 },
    emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
    emptyTitle: { fontSize: 16, fontWeight: '800', color: c.text },
    emptyText: { fontSize: 12.5, color: c.textSecondary, textAlign: 'center', lineHeight: 18 },
    addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.emerald, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 12, marginTop: 14 },
    addBtnLabel: { color: c.bg, fontWeight: '800', fontSize: 14 },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 22 },
    card: { width: '100%', maxWidth: 380, backgroundColor: c.cardSolid ?? c.card, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 20, gap: 12 },
    cardTitle: { fontSize: 18, fontWeight: '800', color: c.text },
    opt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14 },
    optIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    optTitle: { fontSize: 15, fontWeight: '800', color: c.text },
    optSub: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  });
}
