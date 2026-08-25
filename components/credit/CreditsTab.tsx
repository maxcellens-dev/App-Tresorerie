/**
 * CreditsTab (#6 module Crédit) — onglet « Crédits ».
 *
 * Deux groupes, séparés par la RESPONSABILITÉ de la dette (`credits.is_shared`, migration 166) —
 * jamais par le droit d'accès (`credit_members`, consultation/écriture) :
 *
 *   « Mes crédits »      → les miens, non marqués partagés. Ce que je dois seul.
 *   « Crédits partagés » → mes dettes portées à plusieurs, ET tout ce que d'autres m'ont partagé.
 *
 * Dans ce second groupe, un crédit REÇU que son propriétaire a marqué PERSO est sa dette à lui :
 * il s'affiche (pastille rouge d'accès + « hors total ») mais n'entre dans AUCUN total. Un crédit
 * reçu marqué PARTAGÉ, lui, est bien une dette commune et compte.
 */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useResponsive } from '../../hooks/theme/useResponsive';
import { useAuth } from '../../contexts/AuthContext';
import { useCredits } from '../../hooks/data/useCredits';
import { useCreditInvitations, useRespondCreditInvitation, useSharedCreditsRealtime } from '../../hooks/data/useSharedCredits';
import { useAllCreditEvents } from '../../hooks/data/useCreditEvents';
import { computeAmortization, nextPaymentAtDate, recapAtDate } from '../../lib/finance/amortization';
import { todayISO } from '../../lib/dateUtils';
import type { Credit } from '../../types/database';
import { CURRENCY_SYMBOL, currencySymbolFor, convertAmount } from '../../lib/finance/currency';
import { useCurrencyRates } from '../../hooks/data/useCurrencyRates';
import { useAllAccounts } from '../../hooks/data/useAccounts';
import { useProfile } from '../../hooks/data/useProfile';

/** Une case du bandeau de totaux. `short` : libellé de repli quand la case est en 3 colonnes. */
type RecapCell = { key: string; label: string; short: string; value: number; color: string; lead?: boolean };

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
  /* Les ÉVÉNEMENTS (remboursement anticipé, renégociation de taux) faisaient défaut ici : cet écran
     appelait `computeAmortization(c)` tout court, là où la fiche du crédit, les flux de trésorerie et
     la matérialisation des échéances passent tous `events`. Un remboursement anticipé enregistré
     laissait donc la liste ET les totaux sur le plan d'origine — capital restant, reste à payer,
     nombre d'échéances et mensualité tous faux, en contradiction avec la fiche du crédit juste à
     côté (30 000 € remboursés = ~31 000 € d'écart de capital restant sur un 200 000 €). */
  const { data: eventsByCredit = {} } = useAllCreditEvents(userId);
  const { data: invitations = [] } = useCreditInvitations(userId);
  const respond = useRespondCreditInvitation(userId);
  useSharedCreditsRealtime(userId);
  const [showType, setShowType] = useState(false);
  useEffect(() => { if (openCreateSignal) setShowType(true); }, [openCreateSignal]);
  /* ── Devises ────────────────────────────────────────────────────────────────────────────────
     Un crédit est prélevé sur UN compte : ses échéances sont libellées dans la devise de ce
     compte-là (c'est déjà ce que fait `useCreditFlows`). Une ligne de crédit sur un compte suisse
     s'affichait pourtant avec le symbole de la devise de référence, et le récap additionnait des
     CHF avec des € — d'où un « reste à payer » total sans signification.
       • ligne d'un crédit → sa propre devise (`fmtIn`) ;
       • récap tous crédits → converti en devise de référence (`money`). */
  const { data: creditAccounts = [] } = useAllAccounts(userId);
  const { data: rates = { EUR: 1 } } = useCurrencyRates();
  const { data: creditProfile } = useProfile(userId);
  const refCode = (creditProfile as any)?.currency_code ?? 'EUR';
  const curByAccount = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of creditAccounts as any[]) m[a.id] = a.currency || refCode;
    return m;
  }, [creditAccounts, refCode]);
  const curOf = (c: Credit) => (c.account_id ? curByAccount[c.account_id] : undefined) ?? refCode;
  const toRef = (v: number, currency: string) => convertAmount(v, currency, refCode, rates) ?? v;

  const fmtIn = (v: number, currency: string) =>
    v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ` ${currencySymbolFor(currency)}`;
  const fmt = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ` ${CURRENCY_SYMBOL}`;
  /** Récap : euros pleins (pas de centimes sur un cumul de crédits). */
  const money = (v: number) => Math.round(v).toLocaleString('fr-FR') + ` ${CURRENCY_SYMBOL}`;
  const today = todayISO();
  // ≥ 768 px (web bureau/tablette, tablette native) : le récap tient sur une seule ligne.
  const oneLine = !useResponsive().isCompact;

  /** Crédit REÇU : il appartient à quelqu'un d'autre, je n'ai qu'un accès (consultation/écriture). */
  const isReceived = (c: Credit) => !!c._role && c._role !== 'owner';

  /* Regroupement par RESPONSABILITÉ (`is_shared`, migration 166) et non par droit d'accès.
     Un crédit qu'on a simplement montré à quelqu'un en consultation reste une dette perso ; un
     crédit souscrit à deux reste partagé même si personne d'autre ne l'a ouvert dans l'app.

       • « Mes crédits »      = les MIENS, non marqués partagés → ce que je dois seul.
       • « Crédits partagés » = mes dettes portées à plusieurs + TOUT ce que j'ai reçu d'autrui.
                                Ce n'est pas « à moi », donc ça ne rejoint jamais « Mes crédits ». */
  const perso = credits.filter((c) => !isReceived(c) && !c.is_shared);
  const shared = credits.filter((c) => isReceived(c) || c.is_shared);

  /* Ce qui COMPTE dans les totaux. Trois façons de rester affiché sans y entrer :
       • un crédit REÇU que son propriétaire a marqué PERSO est sa dette à lui : je ne fais que la
         consulter, elle n'engage rien chez moi (reçu + marqué PARTAGÉ, en revanche, compte bien) ;
       • un crédit DÉSACTIVÉ (« retirer de la projection/tréso ») ;
       • une SIMULATION.
     Les deux derniers étaient exclus des totaux en silence, dont l'un — le désactivé — sans le
     moindre marqueur sur sa ligne : la somme des lignes ne tombait pas, sans explication. */
  const countsInTotal = (c: Credit) => !(isReceived(c) && !c.is_shared) && !!c.is_active && !c.is_simulation;
  const persoCounted = perso.filter(countsInTotal);
  const sharedCounted = shared.filter(countsInTotal);

  /** Amortissement d'un crédit, ÉVÉNEMENTS COMPRIS (cf. `eventsByCredit`). */
  const amortOf = (c: Credit) => computeAmortization({ ...c, events: eventsByCredit[c.id] ?? null });

  /* Tant qu'aucun crédit ne rejoint le groupe « partagés », il n'y a qu'UN récap et aucun intertitre :
     l'écran reste exactement celui d'avant pour qui ne s'en sert pas. */
  const splitView = perso.length > 0 && shared.length > 0;

  /* Récap d'un ENSEMBLE de crédits (ceux qui comptent). Le seul « capital restant dû » ne disait pas
     ce qu'il reste réellement à sortir du compte : `recapAtDate` (lib/finance/amortization) coupe
     l'échéancier à aujourd'hui et tient l'invariant qui rend ce bandeau lisible —
     reste à payer = capital restant + intérêts restants + assurance restante.
     C'est le MÊME calcul que la ligne de chaque crédit, pour qu'ils ne puissent plus diverger.

     ⚠️ Un récap ne décrit QUE la liste qu'il surplombe : perso et partagés ont chacun le leur.
     Un total unique mélangeait des crédits dont l'utilisateur n'est pas le débiteur — et, quand il
     n'avait QUE des crédits partagés, aucun total ne s'affichait du tout. */
  const recapOf = (list: Credit[]) => {
    let crd = 0, interestLeft = 0, insuranceLeft = 0, paid = 0;
    for (const c of list) {
      if (!countsInTotal(c)) continue;
      // Chaque crédit est libellé dans la devise de son compte → converti avant d'entrer au total.
      const cur = curOf(c);
      const ref = (v: number) => toRef(v, cur);
      const r = recapAtDate(amortOf(c), today, { events: eventsByCredit[c.id] ?? null });
      crd += ref(r.crd);
      interestLeft += ref(r.interestLeft);
      insuranceLeft += ref(r.insuranceLeft);
      paid += ref(r.paid);
    }
    return { crd, interestLeft, insuranceLeft, paid };
  };

  /* Les chiffres du récap, dans l'ordre de lecture : les trois COMPOSANTES du reste à payer, puis
     les deux TOTAUX. Trois d'entre eux refusaient de s'additionner sous les yeux du lecteur, faute
     d'afficher l'assurance : « reste à payer » la comprend (c'est ce qui quitte le compte), mais
     elle n'apparaissait nulle part — l'écart passait pour une erreur de calcul.

     Montants ARRONDIS à l'euro : sur un total de crédits, les centimes n'apportent rien et rendaient
     la grille illisible (le détail d'un crédit, lui, garde ses centimes). Le total est la somme des
     composantes TELLES QU'AFFICHÉES : arrondir chacune dans son coin laissait un euro d'écart avec
     l'addition que le lecteur fait de tête. Couleurs : ce qui coûte en orange, l'acquis en vert.
     `short` = libellé de la ligne à 3 colonnes (téléphone), où le libellé complet serait tronqué. */
  const cellsOf = (r: ReturnType<typeof recapOf>): RecapCell[] => {
    const crd = Math.round(r.crd);
    const interest = Math.round(r.interestLeft);
    const insurance = Math.round(r.insuranceLeft);
    return [
      { key: 'crd', label: 'Capital restant', short: 'Capital', value: crd, color: COLORS.text },
      { key: 'interest', label: 'Intérêts restants', short: 'Intérêts', value: interest, color: COLORS.orange },
      // Sans assurance, la cellule n'a rien à dire : la grille reprend sa forme 2 × 2 d'avant.
      ...(insurance > 0 ? [{ key: 'insurance', label: 'Assurance restante', short: 'Assurance', value: insurance, color: COLORS.orange }] : []),
      { key: 'left', label: 'Reste à payer', short: 'Reste à payer', value: crd + interest + insurance, color: COLORS.text, lead: true },
      { key: 'paid', label: 'Déjà payé', short: 'Déjà payé', value: Math.round(r.paid), color: COLORS.emerald, lead: true },
    ];
  };

  /* `curByAccount`/`rates`/`refCode`/`eventsByCredit` DOIVENT être dans les deps : les comptes, les
     taux et les événements arrivent APRÈS le premier rendu. Sans eux, le récap resterait figé sur
     son calcul initial — celui fait alors que la table des devises était encore vide (donc sans
     aucune conversion) et qu'aucun remboursement anticipé n'était connu. */
  const persoCells = useMemo(() => cellsOf(recapOf(perso)), [credits, today, COLORS, curByAccount, rates, refCode, eventsByCredit]);
  const sharedCells = useMemo(() => cellsOf(recapOf(shared)), [credits, today, COLORS, curByAccount, rates, refCode, eventsByCredit]);

  /* Un total qui ne couvre pas toute la liste qu'il surplombe DOIT le dire, sinon il passe pour faux
     (« pourquoi la somme des lignes ne tombe pas ? »). Trois motifs de sortie, deux phrases : la
     dette d'autrui, et le crédit qu'on a soi-même mis de côté (désactivé ou simulation). */
  const OutOfTotalNote = ({ list }: { list: Credit[] }) => {
    const others = list.filter((c) => isReceived(c) && !c.is_shared).length;
    const off = list.filter((c) => !(isReceived(c) && !c.is_shared) && !countsInTotal(c)).length;
    if (others + off === 0) return null;
    const parts: string[] = [];
    if (others > 0) parts.push(others === 1
      ? "1 crédit appartient à un autre utilisateur : tu y as accès, il n'entre dans aucun total."
      : `${others} crédits appartiennent à d'autres utilisateurs : tu y as accès, ils n'entrent dans aucun total.`);
    if (off > 0) parts.push(off === 1
      ? '1 crédit est désactivé ou en simulation : il reste affiché, hors total.'
      : `${off} crédits sont désactivés ou en simulation : ils restent affichés, hors total.`);
    return <Text style={styles.recapNote}>{parts.join(' ')}</Text>;
  };

  /**
   * Bandeau de totaux. La grille se lit comme l'ADDITION qu'elle est : les composantes d'abord
   * (capital + intérêts + assurance), les totaux en dessous, plus gros. Sur téléphone, ça tient
   * dans les deux mêmes lignes qu'avant — 3 colonnes puis 2 — donc sans rien coûter en hauteur ;
   * sur écran large, tout reste sur une seule ligne. Sans assurance, on retombe sur 2 × 2.
   *
   * `adjustsFontSizeToFit` N'EXISTE PAS sur react-native-web (la prop est simplement ignorée) et
   * reste peu fiable sur Android : s'y fier, c'est laisser un montant long se faire tronquer par
   * `numberOfLines={1}` sans que rien ne le rattrape. On dimensionne donc la police NOUS-MÊMES, à
   * partir de la longueur réelle du texte — et plus tôt dans une colonne étroite.
   */
  const SummaryGrid = ({ cells }: { cells: RecapCell[] }) => {
    const rows: RecapCell[][] = oneLine
      ? [cells]
      : [cells.slice(0, cells.length - 2), cells.slice(cells.length - 2)];
    return (
      <View style={[styles.summary, !oneLine && styles.summaryWrap]}>
        {rows.map((row, ri) =>
          row.map((cell, ci) => {
            // Colonne étroite (3 par ligne sur téléphone) : libellé court + police plus petite.
            // Sur écran large les cinq cases sont sur une ligne, mais chacune reste assez large
            // pour son libellé complet — d'où le `!oneLine`.
            const narrow = !oneLine && row.length > 2;
            const text = money(cell.value);
            const size = narrow
              ? (text.length > 11 ? 10.5 : text.length > 9 ? 11.5 : 12.5)
              : (text.length > 13 ? 11 : text.length > 10 ? 12.5 : cell.lead ? 14 : 13);
            return (
              <View
                key={cell.key}
                style={[
                  styles.summaryCell,
                  narrow && styles.summaryCellNarrow,
                  oneLine ? styles.summaryCellFlex : { width: row.length === 3 ? '33.33%' : '50%' },
                  ci > 0 && styles.summaryCellSepLeft,
                  ri > 0 && styles.summaryCellSepTop,
                ]}
              >
                <Text style={styles.summaryLabel} numberOfLines={1} accessibilityLabel={cell.label}>
                  {narrow ? cell.short : cell.label}
                </Text>
                <Text
                  testID={`recap-${cell.key}`}
                  style={[styles.summaryValue, cell.lead && styles.summaryValueLead, { fontSize: size, color: cell.color }]}
                  numberOfLines={1}
                >
                  {text}
                </Text>
              </View>
            );
          }),
        )}
      </View>
    );
  };

  const row = (c: Credit, idx: number) => {
    const a = amortOf(c);
    const meta = TYPE_META[c.type] ?? TYPE_META.autre;
    /* Deux étiquettes, deux sens :
       - la pastille ROUGE = ACCÈS reçu : ce crédit est à quelqu'un d'autre, je ne fais que le
         consulter ou l'éditer. Rouge parce qu'elle prévient d'un piège de lecture — la ligne
         ressemble à mes autres crédits alors qu'elle n'engage pas mon argent ;
       - la pastille bleue « Partagé » = RESPONSABILITÉ, affichée seulement quand aucun intertitre
         de section ne le dit déjà. */
    const received = isReceived(c);
    // Hors total = dette d'autrui, crédit désactivé, ou simulation. La ligne le dit, toujours.
    const outOfTotal = !countsInTotal(c);
    /* Dénominateur = le NOMBRE DE LIGNES de l'échéancier, pas `duration_months` : un différé ajoute
       des échéances en tête, que le compteur de gauche compte déjà. « 19/300 » avec 6 mois de
       différé annonçait donc un rapport entre deux choses différentes.
       Mensualité = la PROCHAINE échéance réelle (différé, paliers, modulation…) et non la mensualité
       nominale : c'est elle qui explique « déjà payé » et « reste à payer », et son écart avec le
       montant nominal est exactement ce qui faisait douter des totaux. */
    const total = a.schedule.length || c.duration_months;
    // Helper PARTAGÉ (lib/finance/amortization) : la fiche du crédit affiche exactement le même
    // chiffre, alors qu'elle montrait la mensualité nominale — deux montants pour la même ligne.
    const monthly = nextPaymentAtDate(a, today);
    /* Chiffre de droite = RESTE À PAYER (capital + intérêts + assurance encore à verser) et non le
       capital restant dû : c'est ce qui va réellement sortir du compte, le capital seul sous-estime
       toujours la charge. Même helper que le récap, donc la somme des lignes tombe forcément juste. */
    const { leftToPay } = recapAtDate(a, today, { events: eventsByCredit[c.id] ?? null });
    return (
      <TouchableOpacity key={c.id} style={[styles.row, idx > 0 && styles.rowBorder]} activeOpacity={0.7} onPress={() => router.push(`/(tabs)/comptes/credit/${c.id}` as any)}>
        <View style={[styles.icon, { backgroundColor: COLORS.blue + '1A' }]}><Ionicons name={meta.icon as any} size={18} color={COLORS.blue} /></View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text style={styles.name} numberOfLines={1}>{c.label}</Text>
            {c.is_simulation && <View style={styles.simTag}><Text style={styles.simTagText}>Simu</Text></View>}
            {/* Pastilles-ICÔNES et non libellés : « Partagé » + « Écriture » côte à côte prenaient plus
                de place que le nom du crédit lui-même, qui se retrouvait tronqué à « PTZ… ». Le nom
                est l'information qui permet de reconnaître la ligne — il passe en premier.
                Le sens exact reste lisible : au toucher (libellé d'accessibilité) et sur la fiche. */}
            {c.is_shared && !splitView && (
              <View style={styles.dotTag} accessibilityLabel="Dette partagée">
                <Ionicons name="people" size={11} color={COLORS.blue} />
              </View>
            )}
            {/* Désactivé : la ligne restait strictement identique à un crédit actif alors qu'elle ne
                pesait dans aucun total — la simulation, elle, avait sa pastille. */}
            {!c.is_active && (
              <View style={styles.dotTagMuted} accessibilityLabel="Crédit désactivé — hors des totaux">
                <Ionicons name="pause" size={11} color={COLORS.textSecondary} />
              </View>
            )}
            {received && (
              <View
                style={styles.dotTagDanger}
                accessibilityLabel={c._role === 'read' ? "Crédit d'un autre utilisateur — consultation" : "Crédit d'un autre utilisateur — écriture"}
              >
                <Ionicons name={c._role === 'read' ? 'eye' : 'create'} size={11} color={COLORS.danger} />
              </View>
            )}
          </View>
          <Text style={styles.sub}>
            {meta.label} · {a.paidCountAtDate(today)}/{total} échéances · {fmtIn(monthly, curOf(c))}/mois
            {outOfTotal ? ' · hors total' : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.crd}>{fmtIn(leftToPay, curOf(c))}</Text>
          <Text style={styles.crdLabel}>reste à payer</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.wrap}>
      {/* Écran large (web bureau / tablette) : les chiffres tiennent sur UNE ligne, séparés par des
          filets. Téléphone : composantes puis totaux, sur deux lignes.
          Un seul groupe → un seul récap, sans intertitre (cas de la très grande majorité).
          Le récap ne sort que s'il reste quelque chose à totaliser : n'avoir que des crédits
          d'autrui (ou désactivés) ne doit pas afficher une grille de zéros — la note explique. */}
      {splitView ? (
        <>
          <Text style={[styles.sectionLabel, { marginTop: 0 }]}>Mes crédits</Text>
          {persoCounted.length > 0 && <SummaryGrid cells={persoCells} />}
          <OutOfTotalNote list={perso} />
        </>
      ) : credits.length === 0 ? null : perso.length > 0 ? (
        <>
          {persoCounted.length > 0 && <SummaryGrid cells={persoCells} />}
          <OutOfTotalNote list={perso} />
        </>
      ) : (
        <>
          {sharedCounted.length > 0 && <SummaryGrid cells={sharedCells} />}
          <OutOfTotalNote list={shared} />
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
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" style={styles.inviteDecline} onPress={() => respond.mutate({ inviteId: inv.invite_id, accept: false })} disabled={respond.isPending || isImpersonating}>
            <Ionicons name="close" size={18} color={COLORS.danger} />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Accepter l'invitation" style={styles.inviteAccept} onPress={() => respond.mutate({ inviteId: inv.invite_id, accept: true })} disabled={respond.isPending || isImpersonating}>
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
                  {sharedCounted.length > 0 && <SummaryGrid cells={sharedCells} />}
                  <OutOfTotalNote list={shared} />
                </>
              )}
              <View style={styles.list}>{shared.map((c, i) => row(c, i))}</View>
            </>
          )}
        </>
      )}

      <TouchableOpacity style={styles.addBtn} onPress={() => setShowType(true)} accessibilityRole="button">
        <Ionicons name="add" size={18} color={COLORS.onAccent} />
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
    // 3 colonnes sur un écran de téléphone : on rend au montant les marges qu'on lui prend ailleurs.
    summaryCellNarrow: { paddingHorizontal: 7 },
    summaryCellFlex: { flex: 1 },
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
    simTag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, flexShrink: 0, backgroundColor: c.orange + '1A', borderWidth: 1, borderColor: c.orange + '44' },
    simTagText: { fontSize: 9.5, fontWeight: '700', color: c.orange },
    /* Pastilles-icônes : 18 px au lieu des ~60 px d'un libellé. `flexShrink: 0` — elles ne doivent
       jamais se comprimer, sinon l'icône se déforme quand le nom du crédit est long. */
    dotTag: {
      width: 18, height: 18, borderRadius: 9, flexShrink: 0,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.blue + '1A', borderWidth: 1, borderColor: c.blue + '44',
    },
    // Accès reçu (crédit de quelqu'un d'autre) — ROUGE : c'est un avertissement, pas une décoration.
    // La ligne ressemble à mes autres crédits, alors qu'elle ne pèse sur aucun de mes totaux.
    dotTagDanger: {
      width: 18, height: 18, borderRadius: 9, flexShrink: 0,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.danger + '1A', borderWidth: 1, borderColor: c.danger + '55',
    },
    // Crédit DÉSACTIVÉ : en sourdine, comme ce qu'il est — mis de côté, hors des totaux.
    dotTagMuted: {
      width: 18, height: 18, borderRadius: 9, flexShrink: 0,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.textSecondary + '1A', borderWidth: 1, borderColor: c.textSecondary + '44',
    },
    // Mention sous un récap qui ne couvre pas toute la liste (crédits d'autrui exclus).
    recapNote: { fontSize: 11, color: c.textSecondary, fontStyle: 'italic', lineHeight: 15, marginTop: -6, marginBottom: 12, paddingHorizontal: 4 },
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
    addBtnLabel: { color: c.onAccent, fontWeight: '800', fontSize: 14 },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 22 },
    card: { width: '100%', maxWidth: 380, backgroundColor: c.cardSolid ?? c.card, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 20, gap: 12 },
    cardTitle: { fontSize: 18, fontWeight: '800', color: c.text },
    opt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14 },
    optIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    optTitle: { fontSize: 15, fontWeight: '800', color: c.text },
    optSub: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  });
}
