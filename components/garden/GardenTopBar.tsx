/**
 * Barre du haut du Jardin — TOUJOURS visible, comme l'entête de l'app actuelle : on doit pouvoir
 * ouvrir le menu de profil depuis n'importe quelle page.
 *
 * - Onglets du Jardin (`main`) : le nom de l'onglet à gauche, ton avatar à droite.
 * - Toute autre page : un retour, le NOM DE LA PAGE (déclaré par son ScreenHeader, cf. headerTitle),
 *   l'avatar. Le grand titre sous la barre a disparu : place gagnée.
 *
 * Les pages qui portent leur propre en-tête (ScreenHeader) n'y affichent plus de « Retour » en mode
 * Jardin : c'est cette barre qui le porte, une seule fois.
 */
import { Image, Pressable, View } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useHeaderTitle } from '../../lib/garden/headerTitle';
import { useGamification } from '../../hooks/engagement/useGamification';
import GardenPill from './GardenPill';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import GardenText from './GardenText';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile } from '../../hooks/data/useProfile';
import { useNavBack } from '../../hooks/platform/useNavBack';
import { useGardenFonts } from '../../hooks/garden/useGardenFonts';
import { GARDEN_COLORS, GARDEN_SPACE, GARDEN_TOUCH } from '../../lib/garden/theme';
import { pointer } from '../../lib/ui/webLayout';

interface Props {
  title?: string;
  /** Natif : la barre ajoute la marge de la barre d'état. Bureau web : pas de barre d'état. */
  applyTopInset?: boolean;
  /** Onglet principal du Jardin : pas de retour, la marque à gauche. */
  main?: boolean;
}

export default function GardenTopBar({ title, applyTopInset = true, main }: Props) {
  const router = useRouter();
  const goBack = useNavBack();
  const insets = useSafeAreaInsets();
  const fontsReady = useGardenFonts();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const path = usePathname();
  const declared = useHeaderTitle(path);
  // Onglets : leur nom fixe ; autres pages : le titre déclaré par la page elle-même.
  const shown = main ? title : declared ?? title;
  // Série (anneaux du tronc) : visible partout, comme dans l'entête actuel ; mène aux Succès.
  const streak = useGamification(user?.id).state?.streak ?? 0;
  const avatarUrl = (profile as any)?.avatar_url as string | undefined;
  const name = (profile as any)?.full_name || (user as any)?.user_metadata?.full_name || user?.email || '?';
  const round = { width: GARDEN_TOUCH, height: GARDEN_TOUCH, borderRadius: GARDEN_TOUCH / 2, backgroundColor: GARDEN_COLORS.card, borderWidth: 1, borderColor: GARDEN_COLORS.line, alignItems: 'center' as const, justifyContent: 'center' as const, overflow: 'hidden' as const };

  return (
    // `glow` : en sombre, la barre porte la teinte d'où part le halo de la page (GardenGlow) — pas de couture.
    <View style={{ paddingTop: applyTopInset ? insets.top : 0, backgroundColor: GARDEN_COLORS.glow }}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.sm, paddingHorizontal: GARDEN_SPACE.lg }}>
        {main ? null : (
          <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Retour" hitSlop={6} style={[round, pointer]}>
            <Svg width={18} height={18} viewBox="0 0 24 24"><Path d="m15 6-6 6 6 6" stroke={GARDEN_COLORS.ink} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>
          </Pressable>
        )}
        {/* minWidth 0 + maxWidth : sans eux, un titre long déborde sous la pastille au lieu de s'abréger. */}
        <View style={{ flex: 1, minWidth: 0 }}>
          {/* Le titre ramène au Jardin, comme le titre de l'entête ramenait au Pilotage. */}
          {fontsReady && shown ? (
            <Pressable onPress={() => router.navigate('/(tabs)/jardin' as any)} accessibilityRole="link" accessibilityLabel={`${shown}, aller au Jardin`} style={[{ alignSelf: 'flex-start', maxWidth: '100%' }, pointer]}>
              <GardenText variant={main ? 'title' : 'heading'} numberOfLines={1} accessibilityRole="header">{shown}</GardenText>
            </Pressable>
          ) : null}
        </View>
        {fontsReady ? (
          <Pressable onPress={() => router.push('/(tabs)/(secondary)/succes' as any)} accessibilityRole="button" accessibilityLabel={`Série : ${streak} semaines. Voir mes succès`} hitSlop={6} style={pointer}>
            <GardenPill label={`${streak} sem.`} bg={GARDEN_COLORS.pico} color={GARDEN_COLORS.picoText} dot="#C9A57E" />
          </Pressable>
        ) : null}
        <Pressable onPress={() => router.push('/(tabs)/(secondary)/moi' as any)} accessibilityRole="button" accessibilityLabel="Mon profil" hitSlop={6} style={[round, { borderWidth: 2, borderColor: GARDEN_COLORS.branches }, pointer]}>
          {avatarUrl
            ? <Image source={{ uri: avatarUrl }} style={{ width: GARDEN_TOUCH, height: GARDEN_TOUCH }} accessibilityIgnoresInvertColors />
            : fontsReady ? <GardenText variant="bodyStrong" color={GARDEN_COLORS.branchesText}>{String(name).charAt(0).toUpperCase()}</GardenText> : null}
        </Pressable>
      </View>
    </View>
  );
}
