import type { ReactNode } from 'react';
/**
 * Liste groupée du Jardin : UNE carte par groupe, des lignes séparées par un filet. C'est la forme
 * des menus et réglages — une carte par ligne éparpillait l'écran et multipliait les « boutons ».
 *
 * Chaque ligne : une icône dans la pastille commune (GardenIcon : ronde, 36 px, couleur de sa partie), un libellé, une valeur ou un badge
 * facultatifs, un chevron. Toute la ligne est la cible (≥ 52 px).
 */
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GardenText from './GardenText';
import GardenIcon from './GardenIcon';
import { GARDEN_COLORS, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';
import { pointer, transition } from '../../lib/ui/webLayout';

export interface GardenListItem {
  key: string;
  label: string;
  /** Nom d'icône Ionicons. */
  icon: string;
  /** Couleur de l'icône et fond doux de sa pastille. */
  color: string;
  bg: string;
  value?: string;
  badge?: number;
  /** Fonction Premium : une petite étoile avant le chevron. */
  premium?: boolean;
  onPress: () => void;
}

export default function GardenList({ title, items }: { title?: string; items: GardenListItem[] }) {
  return (
    <View style={{ gap: GARDEN_SPACE.sm }}>
      {title ? <GardenText variant="label" style={{ paddingHorizontal: 4 }}>{title}</GardenText> : null}
      <View style={{ backgroundColor: GARDEN_COLORS.card, borderRadius: GARDEN_RADII.lg, borderWidth: 1, borderColor: GARDEN_COLORS.line, overflow: 'hidden', shadowColor: '#1E3A2C', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 }}>
        {items.map((it, i) => (
          <Pressable
            key={it.key}
            onPress={it.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${it.label}${it.premium ? ' (Premium)' : ''}${it.badge ? `, ${it.badge} non lu${it.badge > 1 ? 's' : ''}` : ''}`}
            style={({ pressed, hovered }: any) => [
              { flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, minHeight: 52, paddingHorizontal: GARDEN_SPACE.lg, paddingVertical: 10 },
              i > 0 ? { borderTopWidth: 1, borderTopColor: GARDEN_COLORS.line } : null,
              (pressed || hovered) ? { backgroundColor: GARDEN_COLORS.field } : null,
              pointer, transition,
            ]}
          >
            <GardenIcon icon={it.icon} fg={it.color} bg={it.bg} />
            <GardenText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{it.label}</GardenText>
            {it.value ? <GardenText variant="small" color={GARDEN_COLORS.muted}>{it.value}</GardenText> : null}
            {it.badge ? (
              <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: GARDEN_COLORS.flowersText, alignItems: 'center', justifyContent: 'center' }}>
                <GardenText variant="smallStrong" color="#FFFFFF" style={{ fontSize: 11 }}>{it.badge > 99 ? '99+' : it.badge}</GardenText>
              </View>
            ) : null}
            {it.premium ? <Ionicons name="star" size={15} color={GARDEN_COLORS.noticeText} /> : null}
            <Ionicons name="chevron-forward" size={16} color={GARDEN_COLORS.muted} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export interface GardenRow {
  key: string;
  label: string;
  sub?: string;
  value?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Icône ronde à gauche (Ionicons) — repère du type de compte, comme l'ancienne page Comptes. */
  icon?: string;
  iconColor?: string;
  iconBg?: string;
  /** Libellé en italique : un compte partagé, rangé avec les miens mais reconnaissable. */
  italic?: boolean;
  /** Fond de la ligne : une ligne de TOTAL (sans icône), à ne pas confondre avec un compte. */
  bg?: string;
  /** Montant en retrait (gris, sans gras) : un compte qui n'entre pas dans ton total. */
  valueMuted?: boolean;
  /** À droite, À LA PLACE du montant et de la flèche (ex. les flèches de « Réorganiser »). */
  right?: ReactNode;
}

/**
 * Variante sans icône : un libellé (et sa précision), une valeur à droite. Pour les comptes, les
 * opérations, les crédits — même principe d'UNE carte par groupe que GardenList.
 */
export function GardenRowGroup({ title, titleColor, total, rows }: { title?: string; titleColor?: string; total?: string; rows: GardenRow[] }) {
  return (
    <View style={{ gap: GARDEN_SPACE.sm }}>
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: GARDEN_SPACE.sm, paddingHorizontal: 4 }}>
          <GardenText variant="label" color={titleColor} style={{ flex: 1 }}>{title}</GardenText>
          {total ? <GardenText variant="smallStrong" color={GARDEN_COLORS.inkSoft} tabular>{total}</GardenText> : null}
        </View>
      ) : null}
      <View style={{ backgroundColor: GARDEN_COLORS.card, borderRadius: GARDEN_RADII.lg, borderWidth: 1, borderColor: GARDEN_COLORS.line, overflow: 'hidden', shadowColor: '#1E3A2C', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 }}>
        {rows.map((r, i) => {
          const content = (
            <>
              {r.icon ? (
                <GardenIcon icon={r.icon} fg={r.iconColor ?? GARDEN_COLORS.inkSoft} bg={r.iconBg ?? GARDEN_COLORS.field} />
              ) : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <GardenText variant="bodyStrong" numberOfLines={1} style={r.italic ? { fontStyle: 'italic' } : undefined}>{r.label}</GardenText>
                {r.sub ? <GardenText variant="small" color={GARDEN_COLORS.muted} numberOfLines={1}>{r.sub}</GardenText> : null}
              </View>
              {r.right ?? (<>
              {r.value ? <GardenText variant={r.valueMuted ? "body" : "bodyStrong"} tabular color={r.valueMuted ? GARDEN_COLORS.muted : undefined}>{r.value}</GardenText> : null}
              {r.onPress ? <Ionicons name="chevron-forward" size={16} color={GARDEN_COLORS.muted} /> : null}
              </>)}
            </>
          );
          const base = [{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: GARDEN_SPACE.md, minHeight: 56, paddingHorizontal: GARDEN_SPACE.lg, paddingVertical: 10 }, i > 0 ? { borderTopWidth: 1, borderTopColor: GARDEN_COLORS.line } : null, r.bg ? { backgroundColor: r.bg } : null];
          return r.onPress ? (
            <Pressable key={r.key} onPress={r.onPress} accessibilityRole="button" accessibilityLabel={r.accessibilityLabel ?? `${r.label}${r.value ? `, ${r.value}` : ''}`}
              style={({ pressed, hovered }: any) => [...base, (pressed || hovered) ? { backgroundColor: GARDEN_COLORS.field } : null, pointer, transition]}>
              {content}
            </Pressable>
          ) : <View key={r.key} style={base}>{content}</View>;
        })}
      </View>
    </View>
  );
}
