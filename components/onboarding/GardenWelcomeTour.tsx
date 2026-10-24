/**
 * BIENVENUE — les cinq écrans de la toute première ouverture, dans le Jardin.
 *
 * Ils MONTRENT l'app avant de demander quoi que ce soit, avec ses vrais visuels (l'arbre 3D,
 * l'arrosoir, Pépin, les gestes) et des mots simples :
 *   1. ton argent devient un jardin ;
 *   2. ton Relyka = l'eau de ton arrosoir (ce qu'il te reste vraiment ce mois-ci) ;
 *   3. Pépin te propose quoi en faire ;
 *   4. ton arbre grandit avec toi (racines, fruits, fleurs, ronces) ;
 *   5. les cinq étapes pour planter ton arbre → la page « Plante ton arbre ».
 * Les chiffres affichés sont des EXEMPLES : l'utilisateur n'a encore aucune donnée.
 *
 * Monté à la RACINE (app/_layout) : il couvre l'app pendant que comptes et opérations se chargent
 * (`booting`), sinon le Jardin vide se montrerait une seconde avant la présentation.
 */
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import GardenText from '../garden/GardenText';
import GardenButton from '../garden/GardenButton';
import GardenGlow from '../garden/GardenGlow';
import GardenIcon from '../garden/GardenIcon';
import Pico from '../garden/Pico';
import PicoBubble from '../garden/PicoBubble';
import { useGuide } from '../../contexts/GuideContext';
import { useGardenFonts } from '../../hooks/garden/useGardenFonts';
import { useResponsive } from '../../hooks/theme/useResponsive';
import { CHOICE_LOOKS } from '../../lib/garden/choiceLooks';
import { GARDEN_ICONS, type GardenIconKey } from '../../lib/garden/icons';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';
import { formatEuros } from '../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { MAX_W, pointer } from '../../lib/ui/webLayout';

/** Les cinq étapes de « Plante ton arbre » (app/(tabs)/(secondary)/demarrer) — mêmes mots. */
export const PLANTING_STEPS: { kind: GardenIconKey; title: string; text: string }[] = [
  { kind: 'water', title: 'Ton compte courant', text: 'avec le solde affiché par ta banque aujourd’hui' },
  { kind: 'roots', title: 'Ton épargne', text: 'ton livret, tes placements (facultatif)' },
  { kind: 'recurring', title: 'Ce qui revient chaque mois', text: 'ton salaire, ton loyer, tes abonnements' },
  { kind: 'budget', title: 'Tes dépenses du quotidien', text: 'une estimation par semaine suffit' },
  { kind: 'setAside', title: 'Ta réserve minimum', text: 'ce que tu veux toujours garder' },
];

const PARTS: { kind: GardenIconKey; name: string; text: string }[] = [
  { kind: 'roots', name: 'Ton épargne', text: 'Ton argent de secours : 1, 3 puis 6 mois de dépenses mis de côté.' },
  { kind: 'fruits', name: 'Tes placements', text: 'Ton argent qui travaille pour toi.' },
  { kind: 'flowers', name: 'Ton plaisir', text: 'La part du mois à dépenser pour toi, sans culpabiliser.' },
  { kind: 'brambles', name: 'Ton crédit cher', text: 'À rembourser en premier.' },
];

const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);

function Row({ kind, title, text, n }: { kind: GardenIconKey; title: string; text: string; n?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, paddingVertical: 8 }}>
      {n != null ? (
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: G.primary, alignItems: 'center', justifyContent: 'center' }}>
          <GardenText variant="smallStrong" color={G.onPrimary}>{n}</GardenText>
        </View>
      ) : null}
      <GardenIcon kind={kind} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <GardenText variant="bodyStrong">{title}</GardenText>
        <GardenText variant="small" color={G.muted}>{text}</GardenText>
      </View>
    </View>
  );
}

const card = { backgroundColor: G.card, borderRadius: GARDEN_RADII.lg, borderWidth: 1, borderColor: G.line, padding: GARDEN_SPACE.lg } as const;

interface Slide { key: string; title: string; text: string; visual: ReactNode }

function slides(): Slide[] {
  return [
    {
      key: 'garden',
      title: 'Ton argent, clair en un coup d’œil',
      text: 'Relyka te dit chaque mois combien tu peux vraiment utiliser, et quoi en faire. Pépin, ton hérisson, t’accompagne à chaque étape.',
      visual: <View style={[card, { alignItems: 'center', paddingVertical: GARDEN_SPACE.xl }]}><Pico size={150} mood="joy" /></View>,
    },
    {
      key: 'relyka',
      title: 'Ton Relyka : ce qu’il te reste vraiment',
      text: 'Chaque mois, Relyka calcule ce qu’il te reste VRAIMENT : une fois tes factures, tes dépenses habituelles et ta réserve minimum mises de côté. Ce n’est pas ton solde du jour, c’est ce que tu peux utiliser sans mauvaise surprise.',
      visual: (
        <View style={[card, { alignItems: 'center', gap: GARDEN_SPACE.sm }]}>
          <GardenText variant="label" color={G.waterText}>Ton Relyka · exemple</GardenText>
          <GardenText variant="amount" tabular>{eur(900)}</GardenText>
          <GardenText variant="small" color={G.muted} center>à utiliser ce mois-ci</GardenText>
        </View>
      ),
    },
    {
      key: 'pepin',
      title: 'Pépin te dit quoi en faire',
      text: 'Pépin, ton hérisson, te propose comment répartir ton Relyka selon ta situation. Tu restes libre : c’est toi qui fais tes virements, quand tu veux.',
      visual: (
        <View style={{ gap: GARDEN_SPACE.md }}>
          <PicoBubble mood="joy">Ce mois-ci, je te propose :</PicoBubble>
          <View style={[card, { paddingVertical: 4 }]}>
            {([['save', 300], ['invest', 200], ['enjoy', 250], ['keep', 150]] as const).map(([t, amount], i) => {
              const look = CHOICE_LOOKS[t];
              return (
                <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: G.line }}>
                  <GardenIcon icon={look.icon} fg={look.fg} bg={look.bg} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <GardenText variant="bodyStrong" numberOfLines={1}>{look.verb}</GardenText>
                    <GardenText variant="small" color={G.muted} numberOfLines={1}>{look.meaning}</GardenText>
                  </View>
                  <GardenText variant="bodyStrong" tabular color={look.fg}>{eur(amount)}</GardenText>
                </View>
              );
            })}
          </View>
        </View>
      ),
    },
    {
      key: 'tree',
      title: 'Ton parcours, étape par étape',
      text: 'De l’épargne de secours jusqu’au patrimoine, neuf étapes. Relyka te montre où tu en es et ce qu’il faut pour passer à la suivante : pas de jugement, juste un repère.',
      visual: <View style={[card, { paddingVertical: 6 }]}>{PARTS.map((p) => <Row key={p.kind} kind={p.kind} title={p.name} text={p.text} />)}</View>,
    },
    {
      key: 'plant',
      title: 'C’est parti, en 5 minutes',
      text: 'Pas de questionnaire : on part de tes vrais comptes. Cinq étapes, et ton Relyka se calcule tout seul. Tu pourras tout modifier ensuite.',
      visual: <View style={[card, { paddingVertical: 6 }]}>{PLANTING_STEPS.map((s, i) => <Row key={s.title} n={i + 1} kind={s.kind} title={s.title} text={s.text} />)}</View>,
    },
  ];
}

/** Monté à la racine de l'app : visible tant que l'étape « intro » du guide n'est pas franchie. */
export default function GardenWelcomeTour() {
  const guide = useGuide();
  const router = useRouter();
  const fontsReady = useGardenFonts();
  const { isDesktop } = useResponsive();
  const [index, setIndex] = useState(0);
  const visible = guide.is('intro') || guide.booting;
  const all = slides();
  const slide = all[Math.min(index, all.length - 1)];
  const last = index >= all.length - 1;

  const finish = (plant: boolean) => {
    guide.done('g2_intro');
    if (plant) router.push('/(tabs)/(secondary)/demarrer' as any);
  };

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: G.bg }}>
        <GardenGlow />
        <SafeAreaView style={{ flex: 1 }}>
          {guide.booting || !fontsReady ? (
            <ActivityIndicator style={{ flex: 1 }} color={G.primary} />
          ) : (
            <View style={{ flex: 1, width: '100%', maxWidth: isDesktop ? MAX_W.form : undefined, alignSelf: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: GARDEN_SPACE.lg, paddingTop: GARDEN_SPACE.sm, minHeight: 44 }}>
                <GardenText variant="label" color={G.primary} style={{ flex: 1 }}>{index + 1} / {all.length}</GardenText>
                {!last ? (
                  <Pressable onPress={() => finish(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Passer la présentation" style={pointer}>
                    <GardenText variant="smallStrong" color={G.muted}>Passer</GardenText>
                  </Pressable>
                ) : null}
              </View>
              <ScrollView key={slide.key} contentContainerStyle={{ padding: GARDEN_SPACE.lg, gap: GARDEN_SPACE.lg }} showsVerticalScrollIndicator={false}>
                {slide.visual}
                <View style={{ gap: GARDEN_SPACE.sm }}>
                  <GardenText variant="title">{slide.title}</GardenText>
                  <GardenText variant="body" color={G.inkSoft}>{slide.text}</GardenText>
                </View>
              </ScrollView>
              <View style={{ padding: GARDEN_SPACE.lg, gap: GARDEN_SPACE.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  {all.map((s, i) => <View key={s.key} style={{ width: i === index ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === index ? G.primary : G.track }} />)}
                </View>
                <View style={{ flexDirection: 'row', gap: GARDEN_SPACE.sm }}>
                  {index > 0 ? <View style={{ flex: 1 }}><GardenButton label="Retour" variant="secondary" onPress={() => setIndex((i) => i - 1)} /></View> : null}
                  <View style={{ flex: 2 }}>
                    <GardenButton label={last ? 'Commencer' : 'Suivant'} onPress={() => (last ? finish(true) : setIndex((i) => i + 1))} />
                  </View>
                </View>
              </View>
            </View>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}
