/**
 * Rendu VISUEL d'une réponse Conseils IA structurée (cf. lib/aiReport).
 * Couche 1 (synthèse, si présente) : Verdict (anneau de score SVG + tag + phrase), cartes d'insight
 *   « Ce qui te protège » / « Le vrai point de vigilance », Radar de signaux, Actions.
 * Couche 2 (toujours) : sections détaillées, chacune en carte (corps via AiRichText) → aucune info
 *   perdue. Entièrement piloté par la palette de thème passée en `c`.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import AiRichText from './AiRichText';
import { type AiReport as Report, signalMeta, scoreColor } from '../lib/aiReport';

/** Teinte douce d'une couleur hex (#rrggbb) → ajoute un canal alpha. Repli : couleur brute. */
function tint(color: string, hexAlpha: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${hexAlpha}` : color;
}

/** Anneau de score SVG (arc de progression) — comme l'anneau du Pouls, robuste au layout flex. */
function ScoreRing({ score, c }: { score: number; c: any }) {
  const size = 66, stroke = 6;
  const r = (size - stroke) / 2, cx = size / 2;
  const C = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, score / 100));
  const col = scoreColor(score, c);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cx} r={r} fill="none" stroke={tint(col, '2e')} strokeWidth={stroke} />
        <Circle
          cx={cx} cy={cx} r={r} fill="none" stroke={col} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${C * filled} ${C - C * filled}`} transform={`rotate(-90 ${cx} ${cx})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
        <Text style={{ fontSize: 20, fontWeight: '800', color: c.text, lineHeight: 22 }}>{score}</Text>
        <Text style={{ fontSize: 8.5, color: c.textSecondary, fontWeight: '600', marginTop: -2 }}>/ 100</Text>
      </View>
    </View>
  );
}

export default function AiReport({ report, c, baseTextStyle }: { report: Report; c: any; baseTextStyle: StyleProp<TextStyle> }) {
  const s = useMemo(() => makeStyles(c), [c]);
  const sum = report.summary;
  const bandColor = sum?.score != null ? scoreColor(sum.score, c) : c.emerald;

  return (
    <View style={s.stack}>
      {/* ── Verdict ── */}
      {sum && (sum.verdict || sum.score != null || sum.tag) && (
        <View style={s.verdict}>
          {sum.score != null && <ScoreRing score={sum.score} c={c} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            {!!sum.tag && (
              <View style={[s.tagPill, { backgroundColor: tint(bandColor, '22'), borderColor: tint(bandColor, '55') }]}>
                <Text style={[s.tagTxt, { color: bandColor }]}>{sum.tag}</Text>
              </View>
            )}
            {!!sum.verdict && <Text style={s.verdictTxt}>{sum.verdict}</Text>}
          </View>
        </View>
      )}

      {/* ── Insights : ce qui protège / point de vigilance ── */}
      {sum?.protect && (
        <View style={[s.insight, { borderColor: c.cardBorder }]}>
          <View style={[s.insightIc, { backgroundColor: tint(c.success, '22') }]}>
            <Ionicons name="shield-checkmark" size={16} color={c.success} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.insightTitle, { color: c.success }]}>Ton point fort</Text>
            <Text style={s.insightBody}>{sum.protect}</Text>
          </View>
        </View>
      )}
      {sum?.vigilance && (
        <View style={[s.insight, { borderColor: c.cardBorder }]}>
          <View style={[s.insightIc, { backgroundColor: tint(c.danger, '22') }]}>
            <Ionicons name="alert" size={16} color={c.danger} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.insightTitle, { color: c.danger }]}>Le point de vigilance</Text>
            <Text style={s.insightBody}>{sum.vigilance}</Text>
          </View>
        </View>
      )}

      {/* ── Radar de signaux ── */}
      {sum && sum.signals.length > 0 && (
        <View style={s.card}>
          <View style={s.cardHead}>
            <Text style={s.cardHeadTxt}>🛡️ Radar du mois</Text>
            <Text style={s.cardHeadN}>{sum.signals.length} signaux</Text>
          </View>
          {sum.signals.map((sig, i) => {
            const meta = signalMeta(sig.status, c);
            return (
              <View key={i} style={[s.srow, i === 0 && { borderTopWidth: 0 }]}>
                <View style={[s.dot, { backgroundColor: meta.color }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.srowLabel} numberOfLines={1}>{sig.label}</Text>
                  {!!sig.detail && <Text style={s.srowSub} numberOfLines={2}>{sig.detail}</Text>}
                </View>
                <View style={[s.pill, { backgroundColor: tint(meta.color, '22') }]}>
                  <Text style={[s.pillTxt, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* ── Actions prioritaires : « Ce que je ferais à ta place », en TOP N ── */}
      {sum && sum.actions.length > 0 && (
        <View style={s.card}>
          <View style={s.cardHead}>
            <View style={s.kicker}><Text style={s.kickerTxt}>TOP {Math.min(sum.actions.length, 3)}</Text></View>
            <Text style={s.cardHeadTxt}>Ce que je ferais à ta place</Text>
          </View>
          {sum.actions.map((a, i) => (
            <View key={i} style={[s.act, i > 0 && s.actDivider]}>
              <View style={[s.rank, { backgroundColor: tint(a.primary ? c.emerald : c.textSecondary, '22') }]}>
                <Text style={[s.rankTxt, { color: a.primary ? c.emerald : c.textSecondary }]}>{i + 1}</Text>
              </View>
              <Text style={s.actTitle}>{a.title}</Text>
              {!!a.meta && (
                <View style={[s.metaPill, a.primary && { borderColor: tint(c.emerald, '55') }]}>
                  <Text style={[s.metaTxt, a.primary && { color: c.emerald }]}>{a.meta}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {/* ── Intro éventuelle (rare) ── */}
      {!!report.intro && <AiRichText text={report.intro} style={baseTextStyle} />}

      {/* ── Analyse détaillée : une carte par section (comme la cible), sous un intitulé. ── */}
      {report.sections.length > 0 && (
        <>
          <Text style={s.detailLabel}>L'analyse détaillée</Text>
          {report.sections.map((sec, i) => (
            <View key={i} style={s.section}>
              <View style={s.secHead}>
                {!!sec.emoji && <Text style={s.secEmoji}>{sec.emoji}</Text>}
                <Text style={s.secTitle}>{sec.title}</Text>
              </View>
              {!!sec.body && <AiRichText text={sec.body} style={baseTextStyle} />}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    stack: { gap: 10 },

    // `cardOpaque` et non `card` : ces cartes portent une ombre `elevation`, qui sur Android
    // transparaît à travers un fond translucide (voile gris + halo, très visible en thème clair).
    // Elles sont posées directement sur `bg`, donc l'aplat opaque rend exactement pareil.
    verdict: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.cardOpaque, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, padding: 15, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
    tagPill: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2, marginBottom: 7 },
    tagTxt: { fontSize: 11, fontWeight: '800' },
    verdictTxt: { fontSize: 15.5, fontWeight: '800', color: c.text, lineHeight: 21 },

    insight: { flexDirection: 'row', gap: 11, backgroundColor: c.cardOpaque, borderWidth: 1, borderRadius: 16, padding: 14, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
    insightIc: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', flex: 0 },
    insightTitle: { fontSize: 13.5, fontWeight: '800', marginBottom: 3 },
    insightBody: { fontSize: 13.5, color: c.text, lineHeight: 19 },

    card: { backgroundColor: c.cardOpaque, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, padding: 14, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    cardHeadTxt: { fontSize: 13.5, fontWeight: '800', color: c.text },
    kicker: { backgroundColor: c.violet, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
    kickerTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, color: c.bg },
    cardHeadN: { marginLeft: 'auto', fontSize: 11, color: c.textSecondary, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },

    srow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.cardBorder },
    dot: { width: 9, height: 9, borderRadius: 5, flex: 0 },
    srowLabel: { fontSize: 13.5, fontWeight: '700', color: c.text },
    srowSub: { fontSize: 11.5, color: c.textSecondary, marginTop: 1 },
    pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
    pillTxt: { fontSize: 11, fontWeight: '700' },

    act: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9 },
    actDivider: { borderTopWidth: 1, borderTopColor: c.cardBorder },
    rank: { width: 26, height: 26, minWidth: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexGrow: 0, flexShrink: 0 },
    rankTxt: { fontSize: 13, fontWeight: '800' },
    actTitle: { flex: 1, fontSize: 13.5, fontWeight: '700', color: c.text },
    metaPill: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
    metaTxt: { fontSize: 11, fontWeight: '700', color: c.textSecondary },

    detailLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: c.textSecondary, marginTop: 6, marginBottom: 0, marginLeft: 2 },
    section: { backgroundColor: c.cardOpaque, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, padding: 14, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
    secHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7 },
    secEmoji: { fontSize: 15 },
    secTitle: { flex: 1, fontSize: 13, fontWeight: '800', letterSpacing: 0.3, color: c.text, textTransform: 'uppercase' },
  });
}
