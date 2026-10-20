/**
 * « Dépensé » — le détail de ce qui est sorti du compte courant depuis le 1er du mois.
 *
 * Ouverte en touchant « Dépensé » dans Mon argent › Ce mois (pas depuis l'accueil du Jardin, qui
 * renvoie vers ce suivi). Même liste que l'ancien détail du Pilotage (`vm.suiviDetail.spent`) :
 *   - la répartition par catégorie PARENTE (anneau + légende) — toucher une catégorie filtre la
 *     liste, la toucher à nouveau retire le filtre ;
 *   - un filtre « Récurrentes » (ce qui revient chaque mois, là-dedans) ;
 *   - les opérations, regroupées par jour, de la plus récente à la plus ancienne.
 * Un remboursement (montant positif sur une catégorie de dépense) diminue le total de sa catégorie,
 * exactement comme dans le chiffre « Dépensé ».
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GardenSheet from './GardenSheet';
import GardenText from './GardenText';
import MonthTxRow, { MonthTxCard, dayLabel } from './MonthTxRow';
import CategoryDonut from '../charts/CategoryDonut';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';
import { formatEuros } from '../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { pointer, transition } from '../../lib/ui/webLayout';

const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);
const isRecurringTx = (t: any) => !!t?.materialized_from || !!t?.credit_kind;

interface Props {
  visible: boolean;
  onClose: () => void;
  spent: any[];
  monthName: string;
  /** Nom de la catégorie parente, par nom de (sous-)catégorie en minuscules. */
  catParentName: Record<string, string>;
  /** Montant SIGNÉ en devise de référence, compté comme dépensé (sortie > 0, remboursement < 0). */
  spentRef: (t: any) => number;
  onOpenTx: (t: any) => void;
}

export default function SpentSheet({ visible, onClose, spent, monthName, catParentName, spentRef, onOpenTx }: Props) {
  const [cat, setCat] = useState<string | null>(null);
  const [recurOnly, setRecurOnly] = useState(false);
  // Chaque ouverture repart de la vue d'ensemble.
  useEffect(() => { if (visible) { setCat(null); setRecurOnly(false); } }, [visible]);

  const parentOf = (t: any) => {
    const sub = t.category?.name || 'Sans catégorie';
    return catParentName[String(sub).toLowerCase()] || sub;
  };
  const source = recurOnly ? spent.filter(isRecurringTx) : spent;
  const palette = [G.fruits, G.water, G.roots, G.branches, G.flowers, G.brambles, '#8C7AE6', '#3FB5A3', G.muted];

  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of source) m.set(parentOf(t), (m.get(parentOf(t)) ?? 0) + spentRef(t));
    return [...m.entries()]
      .filter(([, v]) => v > 0.5)
      .sort((a, b) => b[1] - a[1])
      .map(([key, total], i) => ({ key, total, color: palette[Math.min(i, palette.length - 1)] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, catParentName]);
  const total = groups.reduce((s, g) => s + g.total, 0);
  const activeCat = cat && groups.some((g) => g.key === cat) ? cat : null;
  const list = activeCat ? source.filter((t) => parentOf(t) === activeCat) : source;
  const listTotal = list.reduce((s, t) => s + spentRef(t), 0);
  const hasRecurring = spent.some(isRecurringTx);

  // Regroupement par jour (liste déjà triée du plus récent au plus ancien).
  const days: { day: string; items: any[] }[] = [];
  for (const t of list) {
    const d = String(t.date ?? '').slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.day === d) last.items.push(t); else days.push({ day: d, items: [t] });
  }

  return (
    <GardenSheet visible={visible} onClose={onClose} title={`Dépensé en ${monthName}`}
      subtitle={`${spent.length} opération${spent.length > 1 ? 's' : ''} sur ton compte courant depuis le 1er`}>
      {spent.length === 0 ? (
        <GardenText variant="body" color={G.inkSoft} center style={{ paddingVertical: GARDEN_SPACE.xxl }}>
          Rien n'est encore sorti de ton compte courant ce mois-ci.
        </GardenText>
      ) : (
        <>
          {/* Répartition : l'anneau, et la légende qui sert de filtre. */}
          <View style={{ backgroundColor: G.card, borderRadius: GARDEN_RADII.lg, borderWidth: 1, borderColor: G.line, padding: GARDEN_SPACE.lg, gap: GARDEN_SPACE.md }}>
            <View style={{ alignItems: 'center' }}>
              <CategoryDonut
                segments={groups.map((g) => ({ key: g.key, value: g.total, color: g.color }))}
                size={156} strokeWidth={20} activeKey={activeCat}
                centerLabel={eur(activeCat ? listTotal : total)}
                centerSub={activeCat ?? (recurOnly ? 'récurrent' : 'au total')}
                centerColor={G.ink} centerSubColor={G.muted}
              />
            </View>
            <View style={{ gap: 2 }}>
              {groups.map((g) => {
                const on = activeCat === g.key;
                return (
                  <Pressable key={g.key} onPress={() => setCat(on ? null : g.key)} accessibilityRole="button" accessibilityState={{ selected: on }}
                    accessibilityLabel={`${g.key}, ${eur(g.total)}${on ? ', filtre actif' : ''}`}
                    style={({ pressed, hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.sm, minHeight: 40, paddingHorizontal: GARDEN_SPACE.sm, borderRadius: GARDEN_RADII.sm, opacity: activeCat && !on ? 0.5 : 1 },
                      on || pressed || hovered ? { backgroundColor: G.field } : null, pointer, transition]}>
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: g.color }} />
                    <GardenText variant="body" style={{ flex: 1 }} numberOfLines={1}>{g.key}</GardenText>
                    <GardenText variant="small" color={G.muted} tabular>{total > 0 ? Math.round((g.total / total) * 100) : 0} %</GardenText>
                    <GardenText variant="bodyStrong" tabular style={{ minWidth: 72, textAlign: 'right' }}>{eur(g.total)}</GardenText>
                  </Pressable>
                );
              })}
            </View>
            {hasRecurring ? (
              <Pressable onPress={() => setRecurOnly((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: recurOnly }}
                style={({ hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: 12, minHeight: 36, borderRadius: GARDEN_RADII.pill, borderWidth: 1, borderColor: recurOnly ? G.waterText : G.line, backgroundColor: recurOnly ? G.waterBg : hovered ? G.field : 'transparent' }, pointer, transition]}>
                <Ionicons name="repeat" size={14} color={recurOnly ? G.waterText : G.inkSoft} />
                <GardenText variant="smallStrong" color={recurOnly ? G.waterText : G.inkSoft}>Seulement ce qui revient chaque mois</GardenText>
              </Pressable>
            ) : null}
          </View>

          {/* Les opérations, jour par jour. */}
          {days.length === 0 ? (
            <GardenText variant="body" color={G.inkSoft} center>Aucune opération pour ce filtre.</GardenText>
          ) : days.map(({ day, items }) => (
            <View key={day} style={{ gap: GARDEN_SPACE.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 }}>
                <GardenText variant="label">{dayLabel(day)}</GardenText>
                <GardenText variant="smallStrong" color={G.inkSoft} tabular>{eur(items.reduce((s, t) => s + spentRef(t), 0))}</GardenText>
              </View>
              <MonthTxCard>
                {items.map((t, i) => {
                  const amt = Number(t.amount);
                  const subParts = [t.category?.name && t.note ? t.category.name : null, isRecurringTx(t) ? 'revient chaque mois' : null, amt > 0 ? 'remboursement' : null].filter(Boolean);
                  return (
                    <MonthTxRow key={t.id} t={t} first={i === 0} amount={Math.abs(amt)} positive={amt > 0}
                      sub={subParts.join(' · ') || undefined} onPress={() => onOpenTx(t)} />
                  );
                })}
              </MonthTxCard>
            </View>
          ))}
        </>
      )}
    </GardenSheet>
  );
}
