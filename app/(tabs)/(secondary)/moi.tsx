/**
 * MON PROFIL (Jardin) — ouvert depuis l'avatar. Même contenu que le menu de profil actuel
 * (ProfileMenuModal), en plus lisible : ta carte d'identité (photo, nom, étiquettes Admin /
 * Premium / titre), trois groupes courts en listes groupées, puis la déconnexion.
 *
 * Moins d'entrées qu'une page par réglage : « Mes catégories » et « Mes données » se trouvent dans
 * Réglages et Mon compte, « Une idée ? » dans l'Aide — comme dans le menu actuel. Chaque ligne mène
 * à la page existante (`navigate` : on revient sur une page, on n'en empile pas une copie).
 */
import { Image, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import GardenPage from '../../../components/garden/GardenPage';
import GardenText from '../../../components/garden/GardenText';
import GardenList, { type GardenListItem } from '../../../components/garden/GardenList';
import GardenPill from '../../../components/garden/GardenPill';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile } from '../../../hooks/data/useProfile';
import { usePlan } from '../../../hooks/config/usePlan';
import { useUserUnreadCount } from '../../../hooks/admin/useUnreadBadges';
import { useCosmetics } from '../../../hooks/theme/useCosmetics';
import { APP_VERSION } from '../../../lib/platform/appVersion';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../../lib/garden/theme';
import { WORDS } from '../../../lib/garden/lexicon';
import { MAX_W, pointer } from '../../../lib/ui/webLayout';

export default function MoiScreen() {
  const router = useRouter();
  const goBack = useNavBack();
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { isPremium, premiumEnabled } = usePlan(user?.id);
  const supportUnread = useUserUnreadCount(user?.id);
  const { avatarFrameColor, profileTitle } = useCosmetics(user?.id);
  const isAdmin = (profile as any)?.is_admin === true;
  const avatarUrl = (profile as any)?.avatar_url ?? undefined;
  const name = (profile as any)?.full_name || (user as any)?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Utilisateur';
  const go = (route: string) => router.navigate(route as any);
  const row = (key: string, label: string, icon: string, color: string, bg: string, route: string, extra: Partial<GardenListItem> = {}): GardenListItem => ({ key, label, icon, color, bg, onPress: () => go(route), ...extra });

  const garden: GardenListItem[] = [
    row('parcours', WORDS.myJourney, 'leaf-outline', G.branchesText, G.branchesBg, '/(tabs)/(secondary)/parcours'),
    row('succes', WORDS.successes, 'ribbon-outline', G.picoText, G.pico, '/(tabs)/(secondary)/succes'),
    row('boutique', WORDS.shop, 'bag-handle-outline', G.waterText, G.waterBg, '/(tabs)/(secondary)/boutique'),
  ];
  const settings: GardenListItem[] = [
    row('apparence', WORDS.appearance, 'color-palette-outline', G.flowersText, G.flowersBg, '/(tabs)/(secondary)/apparence'),
    row('budgets', 'Budgets', 'pie-chart-outline', G.fruitsText, G.fruitsBg, '/(tabs)/projects'),
    ...(premiumEnabled ? [row('premium', 'Premium', 'star-outline', G.noticeText, G.notice, '/(tabs)/(secondary)/premium', { value: isPremium ? 'actif' : undefined })] : []),
    row('parametres', WORDS.settings, 'options-outline', G.inkSoft, G.field, '/(tabs)/(secondary)/parametres'),
  ];
  const account: GardenListItem[] = [
    row('profile', 'Mon compte', 'person-outline', G.inkSoft, G.field, '/(tabs)/(secondary)/profile'),
    row('support', 'Aide', 'help-buoy-outline', G.branchesText, G.branchesBg, '/(tabs)/(secondary)/support', { badge: supportUnread }),
    ...(isAdmin ? [row('admin', 'Admin', 'shield-checkmark-outline', G.primary, G.branchesBg, '/(tabs)/(secondary)/admin')] : []),
  ];

  const identity = (
    <Pressable onPress={() => go('/(tabs)/(secondary)/profile')} accessibilityRole="button" accessibilityLabel={`${name}, modifier mon profil`}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, padding: GARDEN_SPACE.lg, borderRadius: GARDEN_RADII.lg, backgroundColor: G.card, borderWidth: 1, borderColor: G.line }, pointer]}>
      <View style={{ width: 60, height: 60, borderRadius: 30, borderWidth: 3, borderColor: avatarFrameColor || G.branches, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: G.branchesBg }}>
        {avatarUrl ? <Image source={{ uri: avatarUrl }} style={{ width: 54, height: 54, borderRadius: 27 }} accessibilityIgnoresInvertColors /> : <GardenText variant="title" color={G.branchesText}>{String(name).charAt(0).toUpperCase()}</GardenText>}
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <GardenText variant="heading" numberOfLines={1}>{name}</GardenText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {isAdmin ? <GardenPill label="Admin" bg={G.branchesBg} color={G.branchesText} /> : null}
          {isPremium ? <GardenPill label="Premium" bg={G.notice} color={G.noticeText} /> : null}
          {profileTitle ? <GardenPill label={profileTitle} bg={G.pico} color={G.picoText} /> : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={G.muted} />
    </Pressable>
  );

  const logout = (
    <Pressable onPress={() => signOut()} accessibilityRole="button" accessibilityLabel="Se déconnecter"
      style={({ pressed, hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52, borderRadius: GARDEN_RADII.lg, borderWidth: 1, borderColor: G.line, backgroundColor: pressed || hovered ? G.field : G.card }, pointer]}>
      <Ionicons name="log-out-outline" size={18} color={G.ink} />
      <GardenText variant="bodyStrong">Se déconnecter</GardenText>
    </Pressable>
  );

  return (
    <GardenPage secondary header={<ScreenHeader title="Mon profil" onBack={goBack} />}>
      {/* Une seule colonne, même sur bureau : un menu se lit de haut en bas (centré, largeur de formulaire). */}
      <View style={{ width: '100%', maxWidth: MAX_W.dialog, alignSelf: 'center', gap: GARDEN_SPACE.md }}>
        {identity}
        <GardenList title="Mon jardin" items={garden} />
        <GardenList title="Réglages" items={settings} />
        <GardenList title="Compte" items={account} />
        {logout}
        <GardenText variant="small" color={G.muted} center>Relyka · version {APP_VERSION}</GardenText>
      </View>
    </GardenPage>
  );
}
