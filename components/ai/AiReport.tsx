/**
 * Une réponse de Pépin, en cartes du Jardin (structure : lib/ai/aiReport) — pas un fil de discussion.
 *   1. L'avis de Pépin : son portrait, la note sur 100 (anneau) et la phrase qui résume.
 *   2. Ton point fort / le point à surveiller : deux cartes teintées.
 *   3. Ton mois en un coup d'œil : les signaux, chacun avec l'image de la partie de l'arbre dont il
 *      parle (lib/ai/reportTopic) et un état en mots simples (Ça va / À surveiller / Dépassé).
 *   4. Ce que je ferais à ta place : les actions, numérotées.
 *   5. Le détail : une carte par section, illustrée de la même façon.
 * Les textes de l'IA restent tels quels (mots simples) : le Jardin illustre, il ne renomme pas.
 */
import { View, type StyleProp, type TextStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import AiRichText from './AiRichText';
import Pico from '../garden/Pico';
import GardenText from '../garden/GardenText';
import GardenIcon from '../garden/GardenIcon';
import { type AiReport as Report, type SignalStatus } from '../../lib/ai/aiReport';
import { reportTopic } from '../../lib/ai/reportTopic';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';

/** État d'un signal : un mot simple et sa teinte du Jardin (jamais de rouge vif). */
function statusLook(status: SignalStatus): { label: string; fg: string; bg: string } {
  if (status === 'good') return { label: 'Ça va', fg: G.branchesText, bg: G.branchesBg };
  if (status === 'over') return { label: 'Dépassé', fg: G.flowersText, bg: G.flowersBg };
  return { label: 'À surveiller', fg: G.noticeText, bg: G.notice };
}

const scoreLook = (score: number) => statusLook(score >= 70 ? 'good' : score >= 45 ? 'watch' : 'over');

function ScoreRing({ score }: { score: number }) {
  const size = 64, stroke = 7, r = (size - stroke) / 2, cx = size / 2, C = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, score / 100));
  const look = scoreLook(score);
  return (
    <View style={{ width: size, height: size }} accessible accessibilityLabel={`Note : ${score} sur 100`}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cx} r={r} fill="none" stroke={G.track} strokeWidth={stroke} />
        <Circle cx={cx} cy={cx} r={r} fill="none" stroke={look.fg} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${C * filled} ${C - C * filled}`} transform={`rotate(-90 ${cx} ${cx})`} />
      </Svg>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
        <GardenText variant="heading" tabular>{score}</GardenText>
      </View>
    </View>
  );
}

const card = { backgroundColor: G.card, borderWidth: 1, borderColor: G.line, borderRadius: GARDEN_RADII.lg, padding: GARDEN_SPACE.lg, gap: GARDEN_SPACE.sm } as const;

export default function AiReport({ report, baseTextStyle }: { report: Report; baseTextStyle: StyleProp<TextStyle> }) {
  const sum = report.summary;
  const tagLook = sum?.score != null ? scoreLook(sum.score) : { fg: G.branchesText, bg: G.branchesBg };

  return (
    <View style={{ gap: GARDEN_SPACE.md }}>
      {/* ── 1. L'avis de Pépin ── */}
      {sum && (sum.verdict || sum.score != null || sum.tag) ? (
        <View style={[card, { backgroundColor: G.pico, borderWidth: 0, flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }]}>
          <Pico avatar size={48} mood={sum.score != null && sum.score < 45 ? 'thinking' : 'joy'} />
          <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
            {sum.tag ? (
              <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: GARDEN_RADII.pill, backgroundColor: tagLook.bg }}>
                <GardenText variant="smallStrong" color={tagLook.fg} style={{ fontSize: 12 }}>{sum.tag}</GardenText>
              </View>
            ) : null}
            {sum.verdict ? <GardenText variant="bodyStrong">{sum.verdict}</GardenText> : null}
          </View>
          {sum.score != null ? <ScoreRing score={sum.score} /> : null}
        </View>
      ) : null}

      {/* ── 2. Point fort / point à surveiller ── */}
      {sum?.protect ? (
        <View style={[card, { backgroundColor: G.branchesBg, borderWidth: 0, flexDirection: 'row', gap: GARDEN_SPACE.md }]}>
          <GardenIcon kind="done" bg={G.card} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <GardenText variant="label" color={G.branchesText}>Ton point fort</GardenText>
            <GardenText variant="body">{sum.protect}</GardenText>
          </View>
        </View>
      ) : null}
      {sum?.vigilance ? (
        <View style={[card, { backgroundColor: G.notice, borderWidth: 0, flexDirection: 'row', gap: GARDEN_SPACE.md }]}>
          <GardenIcon kind="warn" bg={G.card} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <GardenText variant="label" color={G.noticeText}>Le point à surveiller</GardenText>
            <GardenText variant="body">{sum.vigilance}</GardenText>
          </View>
        </View>
      ) : null}

      {/* ── 3. Ton mois en un coup d'œil ── */}
      {sum && sum.signals.length > 0 ? (
        <View style={[card, { paddingVertical: GARDEN_SPACE.md }]}>
          <GardenText variant="label">Ton mois en un coup d'œil</GardenText>
          {sum.signals.map((sig, i) => {
            const look = statusLook(sig.status);
            return (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, paddingTop: 10, borderTopWidth: i ? 1 : 0, borderTopColor: G.line }}>
                <GardenIcon kind={reportTopic(sig.label)} size={32} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <GardenText variant="bodyStrong" numberOfLines={1}>{sig.label}</GardenText>
                  {sig.detail ? <GardenText variant="small" color={G.muted} numberOfLines={2}>{sig.detail}</GardenText> : null}
                </View>
                <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: GARDEN_RADII.pill, backgroundColor: look.bg }}>
                  <GardenText variant="smallStrong" color={look.fg} style={{ fontSize: 12 }}>{look.label}</GardenText>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* ── 4. Ce que je ferais à ta place ── */}
      {sum && sum.actions.length > 0 ? (
        <View style={[card, { paddingVertical: GARDEN_SPACE.md }]}>
          <GardenText variant="label" color={G.branchesText}>Ce que je ferais à ta place</GardenText>
          {sum.actions.map((a, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, paddingTop: 10, borderTopWidth: i ? 1 : 0, borderTopColor: G.line }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: a.primary ? G.primary : G.field }}>
                <GardenText variant="smallStrong" color={a.primary ? G.onPrimary : G.inkSoft}>{i + 1}</GardenText>
              </View>
              <GardenText variant="bodyStrong" style={{ flex: 1 }}>{a.title}</GardenText>
              {a.meta ? <GardenText variant="small" color={a.primary ? G.primary : G.muted}>{a.meta}</GardenText> : null}
            </View>
          ))}
        </View>
      ) : null}

      {report.intro ? <AiRichText text={report.intro} style={baseTextStyle} /> : null}

      {/* ── 5. Le détail : une carte illustrée par section ── */}
      {report.sections.map((sec, i) => (
        <View key={i} style={card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
            <GardenIcon kind={reportTopic(sec.title)} size={32} />
            <GardenText variant="heading" style={{ flex: 1 }}>{sec.title}</GardenText>
          </View>
          {sec.body ? <AiRichText text={sec.body} style={baseTextStyle} /> : null}
        </View>
      ))}
    </View>
  );
}
