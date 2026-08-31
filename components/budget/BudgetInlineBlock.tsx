/**
 * LE BLOC BUDGET DE LA SAISIE — sur l'étape « Quand ? », sous la récurrence.
 *
 * POURQUOI LÀ ET PAS À L'ÉTAPE 1 : le montant est acquis à l'étape 1, mais la DATE se règle ici — et
 * c'est la date qui décide de tout. Une dépense datée du 12 novembre doit interroger le budget de
 * novembre (celui qui y sera reporté) et le consommé de novembre, pas ceux du mois courant.
 * Afficher le bloc à l'étape 1 obligerait à le recalculer une seconde fois derrière, ou à mentir.
 *
 * RÉSOLUTION : sous-catégorie → catégorie parente → RIEN. Pas de repli sur le budget global : au
 * moment de saisir 40 € de courses, « il te reste 220 € sur 1 000 € » n'apprend rien d'actionnable.
 *
 * PERFORMANCE : tout vient du cache déjà chargé et le calcul est mémorisé sur
 * [categoryId, date, amount]. Changer la date ne déclenche AUCUNE requête — le chemin
 * d'enregistrement reste celui d'avant.
 */
import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useAuth } from '../../contexts/AuthContext';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { useBudgetContext } from '../../hooks/data/useBudgetData';
import { periodLabel, resolveBudgetFor } from '../../lib/finance/budgetEngine';
import BudgetGauge from './BudgetGauge';

interface Props {
  categoryId: string | null | undefined;
  /** Date SAISIE (ISO). Pilote la période lue, en temps réel. */
  date: string;
  /** Montant en cours de saisie, positif. */
  amount: number;
  /** Transaction en cours de modification — exclue du consommé pour ne pas se compter deux fois. */
  excludeTxId?: string | null;
  /** Une récurrente n'entre pas dans le budget variable : le bloc n'a alors rien à dire. */
  hidden?: boolean;
  /**
   * `form` (défaut) — pendant la saisie : la jauge projette ce que l'opération VA consommer.
   * `recap` — après enregistrement (carte « C'est enregistré ») : l'opération est déjà comptée,
   * on montre l'état atteint. Même bloc, pour que le budget se reconnaisse au même endroit du
   * regard avant et après.
   */
  variant?: 'form' | 'recap';
}

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');

export default function BudgetInlineBlock({ categoryId, date, amount, excludeTxId, hidden, variant = 'form' }: Props) {
  const C = useAppColors();
  const s = useMemo(() => makeStyles(C), [C]);
  const { user } = useAuth();
  const ctx = useBudgetContext(user?.id);

  const resolved = useMemo(() => {
    if (hidden || !ctx.isReady) return null;
    return resolveBudgetFor({
      categoryId, date, amount,
      fluxTx: ctx.fluxTx,
      accountTypeById: ctx.accountTypeById,
      categories: ctx.categories,
      budgets: ctx.budgets ?? [],
      today: ctx.today,
      excludeTxId,
    });
  }, [hidden, ctx.isReady, ctx.fluxTx, ctx.accountTypeById, ctx.categories, ctx.budgets, ctx.today, categoryId, date, amount, excludeTxId]);

  // Aucun budget sur ce périmètre : AUCUNE ligne, aucun espace réservé, aucune invitation à en
  // créer un. Le formulaire de saisie n'est pas un endroit où l'on démarche l'utilisateur.
  if (!resolved) return null;

  const over = resolved.remainingAfter < 0;
  const tint = over ? C.warning : C.textSecondary;
  // Sur un mois futur, rien n'a encore été DÉPENSÉ : dire le contraire serait faux, et se verrait.
  const verb = resolved.isFuture ? 'déjà saisis' : 'dépensés';
  /* En RÉCAPITULATIF, l'opération est déjà enregistrée : `spentBefore` la contient. Afficher
     « après cette opération » n'aurait alors aucun sens — c'est déjà l'après. */
  const done = variant === 'recap';

  return (
    <View style={[s.wrap, { borderLeftColor: over ? C.warning : C.primary }, done && s.wrapRecap]}>
      <View style={s.head}>
        {/* La cible est nommée d'abord — « 🎯 » puis la catégorie : c'est ce qui fait reconnaître
            un budget d'un coup d'œil, au milieu d'autres chiffres qui n'en sont pas. */}
        <Text style={s.kicker}>
          🎯 {resolved.period === 'year' ? 'Budget de l’année' : 'Budget du mois'}
        </Text>
        <Text style={s.period}>
          {periodLabel(resolved.period, resolved.periodKey)}
          {resolved.inherited ? ' · repris' : ''}
        </Text>
      </View>

      <Text style={s.name} numberOfLines={1}>{resolved.name}</Text>

      {done ? (
        /* RÉCAPITULATIF — le montant et son verdict sur UNE ligne, la jauge en dessous.
           Empilés (montant, jauge, puis phrase), ils prenaient trois hauteurs de texte dans une
           carte qui en compte déjà plusieurs. Ici les deux chiffres qui comptent se lisent d'un
           seul regard, et la jauge les illustre au lieu de les séparer. */
        <>
          <View style={s.recapRow}>
            <Text style={s.value}>
              {fmt(resolved.spentBefore)}
              <Text style={s.valueSub}> / {fmt(resolved.budget)} {CURRENCY_SYMBOL} {verb}</Text>
            </Text>
            {/* Le ton : un dépassement de budget est une information, pas un incident. */}
            <Text style={[s.recapNote, { color: tint }]} numberOfLines={1}>
              {over
                ? `Dépassé de ${fmt(-resolved.remainingAfter)} ${CURRENCY_SYMBOL}`
                : `Reste ${fmt(resolved.remainingAfter)} ${CURRENCY_SYMBOL}`}
            </Text>
          </View>
          <BudgetGauge spent={resolved.spentBefore} budget={resolved.budget} compact />
        </>
      ) : (
        <>
          <Text style={s.value}>
            {fmt(resolved.spentBefore)}
            <Text style={s.valueSub}> / {fmt(resolved.budget)} {CURRENCY_SYMBOL} {verb}</Text>
          </Text>
          <BudgetGauge spent={resolved.spentAfter} budget={resolved.budget} spentBefore={resolved.spentBefore} compact />
          <View style={s.foot}>
            <Ionicons name={over ? 'alert-circle-outline' : 'arrow-forward'} size={13} color={tint} />
            <Text style={[s.note, { color: tint }]}>
              Après cette opération : <Text style={s.noteStrong}>{fmt(resolved.spentAfter)} {CURRENCY_SYMBOL}</Text>
              {over
                ? ` · dépassement de ${fmt(-resolved.remainingAfter)} ${CURRENCY_SYMBOL}`
                : ` · ${fmt(resolved.remainingAfter)} ${CURRENCY_SYMBOL} restants`}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: {
      borderLeftWidth: 2, paddingLeft: 12, paddingVertical: 10, marginBottom: 18,
      backgroundColor: c.card, borderTopRightRadius: 10, borderBottomRightRadius: 10, paddingRight: 12,
    },
    // Dans la carte de confirmation, le bloc est déjà sur une surface : il se pose dessus.
    wrapRecap: { marginBottom: 0, marginTop: 10, backgroundColor: c.bg },
    head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
    kicker: { fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: '700', color: c.textSecondary },
    period: { fontSize: 10, color: c.textSecondary, textTransform: 'capitalize' },
    name: { fontSize: 12.5, fontWeight: '600', color: c.text, marginTop: 5 },
    value: { fontSize: 15, fontWeight: '800', color: c.text, marginTop: 2, fontVariant: ['tabular-nums'] },
    valueSub: { fontSize: 11.5, fontWeight: '500', color: c.textSecondary },
    recapRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
    recapNote: { fontSize: 11.5, fontWeight: '700', flexShrink: 0 },
    foot: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
    note: { flex: 1, fontSize: 11, lineHeight: 15 },
    noteStrong: { fontWeight: '700', color: c.text },
  });
}
