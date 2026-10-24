/**
 * VITRINE — la page d'accueil publique (web), refaite pour la nouvelle app : la promesse d'abord
 * (« combien tu peux vraiment dépenser »), puis le plan de Pépin, puis le reste de l'app (comptes,
 * parcours, projets, saisie au tap). Plus de jardin ni d'arbre : Pépin reste la voix de l'app.
 *
 * Rien n'est promis que l'app ne fasse : Relyka ne déplace jamais d'argent, il conseille, et
 * l'utilisateur fait ses virements dans sa banque. Les aperçus sont les VRAIS composants de l'app,
 * sur des situations d'exemple (components/marketing/AppPreview).
 *
 * Ce qui reste réglable en administration (app_config.landing) est repris : nom, lien du store,
 * liens de pied de page, réseaux sociaux, chiffres clés. Les textes, eux, sont écrits ici.
 */
import { useMemo } from 'react';
import { Image, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import GardenText from '../garden/GardenText';
import Pico from '../garden/Pico';
import GardenIcon from '../garden/GardenIcon';
import PicoBubble from '../garden/PicoBubble';
import ProjectJar from '../project/ProjectJar';
import AppPreview from './AppPreview';
import { CHOICE_LOOKS } from '../../lib/garden/choiceLooks';
import PlayStoreBadge from './PlayStoreBadge';
import SocialLinks from './SocialLinks';
import { useGardenFonts } from '../../hooks/garden/useGardenFonts';
import { useLandingConfig, mergeLanding, type LandingConfig, type LandingLink } from '../../hooks/config/useLandingConfig';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile } from '../../hooks/data/useProfile';
import { GARDEN_COLORS as G, GARDEN_RADII } from '../../lib/garden/theme';
import { MAX_W, pointer, shadow, transition } from '../../lib/ui/webLayout';

/* Ce que fait chaque part du plan de Pépin — mêmes mots et couleurs que l'accueil (CHOICE_LOOKS). */
const PLAN_TEXT: Record<'save' | 'invest' | 'enjoy' | 'keep', string> = {
  save: "L'épargne de secours qui te protège d'un coup dur : 1, 3, puis 6 mois de dépenses.",
  invest: "L'argent qui travaille pour toi, une fois ton épargne de secours en place.",
  keep: 'Ce qui reste sur ton compte courant, quand le mois prochain s’annonce plus serré.',
  enjoy: 'La part du mois pour te faire plaisir, sans culpabiliser. Elle grandit avec ton épargne.',
};

/** Les trois gestes de Relyka — partagés avec l'accueil mobile (GardenWelcome). */
export const HOW: { n: string; title: string; text: string }[] = [
  { n: '1', title: 'Ajoute tes comptes', text: 'Tes soldes, ce qui revient chaque mois (salaire, loyer, abonnements) : quelques taps, pas de questionnaire.' },
  { n: '2', title: 'Relyka calcule', text: 'Ce qu’il te reste vraiment ce mois-ci, une fois tes dépenses prévues et ta réserve gardée.' },
  { n: '3', title: 'Pépin te conseille', text: 'Épargner, investir, conserver, te faire plaisir : son plan, avec ses raisons. Tu fais les virements dans ta banque.' },
];

/* Le reste de l'app, en trois cartes. */
const FEATURES: { icon: string; title: string; text: string }[] = [
  { icon: 'wallet-outline', title: 'Tous tes comptes, d’un coup d’œil', text: 'Courants, épargne, placements, crédits : chaque compte en tuile, dans l’ordre que tu veux.' },
  { icon: 'stats-chart-outline', title: 'Ton parcours en 9 étapes', text: 'Où tu en es, et exactement ce qu’il faut pour passer au palier suivant.' },
  { icon: 'flag-outline', title: 'Des projets qui se remplissent', text: 'Un voyage, une voiture, des travaux : un bocal qui se remplit chaque mois jusqu’à l’objectif.' },
];

/** `previewConfig` / `previewWidth` : aperçu de l'admin Vitrine (config non enregistrée, largeur simulée). */
export default function GardenLandingPage({ previewConfig, previewWidth }: { previewConfig?: LandingConfig; previewWidth?: number } = {}) {
  const router = useRouter();
  const fontsReady = useGardenFonts();
  const { width: windowWidth } = useWindowDimensions();
  const width = previewWidth ?? windowWidth;
  const wide = width >= 980;
  const narrow = width < 480;
  const { data: loaded } = useLandingConfig();
  const cfg = useMemo(() => mergeLanding(previewConfig ?? loaded), [previewConfig, loaded]);
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
  const h2 = { fontSize: narrow ? 30 : 38, lineHeight: narrow ? 36 : 44 };
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
  const kicker = (t: string) => <GardenText variant="label" color={G.primary}>{t}</GardenText>;

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
        {/* ── Héros : la promesse + l'accueil de l'app ── */}
        <View style={[col, { paddingTop: wide ? 64 : 28, paddingBottom: wide ? 64 : 36, flexDirection: wide ? 'row' : 'column', alignItems: 'center', gap: wide ? 56 : 28 }]}>
          <View style={{ flex: wide ? 1 : undefined, gap: 18, maxWidth: 560 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: GARDEN_RADII.pill, backgroundColor: G.branchesBg }}>
              <Ionicons name="sparkles-outline" size={14} color={G.branchesText} />
              <GardenText variant="smallStrong" color={G.branchesText}>Ton budget, clair en 3 secondes</GardenText>
            </View>
            <GardenText variant="display" style={{ fontSize: narrow ? 38 : 54, lineHeight: narrow ? 44 : 60 }} accessibilityRole="header">Sache ce que tu peux vraiment dépenser.</GardenText>
            <GardenText variant="body" color={G.inkSoft} style={{ fontSize: narrow ? 17 : 19, lineHeight: narrow ? 26 : 29 }}>
              Relyka calcule chaque mois ce qu’il te reste vraiment, une fois tes factures et ta réserve mises de côté. Et Pépin, ton hérisson, te dit quoi en faire : épargner, investir, garder, ou te faire plaisir.
            </GardenText>
            <View style={{ flexDirection: narrow ? 'column' : 'row', gap: 12, flexWrap: 'wrap' }}>
              {primaryBtn('Commencer gratuitement', true)}
              {secondaryBtn("J'ai déjà un compte", true)}
            </View>
            <PlayStoreBadge url={cfg.androidStoreUrl} />
          </View>
          <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : '100%', maxWidth: 440 }}>
            <AppPreview />
          </View>
        </View>

        {/* ── Le plan de Pépin : les quatre parts, et pourquoi ── */}
        <View nativeID="features" style={{ backgroundColor: G.card, borderTopWidth: 1, borderBottomWidth: 1, borderColor: G.line }}>
          <View style={[col, { paddingVertical: wide ? 72 : 44, gap: 28 }]}>
            <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'stretch', gap: wide ? 40 : 18 }}>
              <View style={{ flex: wide ? 1 : undefined, gap: 10, maxWidth: 640 }}>
                {kicker('Le plan de Pépin')}
                <GardenText variant="display" style={h2}>Chaque mois, un plan pour ce qu’il te reste.</GardenText>
                <GardenText variant="body" color={G.inkSoft}>Pépin répartit ton Relyka selon ta situation, et t’explique chaque choix. Tu restes libre : c’est toi qui fais tes virements, quand tu veux.</GardenText>
              </View>
              <View style={{ flex: wide ? 1 : undefined, maxWidth: 460 }}>
                <PicoBubble mood="thinking">Ton épargne couvre 2 mois de dépenses. Vise 3 mois avant d’investir davantage : un virement programmé de 710 € et c’est fait en février.</PicoBubble>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
              {(['save', 'invest', 'keep', 'enjoy'] as const).map((k) => {
                const look = CHOICE_LOOKS[k];
                return (
                  <View key={k} style={{ flexGrow: 1, flexBasis: wide ? '22%' : narrow ? '100%' : '45%', minWidth: 200, gap: 10, padding: 18, borderRadius: GARDEN_RADII.lg, backgroundColor: look.bg }}>
                    <GardenIcon icon={look.icon} fg={look.fg} bg={G.card} size={44} />
                    <GardenText variant="heading" color={look.fg}>{look.verb}</GardenText>
                    <GardenText variant="body" color={G.ink}>{PLAN_TEXT[k]}</GardenText>
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        {/* ── Le reste de l'app ── */}
        <View nativeID="app" style={[col, { paddingVertical: wide ? 72 : 44, gap: 28 }]}>
          <View style={{ gap: 10, maxWidth: 680 }}>
            {kicker('Tout ton argent, au même endroit')}
            <GardenText variant="display" style={h2}>Simple à lire, agréable à suivre.</GardenText>
          </View>
          <View style={{ flexDirection: wide ? 'row' : 'column', gap: 16 }}>
            {FEATURES.map((f, i) => (
              <View key={f.title} style={{ flex: wide ? 1 : undefined, gap: 12, padding: 22, borderRadius: GARDEN_RADII.lg, backgroundColor: G.card, borderWidth: 1, borderColor: G.line }}>
                {i === 2 ? <ProjectJar pct={62} size={44} /> : <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: G.branchesBg, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={f.icon as any} size={24} color={G.primary} /></View>}
                <GardenText variant="title">{f.title}</GardenText>
                <GardenText variant="body" color={G.inkSoft}>{f.text}</GardenText>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'flex-start', gap: 16, padding: 22, borderRadius: GARDEN_RADII.lg, backgroundColor: G.waterBg }}>
            <Ionicons name="keypad-outline" size={28} color={G.waterText} />
            <View style={{ flex: wide ? 1 : undefined, gap: 4 }}>
              <GardenText variant="heading" color={G.waterText}>Une dépense en trois taps</GardenText>
              <GardenText variant="body" color={G.ink}>Le montant au pavé, la catégorie d’un tap, Enregistrer. Et ce qui revient chaque mois se prévoit tout seul.</GardenText>
            </View>
          </View>
        </View>

        {/* ── Comment ça marche ── */}
        <View nativeID="how" style={{ backgroundColor: G.card, borderTopWidth: 1, borderBottomWidth: 1, borderColor: G.line }}>
          <View style={[col, { paddingVertical: wide ? 72 : 44, gap: 28 }]}>
            <View style={{ gap: 10, maxWidth: 680 }}>
              {kicker('Comment ça marche')}
              <GardenText variant="display" style={h2}>Trois étapes, cinq minutes.</GardenText>
            </View>
            <View style={{ flexDirection: wide ? 'row' : 'column', gap: 16 }}>
              {HOW.map((h) => (
                <View key={h.n} style={{ flex: wide ? 1 : undefined, gap: 12, padding: 22, borderRadius: GARDEN_RADII.lg, backgroundColor: G.bg, borderWidth: 1, borderColor: G.line }}>
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
              <GardenText variant="display" color={G.onPrimary} center={!wide} style={{ fontSize: narrow ? 28 : 36, lineHeight: narrow ? 34 : 42 }}>Pépin t’attend.</GardenText>
              <GardenText variant="body" color={G.onPrimary} center={!wide} style={{ opacity: 0.9 }}>Gratuit pour commencer. Cinq minutes, et ton Relyka se calcule tout seul.</GardenText>
              <Pressable onPress={() => go('/register')} accessibilityRole="link"
                style={({ hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 54, paddingHorizontal: 26, borderRadius: GARDEN_RADII.pill, backgroundColor: hovered ? G.field : G.card }, pointer, transition]}>
                <GardenText variant="bodyStrong" color={G.primary}>Commencer gratuitement</GardenText>
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
