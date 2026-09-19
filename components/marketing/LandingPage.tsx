
/** Responsive public landing, edited through app_config.landing. */
import { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform, Image, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBrandColors } from '../../hooks/theme/useBrandColors';
import { useAppNameFontStyle, APP_NAME_TEXT_PROPS } from '../../hooks/theme/useBrandFont';
import { useLandingConfig, mergeLanding, type LandingConfig, type LandingLink } from '../../hooks/config/useLandingConfig';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile } from '../../hooks/data/useProfile';
import PlayStoreBadge from './PlayStoreBadge';
import SocialLinks from './SocialLinks';
import LandingProductPreview from './LandingProductPreview';
import LandingMedia from './LandingMedia';
import { landingTheme } from './landingTheme';
import { landingStyles } from './landingStyles';

export default function LandingPage({ previewConfig, previewWidth }: { previewConfig?: LandingConfig; previewWidth?: number } = {}) {
  const brandColors = useBrandColors();
  const appNameFontStyle = useAppNameFontStyle();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const width = previewWidth ?? windowWidth;
  const { data: loaded } = useLandingConfig();
  const cfg = useMemo(() => mergeLanding(previewConfig ?? loaded), [previewConfig, loaded]);
  const p = cfg.presentation;
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const wide = width >= 980;
  const c = useMemo(() => landingTheme(cfg.theme === 'dark', brandColors.emerald), [cfg.theme, brandColors.emerald]);
  const s = useMemo(() => landingStyles(c, wide, width < 480), [c, wide, width]);
  const goAnchor = (link: LandingLink) => {
    if (previewConfig) return;
    if (link.url) { if (Platform.OS === 'web' && /^https?:\/\//i.test(link.url)) window.open(link.url, '_blank', 'noopener,noreferrer'); return; }
    if (['login', 'register', 'confidentialite', 'legal'].includes(link.anchor ?? '')) { router.push(`/${link.anchor}` as any); return; }
    if (Platform.OS === 'web' && link.anchor) document.getElementById(link.anchor)?.scrollIntoView({ behavior: 'smooth' });
  };
  const brand = <View style={s.brandRow}><Image source={require('../../assets/logo.png')} style={s.logo} resizeMode="contain" /><Text {...APP_NAME_TEXT_PROPS} style={[s.brand, appNameFontStyle]}>{cfg.brandName}</Text></View>;
  const actions = (dark = false) => <View style={s.actions}>
    <TouchableOpacity accessibilityRole="link" onPress={() => goAnchor({ anchor: 'register', label: '' })} style={s.primary} activeOpacity={0.85}><Text style={[s.primaryText, { color: brandColors.onAccent }]}>{cfg.ctaPrimaryLabel}</Text><Ionicons name="arrow-forward" size={18} color={brandColors.onAccent} /></TouchableOpacity>
    <TouchableOpacity accessibilityRole="link" onPress={() => goAnchor({ anchor: 'login', label: '' })} style={s.secondary}><Text style={[s.secondaryText, dark && { color: c.white }]}>{cfg.ctaSecondaryLabel}</Text></TouchableOpacity>
    <PlayStoreBadge url={cfg.androidStoreUrl} />
  </View>;
  return <View style={s.root}>
    {!previewConfig && <StatusBar style={cfg.theme === 'dark' ? 'light' : 'dark'} />}
    <View style={s.header}><View style={s.headerInner}>
      {brand}
      {wide && <View style={s.nav}>{cfg.navLinks.map((link, i) => <TouchableOpacity key={i} accessibilityRole="link" onPress={() => goAnchor(link)} style={s.navTouch}><Text style={s.navText}>{link.label}</Text></TouchableOpacity>)}</View>}
      <TouchableOpacity accessibilityRole="link" onPress={() => goAnchor({ anchor: 'login', label: '' })} style={s.headerLogin}><Text style={s.secondaryText}>{cfg.ctaSecondaryLabel}</Text><Ionicons name="arrow-forward" size={16} color={c.ink} /></TouchableOpacity>
      {wide && <TouchableOpacity accessibilityRole="link" onPress={() => goAnchor({ anchor: 'register', label: '' })} style={s.primary}><Text style={[s.primaryText, { color: brandColors.onAccent }]}>{cfg.ctaPrimaryLabel}</Text></TouchableOpacity>}
    </View></View>
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator>
      <View style={s.hero}>
        <View style={s.heroText}>
          <View style={s.eyebrowRow}><View style={s.mark} /><Text style={s.eyebrow}>{cfg.heroBadge}</Text></View>
          <Text role="heading" aria-level={1} style={s.h1}>{cfg.heroTitle}</Text>
          <Text style={s.lead}>{cfg.heroSubtitle}</Text>
          {actions()}
        </View>
        <View style={s.heroVisual}>
          <View pointerEvents="none" style={s.visualBackdrop} />
          <View style={[s.productFrame, cfg.heroImage ? s.imageFrame : undefined]}>
            <LandingMedia media={{ ...p.heroMedia, url: cfg.heroImage }} fallback={<LandingProductPreview cfg={cfg} colors={c} compact={!wide} />} />
          </View>
          <View style={s.visualNote}><View style={s.smallLine} /><Text style={s.caption}>{cfg.footerText}</Text></View>
        </View>
      </View>
      <View nativeID="features" style={s.featureSection}><View style={s.container}>
        <View style={s.sectionHeading}><Text style={s.eyebrow}>{p.featuresEyebrow}</Text><Text role="heading" aria-level={2} style={s.h2}>{cfg.featuresTitle}</Text><Text style={s.body}>{cfg.featuresSubtitle}</Text></View>
        <View style={s.featureSpotlight}>
          <View style={[s.budgetVisual, p.productImage.url ? s.imageFrame : undefined]}><LandingMedia media={p.productImage} fallback={<LandingProductPreview cfg={cfg} colors={c} compact={!wide} kind="budget" />} /></View>
          <View style={s.featureEditorial}>{cfg.features.slice(0, 2).map((f, i) => <View key={i} style={s.featureLead}><View style={{ gap: 12, alignItems: 'center' }}><Text style={s.index}>0{i + 1}</Text><Ionicons name={(f.icon || 'sparkles-outline') as any} size={20} color={c.positive} /></View><View style={{ flex: 1, gap: 12 }}><Text role="heading" aria-level={3} style={s.featureTitle}>{f.title}</Text><Text style={s.body}>{f.text}</Text></View></View>)}</View>
        </View>
        <View style={s.featureList}>{cfg.features.slice(2).map((f, i) => <View key={i} style={s.featureItem}><Ionicons name={(f.icon || 'sparkles-outline') as any} size={23} color={c.positive} /><Text role="heading" aria-level={3} style={s.smallTitle}>{f.title}</Text><Text style={s.smallBody}>{f.text}</Text></View>)}</View>
      </View></View>
      {cfg.stats.length > 0 && <View nativeID="stats" style={s.commitments}>
        <Text role="heading" aria-level={2} style={s.commitmentTitle}>{p.commitmentsTitle}</Text>
        <View style={s.commitmentList}>{cfg.stats.map((stat, i) => <View key={i} style={s.commitment}><Text style={s.statValue}>{stat.value}</Text><Text style={s.smallBody}>{stat.label}</Text></View>)}</View>
      </View>}
      <View nativeID="final" style={s.final}>
        <LandingMedia media={p.finalImage} />
        <View style={s.finalInner}>
          <View style={[s.finalCopy, !!p.finalImage.url && { backgroundColor: c.deep, padding: wide ? 40 : 24, borderRadius: 12 }]}>
            <Text style={[s.eyebrow, { color: '#B8D3C7' }]}>{p.finalEyebrow}</Text><Text role="heading" aria-level={2} style={s.finalTitle}>{cfg.finalTitle}</Text><Text style={s.finalBody}>{cfg.finalSubtitle}</Text>{actions(true)}
          </View>
          {wide && <View pointerEvents="none" style={s.finalSymbol}><View style={s.symbolLine} /><View style={[s.symbolLine, { width: 100 }]} /><View style={[s.symbolLine, { width: 160 }]} /></View>}
        </View>
      </View>
      <View style={s.footer}>
        <View style={s.footerTop}><View style={{ gap: 16 }}>{brand}<Text style={s.smallBody}>{cfg.footerText}</Text></View><View style={s.footerMeta}>
          {cfg.socials?.position === 'above' && <SocialLinks config={cfg.socials} color={c.muted} />}
          <View style={s.footerLinks}>{cfg.footerLinks.map((link, i) => <TouchableOpacity accessibilityRole="link" key={i} onPress={() => goAnchor(link)} style={s.navTouch}><Text style={s.smallBody}>{link.label}</Text></TouchableOpacity>)}</View>
          {cfg.socials?.position !== 'above' && <SocialLinks config={cfg.socials} color={c.muted} />}
        </View></View>
        <Text style={s.copyright}>© {new Date().getFullYear()} {cfg.brandName}. Tous droits réservés.</Text>
      </View>
    </ScrollView>
    {profile?.is_admin && !previewConfig && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Éditer la page d’accueil" onPress={() => router.push('/(tabs)/(secondary)/admin/landing' as any)} style={s.edit}><Ionicons name="create-outline" size={20} color={c.white} /></TouchableOpacity>}
  </View>;
}
