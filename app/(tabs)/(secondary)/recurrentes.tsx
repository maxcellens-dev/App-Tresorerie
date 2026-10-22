/**
 * CE QUI REVIENT — tes rentrées et tes charges régulières, en tuiles. Une tuile ouvre la saisie
 * rapide déjà réglée (catégorie, libellé, rythme habituel) : il reste à taper le montant, vérifier
 * la date, enregistrer. Tout se change au tap (rythme, date, compte, catégorie).
 *
 * En dessous, la VRAIE liste de ce qui est déjà prévu (useRecurringTransactions) : pas de coche
 * devinée sur une tuile — une charge déjà prévue se lit dans la liste, telle qu'elle est enregistrée.
 */
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import GardenPage from '../../../components/garden/GardenPage';
import GardenText from '../../../components/garden/GardenText';
import GardenCard from '../../../components/garden/GardenCard';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useAuth } from '../../../contexts/AuthContext';
import { useRecurringTransactions, ruleLabel } from '../../../hooks/data/useRecurringTransactions';
import { RECURRING_PRESETS, type RecurringPreset } from '../../../lib/finance/recurringPresets';
import { currencySymbolFor } from '../../../lib/finance/currency';
import { formatDateFrench } from '../../../lib/dateUtils';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../../lib/garden/theme';
import { pointer } from '../../../lib/ui/webLayout';

const HERE = '/(tabs)/(secondary)/recurrentes';

export default function RecurrentesScreen() {
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const { data: planned = [] } = useRecurringTransactions(user?.id);

  const open = (p: RecurringPreset) => router.push(`/(tabs)/transactions/add?type=${p.kind}&preset=${p.key}&origin=${encodeURIComponent(HERE)}` as any);

  const section = (kind: 'income' | 'expense', title: string) => (
    <View style={{ gap: GARDEN_SPACE.sm }}>
      <GardenText variant="label">{title}</GardenText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {RECURRING_PRESETS.filter((p) => p.kind === kind).map((p) => (
          <Pressable key={p.key} onPress={() => open(p)} accessibilityRole="button" accessibilityLabel={`Ajouter : ${p.label}`}
            style={({ pressed, hovered }: any) => [{
              width: '31%', flexGrow: 1, minHeight: 84, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8,
              borderRadius: GARDEN_RADII.md, borderWidth: 1, borderColor: G.line,
              backgroundColor: pressed ? G.track : hovered ? G.field : G.card,
            }, pointer]}>
            <Ionicons name={p.icon as any} size={24} color={kind === 'income' ? G.branchesText : G.fruitsText} />
            <GardenText variant="smallStrong" center numberOfLines={2}>{p.label}</GardenText>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <GardenPage secondary header={<ScreenHeader title="Ce qui revient" onBack={goBack} />}>
      <GardenText variant="body" color={G.inkSoft}>Touche une tuile, tape le montant et enregistre : c'est prévu automatiquement, chaque semaine, mois, trimestre ou année.</GardenText>
      {section('income', 'Tes rentrées')}
      {section('expense', 'Tes charges')}

      <View style={{ gap: GARDEN_SPACE.sm }}>
        <GardenText variant="label">Déjà prévu{planned.length ? ` · ${planned.length}` : ''}</GardenText>
        {planned.length === 0 ? (
          <GardenText variant="small" color={G.muted}>Rien pour l'instant. Commence par ton salaire et ton loyer.</GardenText>
        ) : (
          <GardenCard style={{ paddingVertical: 4 }}>
            {planned.map((r, i) => (
              <Pressable key={r.id} onPress={() => router.push(`/(tabs)/transactions/edit/${r.id}?origin=${encodeURIComponent(HERE)}` as any)} accessibilityRole="button" accessibilityLabel={`${r.label} : modifier ou arrêter`}
                style={({ hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: G.line, opacity: hovered ? 0.8 : 1 }, pointer]}>
                <Ionicons name={r.kind === 'income' ? 'arrow-down-circle-outline' : r.kind === 'transfer' ? 'swap-horizontal-outline' : 'arrow-up-circle-outline'} size={22}
                  color={r.kind === 'income' ? G.branchesText : r.kind === 'transfer' ? G.waterText : G.fruitsText} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <GardenText variant="bodyStrong" numberOfLines={1}>{r.label}</GardenText>
                  <GardenText variant="small" color={G.muted} numberOfLines={1}>{ruleLabel(r.rule)} · prochaine le {formatDateFrench(r.nextDate)}</GardenText>
                </View>
                <GardenText variant="bodyStrong" tabular color={r.kind === 'income' ? G.branchesText : r.kind === 'transfer' ? G.waterText : G.ink}>
                  {r.kind === 'expense' ? '− ' : r.kind === 'income' ? '+ ' : ''}{Math.round(r.amount).toLocaleString('fr-FR')} {currencySymbolFor(r.accountCurrency || 'EUR')}
                </GardenText>
                <Ionicons name="chevron-forward" size={16} color={G.muted} />
              </Pressable>
            ))}
          </GardenCard>
        )}
        <GardenText variant="small" color={G.muted}>Touche une ligne pour la modifier ou l'arrêter.</GardenText>
      </View>
    </GardenPage>
  );
}
