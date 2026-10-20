/**
 * Feuille du bas (dialogue centré sur bureau) : LE moyen d'afficher un détail dans le Jardin (toucher l'arrosoir, une carte,
 * une partie de l'arbre). Règle de la refonte : le détail s'ouvre PAR-DESSUS, il ne s'empile pas
 * en bas d'une longue page.
 *
 * ── LE FOND N'ENVELOPPE PAS LE CONTENU ───────────────────────────────────────────────────────────
 * Le voile sombre est un FRÈRE de la feuille, posé derrière elle, et non son parent : un
 * `Pressable` parent capterait le geste de défilement du ScrollView (défilement qui « marche par
 * endroits », déjà corrigé ailleurs dans l'app).
 */
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import GardenText from './GardenText';
import { GARDEN_COLORS, GARDEN_RADII, GARDEN_SPACE, GARDEN_TOUCH } from '../../lib/garden/theme';
import { useResponsive } from '../../hooks/theme/useResponsive';
import { MAX_W, shadow } from '../../lib/ui/webLayout';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Une ligne sous le titre (le vrai terme, une précision). */
  subtitle?: string;
  children: ReactNode;
  /** Zone épinglée sous le contenu (le bouton qui conclut). */
  footer?: ReactNode;
}

export default function GardenSheet({ visible, onClose, title, subtitle, children, footer }: Props) {
  const insets = useSafeAreaInsets();
  /* BUREAU : une feuille collée en bas d'un écran de 27 pouces n'a pas de sens — même règle que le
     reste de l'app (MAX_W.dialog) : boîte de dialogue centrée, coins arrondis partout. */
  const { isDesktop } = useResponsive();
  return (
    <Modal visible={visible} transparent animationType={isDesktop ? 'fade' : 'slide'} statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: isDesktop ? 'center' : 'flex-end', alignItems: isDesktop ? 'center' : 'stretch', padding: isDesktop ? GARDEN_SPACE.xxl : 0 }}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Fermer"
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(30,58,44,0.35)' }}
        />
        <View
          style={[{
            maxHeight: isDesktop ? '86%' : '88%',
            backgroundColor: GARDEN_COLORS.bg,
            borderTopLeftRadius: GARDEN_RADII.xl + 4,
            borderTopRightRadius: GARDEN_RADII.xl + 4,
            borderBottomLeftRadius: isDesktop ? GARDEN_RADII.xl + 4 : 0,
            borderBottomRightRadius: isDesktop ? GARDEN_RADII.xl + 4 : 0,
            paddingTop: GARDEN_SPACE.sm + 2,
            paddingBottom: isDesktop ? GARDEN_SPACE.xl : Math.max(insets.bottom, GARDEN_SPACE.lg),
            width: isDesktop ? '100%' : undefined,
            maxWidth: isDesktop ? MAX_W.dialog : undefined,
          }, isDesktop ? shadow(3) : null]}
        >
          {isDesktop ? null : <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: GARDEN_COLORS.line }} />}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: GARDEN_SPACE.md, paddingHorizontal: GARDEN_SPACE.xl, paddingTop: GARDEN_SPACE.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <GardenText variant="title">{title}</GardenText>
              {subtitle ? <GardenText variant="small" color={GARDEN_COLORS.muted}>{subtitle}</GardenText> : null}
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              hitSlop={8}
              style={{ width: GARDEN_TOUCH, height: GARDEN_TOUCH, borderRadius: GARDEN_TOUCH / 2, backgroundColor: GARDEN_COLORS.card, alignItems: 'center', justifyContent: 'center' }}
            >
              <Svg width={16} height={16} viewBox="0 0 24 24">
                <Path d="M6 6l12 12M18 6 6 18" stroke={GARDEN_COLORS.inkSoft} strokeWidth={2.6} strokeLinecap="round" />
              </Svg>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: GARDEN_SPACE.xl, paddingTop: GARDEN_SPACE.lg, gap: GARDEN_SPACE.md }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: GARDEN_SPACE.xl }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}
