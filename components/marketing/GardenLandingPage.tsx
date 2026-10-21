/**
 * VITRINE DU JARDIN — la page d'accueil publique (web) refaite pour la nouvelle dynamique de l'app :
 * l'arbre qui pousse, l'arrosoir, Pico.
 *
 * Rien n'est promis que l'app ne fasse : Relyka ne déplace jamais d'argent, il conseille (les
 * choix de Pico) et l'utilisateur fait ses virements dans sa banque. Les dessins sont les VRAIS
 * dessins de l'app (lib/garden/scene3dLayout), sur des situations d'exemple.
 *
 * Ce qui reste réglable en administration (app_config.landing) est repris : nom, lien du store,
 * liens de pied de page, réseaux sociaux, chiffres clés. Les textes de cette version, eux, sont
 * écrits ici.
 */
import { useMemo } from 'react';
import { Image, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import GardenText from '../garden/GardenText';
import GardenScene from '../garden/GardenScene';
import Pico from '../garden/Pico';
import GardenIcon from '../garden/GardenIcon';
import WateringCan from '../garden/WateringCan';
import { CHOICE_LOOKS } from '../../lib/garden/choiceLooks';
import { GARDEN_ICONS, type GardenIconKey } from '../../lib/garden/icons';
import PicoBubble from '../garden/PicoBubble';
import PlayStoreBadge from './PlayStoreBadge';
import SocialLinks from './SocialLinks';
import { useGardenFonts } from '../../hooks/garden/useGardenFonts';
import { useLandingConfig, mergeLanding, type LandingLink } from '../../hooks/config/useLandingConfig';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile } from '../../hooks/data/useProfile';
import { computeTreeState, type GardenInputs } from '../../lib/garden/treeState';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';
import { MAX_W, pointer, shadow, transition } from '../../lib/ui/webLayout';

/* Situations d'exemple (jamais de vraies données) : une pousse, un jeune arbre, un arbre en fruits. */
const base: GardenInputs = {
  currentBalance: 2000, minimumToKeep: 300, monthlyReference: 2000, securityMonths: 0, relyka: 600,
  investedValue: 0, investedContributed: 0, enjoyThisMonth: 0, recurringSavingsMonthly: 0, recurringInvestMonthly: 0,
  consecutiveSavingMonths: 0, streakWeeks: 0, credits: [],
};
export const HERO = computeTreeState({ ...base, securityMonths: 3.4, investedValue: 9000, investedContributed: 7500, investmentCount: 3, enjoyThisMonth: 250, recurringSavingsMonthly: 150, credits: [{ id: 'm', kind: 'healthy', remaining: 6000, borrowed: 15000 }], relyka: 900 });
const STEPS = [
  computeTreeState({ ...base, securityMonths: 0.3, relyka: 250 }),
  computeTreeState({ ...base, securityMonths: 2, enjoyThisMonth: 120, relyka: 500 }),
  computeTreeState({ ...base, securityMonths: 6.5, investedValue: 30000, investedContributed: 24000, investmentCount: 6, enjoyThisMonth: 300, relyka: 1100 }),
];

/* Icônes et couleurs : lib/garden/icons (les mêmes que dans l'app). */
const PARTS: { kind: GardenIconKey; name: string; meaning: string; text: string }[] = [
  { kind: 'water', name: 'Arrosoir', meaning: 'Comptes courants', text: "L'eau qu'il te reste à utiliser ce mois-ci, une fois tes dépenses prévues." },
  { kind: 'roots', name: 'Racines', meaning: 'Épargne de secours', text: 'Elles descendent vers 1, 3 puis 6 mois de dépenses mis de côté.' },
  { kind: 'fruits', name: 'Fruits', meaning: 'Placements', text: 'Un fruit par placement. Ils mûrissent quand tes placements rapportent.' },
  { kind: 'flowers', name: 'Fleurs', meaning: 'Pour te faire plaisir', text: "La part de ton mois à dépenser pour toi, sans culpabiliser." },
  { kind: 'cabin', name: 'Cabane', meaning: 'Crédit', text: 'Une planche de plus à chaque mensualité, jusqu’à ce qu’elle soit à toi.' },
];

/* Ce que chaque geste fait POUSSER (section « Chaque mois, tu arroses ton jardin »). */
const WATERING_TEXT: Record<'save' | 'invest' | 'enjoy' | 'keep', string> = {
  save: 'Tes racines s’enfoncent : l’épargne qui te protège d’un coup dur, vers 1, 3 puis 6 mois de dépenses.',
  invest: 'Tes fruits grossissent : l’argent placé qui travaille pour toi, et mûrit quand il rapporte.',
  enjoy: 'Ton jardin fleurit : la part du mois pour te faire plaisir, sans culpabiliser.',
  keep: 'Un peu d’eau reste au frais : sur ton compte courant, pour la suite du mois.',
};

const HOW: { n: string; title: string; text: string }[] = [
  { n: '1', title: 'Plante ton arbre', text: 'Ajoute tes comptes et tes opérations récurrentes : salaire, loyer, abonnements.' },
  { n: '2', title: 'Regarde ton arrosoir', text: 'Relyka calcule l’eau qu’il te reste vraiment ce mois-ci, sans toucher à ta réserve minimum.' },
  { n: '3', title: 'Arrose avec Pépin', text: 'Racines, fruits, fleurs : Pépin te dit où verser ton eau. Tu fais les virements dans ta banque, ton arbre pousse.' },
];

export default function GardenLandingPage() {
  const router = useRouter();
  const fontsReady = useGardenFonts();
  const { width } = useWindowDimensions();
  const wide = width >= 980;
  const narrow = width < 480;
  const { data: loaded } = useLandingConfig();
  const cfg = useMemo(() => mergeLanding(loaded), [loaded]);
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const go = (to: string) => router.push(to as any);
  const goLink = (link: LandingLink) => {
    if (link.url) { if (Platform.OS === 'web' && /^https?:\/\//i.test(link.url)) window.open(link.url, '_blank', 'noopener,noreferrer'); return; }
    if (link.anchor && ['login', 'register', 'confidentialite', 'legal'].includes(link.anchor)) { go(`/${link.anchor}`); return; }
    if (Platform.OS === 'web' && link.anchor) document.getElementById(link.anchor)?.scrollIntoView({ behavior: 'smooth' });
  };
  if (!fontsReady) return <View style={{ flex: 1, backgroundColor: G.bg }} />;

  const col = { width: '100%', maxWidth: MAX_W.dashboard, alignSelf: 'center', paddingHorizontal: narrow ? 16 : 24 } as const;
  const primaryBtn = (label: string, big = false) => (
    <Pressable onPress={() => go('/register')} accessibilityRole="link"
      style={({ hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: big ? 56 : 46, paddingHorizontal: big ? 26 : 18, borderRadius: GARDEN_RADII.pill, backgroundColor: hovered ? G.primaryPressed : G.primary }, pointer, transition, hovered ? shadow(2) : null]}>
      <GardenText variant="bodyStrong" color={G.onPrimary}>{label}</GardenText>
      <Ionicons name="arrow-forward" size={18} color={G.onPrimary} />
    </Pressable>
  );
  const secondaryBtn = (label: string, big = false) => (
    <Pressable onPress={() => go('/login')} accessibilityRole="link"
      style={({ hovered }: any) => [{ alignItems: 'center', justifyContent: 'center', minHeight: big ? 56 : 46, paddingHorizontal: big ? 24 : 16, borderRadius: GARDEN_RADII.pill, borderWidth: 1, borderColor: G.line, backgroundColor: hovered ? G.field : G.card }, pointer, transition]}>
      <GardenText variant="bodyStrong" color={G.primary}>{label}</GardenText>
    </Pressable>
  );
  const brand = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Image source={require('../../assets/logo.png')} style={{ width: 34, height: 34 }} resizeMode="contain" />
      <GardenText variant="heading" color={G.ink}>{cfg.brandName}</GardenText>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: G.bg }}>
      <StatusBar style="dark" />
      {/* En-tête */}
      <View style={{ backgroundColor: G.bg, borderBottomWidth: 1, borderBottomColor: G.line }}>
        <View style={[col, { height: 68, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
          {brand}
          <View style={{ flex: 1 }} />
          {secondaryBtn('Se connecter')}
          {wide ? primaryBtn('Commencer') : null}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }}>
        {/* ── Héros : la promesse + le vrai dessin ── */}
        <View style={[col, { paddingTop: wide ? 64 : 28, paddingBottom: wide ? 64 : 36, flexDirection: wide ? 'row' : 'column', alignItems: 'center', gap: wide ? 56 : 28 }]}>
          <View style={{ flex: wide ? 1 : undefined, gap: 18, maxWidth: 560 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: GARDEN_RADII.pill, backgroundColor: G.branchesBg }}>
              <Ionicons name="leaf" size={14} color={G.branchesText} />
              <GardenText variant="smallStrong" color={G.branchesText}>Ton argent, comme un jardin</GardenText>
            </View>
            <GardenText variant="display" style={{ fontSize: narrow ? 38 : 54, lineHeight: narrow ? 44 : 60 }} accessibilityRole="header">Regarde ton argent pousser.</GardenText>
            <GardenText variant="body" color={G.inkSoft} style={{ fontSize: narrow ? 17 : 19, lineHeight: narrow ? 26 : 29 }}>
              Relyka transforme tes comptes en un arbre vivant. Il grandit quand tu mets de côté, ses fruits mûrissent quand tes placements rapportent. Et chaque mois, Pépin te dit quoi faire de ce qu’il te reste.
            </GardenText>
            <View style={{ flexDirection: narrow ? 'column' : 'row', gap: 12, flexWrap: 'wrap' }}>
              {primaryBtn('Planter mon arbre', true)}
              {secondaryBtn("J'ai déjà un compte", true)}
            </View>
            <PlayStoreBadge url={cfg.androidStoreUrl} />
          </View>
          <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : '100%', maxWidth: 520, gap: 12 }}>
            <GardenScene state={HERO} options={{ id: 'vitrine', glow: true, mood: 'joy', label: 'Un arbre en fruits, ses racines, son arrosoir et Pépin le hérisson' }} />
            <PicoBubble>Ce mois-ci, mets 300 € de côté pour tes racines. Le reste, profite !</PicoBubble>
          </View>
        </View>

        {/* ── Le jardin se lit d'un coup d'œil ── */}
        <View nativeID="features" style={{ backgroundColor: G.card, borderTopWidth: 1, borderBottomWidth: 1, borderColor: G.line }}>
          <View style={[col, { paddingVertical: wide ? 72 : 44, gap: 28 }]}>
            <View style={{ gap: 10, maxWidth: 680 }}>
              <GardenText variant="label" color={G.primary}>Ton argent en un coup d'œil</GardenText>
              <GardenText variant="display" style={{ fontSize: narrow ? 30 : 38, lineHeight: narrow ? 36 : 44 }}>Chaque partie de l'arbre, c'est un vrai bout de ton argent.</GardenText>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
              {PARTS.map((p) => (
                <View key={p.name} style={{ flexGrow: 1, flexBasis: wide ? '18%' : narrow ? '100%' : '45%', minWidth: 200, gap: 10, padding: 18, borderRadius: GARDEN_RADII.lg, backgroundColor: GARDEN_ICONS[p.kind].bg }}>
                  <GardenIcon kind={p.kind} bg={G.card} size={44} />
                  <View>
                    <GardenText variant="heading" color={GARDEN_ICONS[p.kind].fg}>{p.name}</GardenText>
                    <GardenText variant="smallStrong" color={G.inkSoft}>{p.meaning}</GardenText>
                  </View>
                  <GardenText variant="body" color={G.ink}>{p.text}</GardenText>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── L'arrosage : la métaphore qui porte toute l'app. Le Relyka, c'est l'eau de l'arrosoir ;
            chaque mois, on choisit où la verser — les quatre gestes de Pépin, mêmes mots et mêmes
            couleurs que dans l'app (CHOICE_LOOKS). ── */}
        <View nativeID="watering" style={[col, { paddingVertical: wide ? 72 : 44, gap: 28 }]}>
          <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'stretch', gap: wide ? 48 : 24 }}>
            <View style={{ flex: wide ? 1 : undefined, gap: 10, maxWidth: 560 }}>
              <GardenText variant="label" color={G.primary}>Chaque mois, tu arroses ton jardin</GardenText>
              <GardenText variant="display" style={{ fontSize: narrow ? 30 : 38, lineHeight: narrow ? 36 : 44 }}>Ton Relyka, c'est l'eau de ton arrosoir.</GardenText>
              <GardenText variant="body" color={G.inkSoft}>
                C'est ce qu'il te reste vraiment à utiliser ce mois-ci, une fois tes dépenses prévues et ta réserve gardée. L'arrosoir se remplit quand ton salaire tombe, baisse au fil de tes dépenses, et c'est toi qui choisis où verser l'eau.
              </GardenText>
              <GardenText variant="small" color={G.muted}>Un mois serré, c'est juste un peu moins d'eau : ton arbre ne tombe jamais malade.</GardenText>
            </View>
            <View style={{ flex: wide ? 1 : undefined, flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: narrow ? 10 : 20 }}>
              {([[0.15, 'Un mois serré'], [0.55, 'Un mois normal'], [0.95, 'Un mois large']] as [number, string][]).map(([lv, t]) => (
                <View key={t} style={{ alignItems: 'center', gap: 6 }}>
                  <WateringCan level={lv} width={narrow ? 92 : 130} accessibilityLabel={`${t} : arrosoir rempli à ${Math.round(lv * 100)} %`} />
                  <GardenText variant="smallStrong" color={G.inkSoft} center>{t}</GardenText>
                </View>
              ))}
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            {(['save', 'invest', 'enjoy', 'keep'] as const).map((k) => {
              const look = CHOICE_LOOKS[k];
              return (
                <View key={k} style={{ flexGrow: 1, flexBasis: wide ? '22%' : narrow ? '100%' : '45%', minWidth: 200, gap: 10, padding: 18, borderRadius: GARDEN_RADII.lg, backgroundColor: look.bg }}>
                  <GardenIcon icon={look.icon} fg={look.fg} bg={G.card} size={44} />
                  <View>
                    <GardenText variant="heading" color={look.fg}>{look.verb}</GardenText>
                    <GardenText variant="smallStrong" color={G.inkSoft}>{look.meaning}</GardenText>
                  </View>
                  <GardenText variant="body" color={G.ink}>{WATERING_TEXT[k]}</GardenText>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Comment ça marche ── */}
        <View nativeID="how" style={[col, { paddingVertical: wide ? 72 : 44, gap: 28 }]}>
          <View style={{ gap: 10, maxWidth: 680 }}>
            <GardenText variant="label" color={G.primary}>Comment ça marche</GardenText>
            <GardenText variant="display" style={{ fontSize: narrow ? 30 : 38, lineHeight: narrow ? 36 : 44 }}>Trois gestes, et ton jardin vit tout seul.</GardenText>
          </View>
          <View style={{ flexDirection: wide ? 'row' : 'column', gap: 16 }}>
            {HOW.map((h) => (
              <View key={h.n} style={{ flex: wide ? 1 : undefined, gap: 12, padding: 22, borderRadius: GARDEN_RADII.lg, backgroundColor: G.card, borderWidth: 1, borderColor: G.line }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: G.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <GardenText variant="heading" color={G.onPrimary}>{h.n}</GardenText>
                </View>
                <GardenText variant="title">{h.title}</GardenText>
                <GardenText variant="body" color={G.inkSoft}>{h.text}</GardenText>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderRadius: GARDEN_RADII.lg, backgroundColor: G.branchesBg }}>
            <Ionicons name="shield-checkmark-outline" size={24} color={G.branchesText} />
            <GardenText variant="bodyStrong" color={G.branchesText} style={{ flex: 1 }}>Relyka ne déplace jamais ton argent : il te conseille, c’est toi qui décides.</GardenText>
          </View>
        </View>

        {/* ── Ton arbre grandit avec toi ── */}
        <View style={{ backgroundColor: G.sky }}>
          <View style={[col, { paddingVertical: wide ? 72 : 44, gap: 28 }]}>
            <View style={{ gap: 10, maxWidth: 680 }}>
              <GardenText variant="label" color={G.primary}>Ton arbre grandit avec toi</GardenText>
              <GardenText variant="display" style={{ fontSize: narrow ? 30 : 38, lineHeight: narrow ? 36 : 44 }}>D'une petite pousse à un arbre plein de fruits.</GardenText>
              <GardenText variant="body" color={G.inkSoft}>Et il ne tombe jamais malade : un mois serré, c’est juste un peu moins d’eau dans l’arrosoir.</GardenText>
            </View>
            <View style={{ flexDirection: wide ? 'row' : 'column', gap: 16 }}>
              {STEPS.map((st, i) => (
                <View key={i} style={{ flex: wide ? 1 : undefined, gap: 10 }}>
                  <GardenScene state={st} options={{ id: `step${i}`, marks: true }} />
                  <GardenText variant="bodyStrong" center>{['Tu commences', 'Tes racines s’ancrent', 'Tes fruits mûrissent'][i]}</GardenText>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── Chiffres clés (réglés en administration) ── */}
        {cfg.stats.length ? (
          <View style={[col, { paddingVertical: 44, flexDirection: 'row', flexWrap: 'wrap', gap: 16 }]}>
            {cfg.stats.map((stat, i) => (
              <View key={i} style={{ flexGrow: 1, flexBasis: narrow ? '100%' : '22%', padding: 18, borderRadius: GARDEN_RADII.lg, backgroundColor: G.card, borderWidth: 1, borderColor: G.line, gap: 4 }}>
                <GardenText variant="title" color={G.primary}>{stat.value}</GardenText>
                <GardenText variant="small" color={G.inkSoft}>{stat.label}</GardenText>
              </View>
            ))}
          </View>
        ) : null}

        {/* ── Dernier appel ── */}
        <View nativeID="final" style={[col, { paddingVertical: wide ? 64 : 40 }]}>
          <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: 'center', gap: 24, padding: wide ? 44 : 24, borderRadius: GARDEN_RADII.xl, backgroundColor: G.primary }}>
            <Pico size={wide ? 130 : 96} mood="joy" />
            <View style={{ flex: wide ? 1 : undefined, gap: 14, alignItems: wide ? 'flex-start' : 'center' }}>
              <GardenText variant="display" color={G.onPrimary} center={!wide} style={{ fontSize: narrow ? 28 : 36, lineHeight: narrow ? 34 : 42 }}>Ton jardin t’attend.</GardenText>
              <GardenText variant="body" color={G.onPrimary} center={!wide} style={{ opacity: 0.9 }}>Gratuit pour commencer. Quelques minutes pour planter ton arbre.</GardenText>
              <Pressable onPress={() => go('/register')} accessibilityRole="link"
                style={({ hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 54, paddingHorizontal: 26, borderRadius: GARDEN_RADII.pill, backgroundColor: hovered ? G.field : G.card }, pointer, transition]}>
                <GardenText variant="bodyStrong" color={G.primary}>Planter mon arbre</GardenText>
                <Ionicons name="arrow-forward" size={18} color={G.primary} />
              </Pressable>
            </View>
          </View>
        </View>

        {/* ── Pied de page (liens et réseaux réglés en administration) ── */}
        <View style={{ borderTopWidth: 1, borderTopColor: G.line }}>
          <View style={[col, { paddingVertical: 32, gap: 18 }]}>
            <View style={{ flexDirection: wide ? 'row' : 'column', justifyContent: 'space-between', gap: 18 }}>
              <View style={{ gap: 10 }}>{brand}<GardenText variant="small" color={G.muted}>{cfg.footerText}</GardenText></View>
              <View style={{ gap: 12, alignItems: wide ? 'flex-end' : 'flex-start' }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }}>
                  {cfg.footerLinks.map((link, i) => (
                    <Pressable key={i} onPress={() => goLink(link)} accessibilityRole="link" style={pointer}>
                      <GardenText variant="smallStrong" color={G.inkSoft}>{link.label}</GardenText>
                    </Pressable>
                  ))}
                </View>
                <SocialLinks config={cfg.socials} color={G.muted} />
              </View>
            </View>
            <GardenText variant="small" color={G.muted}>© {new Date().getFullYear()} {cfg.brandName}. Tous droits réservés.</GardenText>
          </View>
        </View>
      </ScrollView>

      {profile?.is_admin ? (
        <Pressable onPress={() => go('/(tabs)/(secondary)/admin/landing')} accessibilityRole="button" accessibilityLabel="Éditer la page d’accueil"
          style={[{ position: 'absolute', right: 20, bottom: 20, width: 52, height: 52, borderRadius: 26, backgroundColor: G.ink, alignItems: 'center', justifyContent: 'center' }, pointer]}>
          <Ionicons name="create-outline" size={20} color="#fff" />
        </Pressable>
      ) : null}
    </View>
  );
}
