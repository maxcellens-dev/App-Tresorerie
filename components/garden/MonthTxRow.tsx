/**
 * Une opération du mois, dans les feuilles du suivi (« Dépensé », « À venir ») : pastille d'icône
 * de catégorie, libellé, précision, montant signé. Toute la ligne est la cible.
 *
 * Partagé par les deux feuilles pour qu'une même opération se lise pareil, qu'elle soit passée ou
 * à venir.
 */
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GardenText from './GardenText';
import GardenIcon from './GardenIcon';
import { GARDEN_COLORS as G, GARDEN_SPACE } from '../../lib/garden/theme';
import { iconForCategory } from '../../lib/ui/categoryIcons';
import { currencySymbolFor } from '../../lib/finance/currency';
import { formatEuros } from '../../lib/garden/picoChoices';
import { pointer, transition } from '../../lib/ui/webLayout';

/** Libellé d'une opération : sa note, sinon sa catégorie. */
export function txLabel(t: any): string {
  return String(t?.note || t?.description || t?.category?.name || 'Opération').trim();
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « Aujourd'hui », « Hier », « Demain », sinon « mardi 14 octobre ». */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === -1) return 'Hier';
  if (diff === 1) return 'Demain';
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Montant signé, dans la devise du compte de l'opération. */
export function signedAmount(n: number, positive: boolean, currency?: string | null): string {
  return `${positive ? '+' : '−'} ${formatEuros(n, currencySymbolFor(currency || 'EUR'))}`;
}

interface Props {
  t: any;
  /** Montant POSITIF à afficher (peut différer de la ligne : occurrences restantes, devise). */
  amount: number;
  /** Rentrée / remboursement (vert, « + ») plutôt que sortie. */
  positive: boolean;
  /** Ligne de précision sous le libellé (catégorie, « récurrente », compte…). */
  sub?: string;
  /** Vignette de date à gauche (liste « À venir ») à la place de l'icône de catégorie. */
  dateBadge?: string;
  first?: boolean;
  onPress?: () => void;
}

export default function MonthTxRow({ t, amount, positive, sub, dateBadge, first, onPress }: Props) {
  const color = positive ? G.branchesText : G.fruitsText;
  const bg = positive ? G.branchesBg : G.fruitsBg;
  const label = txLabel(t);
  const currency = t?.account?.currency ?? null;
  const content = (
    <>
      {dateBadge ? (
        <View style={{ width: 42, alignItems: 'center', justifyContent: 'center', paddingVertical: 4, borderRadius: 12, backgroundColor: G.field }}>
          <GardenText variant="bodyStrong" tabular style={{ lineHeight: 18 }}>{new Date(dateBadge + 'T00:00:00').getDate()}</GardenText>
          <GardenText variant="small" color={G.muted} style={{ fontSize: 10.5, lineHeight: 13 }}>{WEEKDAYS[new Date(dateBadge + 'T00:00:00').getDay()].slice(0, 3)}.</GardenText>
        </View>
      ) : (
        <GardenIcon icon={iconForCategory(t?.category)} fg={color} bg={bg} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <GardenText variant="bodyStrong" numberOfLines={1}>{label}</GardenText>
        {sub ? <GardenText variant="small" color={G.muted} numberOfLines={1}>{sub}</GardenText> : null}
      </View>
      <GardenText variant="bodyStrong" tabular color={color}>{signedAmount(amount, positive, currency)}</GardenText>
      {onPress ? <Ionicons name="chevron-forward" size={15} color={G.muted} /> : null}
    </>
  );
  const base = [
    { flexDirection: 'row' as const, alignItems: 'center' as const, gap: GARDEN_SPACE.md, minHeight: 58, paddingHorizontal: GARDEN_SPACE.lg, paddingVertical: 9 },
    first ? null : { borderTopWidth: 1, borderTopColor: G.line },
  ];
  if (!onPress) return <View style={base}>{content}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}, ${signedAmount(amount, positive, currency)}`}
      style={({ pressed, hovered }: any) => [...base, (pressed || hovered) ? { backgroundColor: G.field } : null, pointer, transition]}>
      {content}
    </Pressable>
  );
}

/** Carte qui regroupe des lignes (même cadre que GardenRowGroup). */
export function MonthTxCard({ children }: { children: ReactNode }) {
  return (
    <View style={{ backgroundColor: G.card, borderRadius: 24, borderWidth: 1, borderColor: G.line, overflow: 'hidden' }}>
      {children}
    </View>
  );
}
