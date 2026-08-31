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
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AppButton from '../ui/AppButton';
import { useAppColors } from '../../hooks/theme/useAppColors';
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

/** Une tuile du bas du récap : icône, libellé, montant déjà mis en forme. */
type RecapTile = { key: string; label: string; icon: string; text: string; color: string };

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
    let crd = 0, interestLeft = 0, insuranceLeft = 0, paid = 0, monthly = 0;
    for (const c of list) {
      if (!countsInTotal(c)) continue;
      // Chaque crédit est libellé dans la devise de son compte → converti avant d'entrer au total.
      const cur = curOf(c);
      const ref = (v: number) => toRef(v, cur);
      const a = amortOf(c);
      const r = recapAtDate(a, today, { events: eventsByCredit[c.id] ?? null });
      crd += ref(r.crd);
      interestLeft += ref(r.interestLeft);
      insuranceLeft += ref(r.insuranceLeft);
      paid += ref(r.paid);
      /* MENSUALITÉ CUMULÉE = ce qui sera prélevé le mois prochain, tous crédits confondus.
         On somme la PROCHAINE échéance réelle (différé, paliers, remboursement anticipé compris),
         le même chiffre que chaque ligne affiche — mais seulement pour les crédits qui en ont
         encore une : `nextPaymentAtDate` retombe sur la mensualité NOMINALE quand tout est
         remboursé (repli utile sur une fiche, faux dans une somme — un crédit soldé ne prélève
         plus rien). */
      if (a.schedule.some((s) => s.date > today)) monthly += ref(nextPaymentAtDate(a, today));
    }
    return { crd, interestLeft, insuranceLeft, paid, monthly };
  };

  /* `curByAccount`/`rates`/`refCode`/`eventsByCredit` DOIVENT être dans les deps : les comptes, les
     taux et les événements arrivent APRÈS le premier rendu. Sans eux, le récap resterait figé sur
     son calcul initial — celui fait alors que la table des devises était encore vide (donc sans
     aucune conversion) et qu'aucun remboursement anticipé n'était connu. */
  const persoRecap = useMemo(() => recapOf(perso), [credits, today, curByAccount, rates, refCode, eventsByCredit]);
  const sharedRecap = useMemo(() => recapOf(shared), [credits, today, curByAccount, rates, refCode, eventsByCredit]);

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
   * Anneau de progression — la part DÉJÀ REMBOURSÉE de la dette, en un coup d'œil.
   *
   * L'arc part de midi (`rotate(-90)`) et se lit dans le sens des aiguilles. La piste reste visible
   * à vide : sans elle, un crédit tout juste souscrit n'aurait rien à montrer et le bloc paraîtrait
   * cassé. Purement décoratif (`pointerEvents="none"`) — un `<Svg>` qui capte le toucher le refuse
   * ensuite au ScrollView parent, et le doigt posé dessus ne ferait plus défiler la page.
   */
  const ProgressRing = ({ pct, label }: { pct: number; label: string }) => {
    const size = 62, stroke = 7;
    const c = size / 2;
    const r = (size - stroke) / 2;
    const circumference = 2 * Math.PI * r;
    return (
      <View pointerEvents="none" style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={c} cy={c} r={r} fill="none" stroke={COLORS.textSecondary + '2E'} strokeWidth={stroke} />
          {pct > 0 && (
            <Circle
              cx={c} cy={c} r={r} fill="none"
              stroke={COLORS.emerald} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={`${(circumference * pct) / 100} ${circumference}`}
              transform={`rotate(-90 ${c} ${c})`}
            />
          )}
        </Svg>
        <View style={StyleSheet.absoluteFill as any}>
          <View style={styles.ringCenter}>
            <Text style={styles.ringPct} testID="recap-pct" numberOfLines={1}>{label} %</Text>
          </View>
        </View>
      </View>
    );
  };

  /**
   * SYNTHÈSE DES CRÉDITS — deux blocs qui répondent à deux questions différentes.
   *
   *   1. « Où en suis-je ? »  → l'anneau, les deux totaux (déjà payé / reste à payer) et la barre
   *      de progression. C'est le même rapport dit trois fois, exprès : le chiffre pour la valeur,
   *      l'anneau et la barre pour la proportion, qu'aucun montant à six chiffres ne donne.
   *   2. « De quoi est-ce fait ? » → les composantes du reste à payer, plus la mensualité.
   *
   * L'INVARIANT reste celui d'avant : capital + intérêts + assurance = reste à payer, à l'euro
   * AFFICHÉ près. On arrondit chaque composante puis on additionne les arrondis — arrondir le total
   * dans son coin laissait un euro d'écart avec l'addition que le lecteur fait de tête. Montants en
   * euros pleins : sur un cumul de crédits, les centimes n'apportent rien (le détail d'un crédit,
   * lui, les garde).
   */
  const SummaryCard = ({ recap }: { recap: ReturnType<typeof recapOf> }) => {
    const crd = Math.round(recap.crd);
    const interest = Math.round(recap.interestLeft);
    const insurance = Math.round(recap.insuranceLeft);
    const left = crd + interest + insurance;
    const paid = Math.round(recap.paid);
    /* Avancement = part déjà versée du coût TOTAL du crédit (intérêts et assurance compris), pas du
       seul capital : c'est l'argent réellement sorti rapporté à l'argent qui sortira en tout.
       UNE DÉCIMALE à l'affichage : sur un prêt de vingt ans, l'entier ne bouge pas pendant des mois
       d'affilée — le dixième, lui, avance à chaque échéance. La valeur non arrondie sert à tracer
       l'arc et la barre, qui n'ont que faire du format. */
    const engaged = paid + left;
    const pct = engaged > 0 ? (paid / engaged) * 100 : 0;
    const pctLabel = pct.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    const tiles: RecapTile[] = [
      { key: 'crd', label: 'Capital restant', icon: 'business-outline', text: money(crd), color: COLORS.text },
      { key: 'interest', label: 'Intérêts restants', icon: 'trending-up-outline', text: money(interest), color: COLORS.orange },
      // Sans assurance, la tuile n'a rien à dire : la grille retombe sur 3 tuiles.
      ...(insurance > 0
        ? [{ key: 'insurance', label: 'Assurance restante', icon: 'shield-outline', text: money(insurance), color: COLORS.orange }]
        : []),
      { key: 'monthly', label: 'Mensualité', icon: 'calendar-outline', text: `${money(Math.round(recap.monthly))}/mois`, color: COLORS.emerald },
    ];

    return (
      <>
        <View style={styles.recapCard}>
          <ProgressRing pct={pct} label={pctLabel} />
          <View style={styles.recapLines}>
            <View style={styles.recapLine}>
              <Text style={styles.recapLineLabel}>Déjà payé</Text>
              <Text testID="recap-paid" style={[styles.recapLineValue, { color: COLORS.emerald }]} numberOfLines={1}>
                {money(paid)}
              </Text>
            </View>
            <View style={styles.recapLine}>
              <Text style={styles.recapLineLabel}>Reste à payer</Text>
              <Text testID="recap-left" style={styles.recapLineValue} numberOfLines={1}>{money(left)}</Text>
            </View>
            {/* La barre reprend l'anneau à l'horizontale, sous les deux montants qu'elle partage :
                elle montre la proportion là où les chiffres, eux, donnent la valeur. */}
            <View style={styles.recapBar}>
              <View style={[styles.recapBarFill, { width: `${Math.max(pct, pct > 0 ? 3 : 0)}%` }]} />
            </View>
          </View>
        </View>

        {/* Les composantes, en tuiles de MÊME largeur (deux par ligne) : le libellé se lit en entier
            quel que soit l'écran, ce que la ligne à trois colonnes d'avant ne permettait plus — elle
            abrégeait « Capital restant » en « Capital » sur téléphone. */}
        <View style={styles.tileGrid}>
          {tiles.map((t) => (
            <View key={t.key} style={styles.tile}>
              <View style={styles.tileHead}>
                <View style={[styles.tileIcon, { backgroundColor: t.color + '1A' }]}>
                  <Ionicons name={t.icon as any} size={13} color={t.color} />
                </View>
                <Text style={styles.tileLabel} numberOfLines={1}>{t.label}</Text>
              </View>
              <Text testID={`recap-${t.key}`} style={[styles.tileValue, { color: t.color }]} numberOfLines={1}>
                {t.text}
              </Text>
            </View>
          ))}
        </View>
      </>
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
          {persoCounted.length > 0 && <SummaryCard recap={persoRecap} />}
          <OutOfTotalNote list={perso} />
        </>
      ) : credits.length === 0 ? null : perso.length > 0 ? (
        <>
          {persoCounted.length > 0 && <SummaryCard recap={persoRecap} />}
          <OutOfTotalNote list={perso} />
        </>
      ) : (
        <>
          {sharedCounted.length > 0 && <SummaryCard recap={sharedRecap} />}
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
                  {sharedCounted.length > 0 && <SummaryCard recap={sharedRecap} />}
                  <OutOfTotalNote list={shared} />
                </>
              )}
              <View style={styles.list}>{shared.map((c, i) => row(c, i))}</View>
            </>
          )}
        </>
      )}

      <AppButton label="Ajouter un crédit" icon="add" size="lg" onPress={() => setShowType(true)} style={{ marginTop: 14 }} />

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

    /* ── Synthèse : « où j'en suis » (anneau + totaux + barre), puis « de quoi c'est fait ». ── */
    recapCard: {
      flexDirection: 'row', alignItems: 'center', gap: 16,
      borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card,
      paddingVertical: 16, paddingHorizontal: 16, marginBottom: 10,
    },
    ringCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    // 13 px : « 100,0 % » doit tenir dans les 48 px de vide au centre de l'anneau.
    ringPct: { fontSize: 13, fontWeight: '800', color: c.text },
    recapLines: { flex: 1, minWidth: 0 },
    // Libellé à gauche, montant à droite : les deux montants s'alignent, donc se comparent.
    recapLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 6 },
    recapLineLabel: { fontSize: 12.5, color: c.textSecondary, fontWeight: '600', flexShrink: 1 },
    recapLineValue: { fontSize: 15, fontWeight: '800', color: c.text, flexShrink: 0 },
    recapBar: { height: 6, borderRadius: 999, backgroundColor: c.textSecondary + '2E', overflow: 'hidden', marginTop: 4 },
    recapBarFill: { height: '100%', borderRadius: 999, backgroundColor: c.emerald },

    /* Tuiles de MÊME largeur, deux par ligne. `48%` + `space-between` plutôt qu'un `gap` : une
       tuile impaire (sans assurance) reste alors calée à gauche au lieu de s'étirer sur la ligne. */
    // marginBottom 4 : chaque tuile porte déjà 8 px sous elle (gouttière entre les deux rangées).
    tileGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 4 },
    tile: {
      width: '48.5%',
      borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card,
      paddingVertical: 10, paddingHorizontal: 11, marginBottom: 8,
    },
    tileHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    tileIcon: { width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
    tileLabel: { fontSize: 11, color: c.textSecondary, fontWeight: '600', flexShrink: 1 },
    tileValue: { fontSize: 14.5, fontWeight: '800', marginTop: 6 },
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
    addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.emerald, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, marginTop: 14 },
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
