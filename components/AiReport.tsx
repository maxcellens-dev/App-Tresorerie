/**
 * Rendu VISUEL d'une réponse Conseils IA structurée (cf. lib/aiReport).
 * Couche 1 (synthèse, si présente) : carte Verdict (score + tag + phrase), Radar de signaux, Actions.
 * Couche 2 (toujours) : chaque section titrée devient une carte, corps rendu par AiRichText → AUCUNE
 * info perdue, juste hiérarchisée. Entièrement piloté par la palette de thème passée en `c`.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import AiRichText from './AiRichText';
import { type AiReport as Report, signalMeta, scoreColor } from '../lib/aiReport';

/** Teinte douce d'une couleur hex (#rrggbb) → ajoute un canal alpha. Repli : couleur brute. */
function tint(color: string, hexAlpha: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${hexAlpha}` : color;
}

export default function AiReport({ report, c, baseTextStyle }: { report: Report; c: any; baseTextStyle: StyleProp<TextStyle> }) {
  const s = useMemo(() => makeStyles(c), [c]);
  const sum = report.summary;

  return (
    <View style={s.stack}>
      {/* ── Verdict ── */}
      {sum && (sum.verdict || sum.score != null || sum.tag) && (
        <View style={s.verdict}>
          {sum.score != null && (
            <View style={[s.ring, { borderColor: scoreColor(sum.score, c) }]}>
              <Text style={[s.ringNum, { color: scoreColor(sum.score, c) }]}>{sum.score}</Text>
              <Text style={s.ringUnit}>/100</Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            {!!sum.tag && (
              <View style={[s.tagPill, { backgroundColor: tint(scoreColor(sum.score ?? 60, c), '22'), borderColor: tint(scoreColor(sum.score ?? 60, c), '55') }]}>
                <Text style={[s.tagTxt, { color: scoreColor(sum.score ?? 60, c) }]}>{sum.tag}</Text>
              </View>
            )}
            {!!sum.verdict && <Text style={s.verdictTxt}>{sum.verdict}</Text>}
          </View>
        </View>
      )}

      {/* ── Radar de signaux ── */}
      {sum && sum.signals.length > 0 && (
        <View style={s.card}>
          <View style={s.cardHead}>
            <Text style={s.cardHeadTxt}>🛡️ Radar</Text>
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

      {/* ── Actions prioritaires ── */}
      {sum && sum.actions.length > 0 && (
        <View style={s.card}>
          <View style={s.cardHead}>
            <Text style={s.cardHeadTxt}>🎯 À faire</Text>
          </View>
          {sum.actions.map((a, i) => (
            <View key={i} style={s.act}>
              <View style={[s.rank, a.primary && { backgroundColor: c.emerald, borderColor: 'transparent' }]}>
                <Text style={[s.rankTxt, a.primary && { color: c.bg }]}>{i + 1}</Text>
              </View>
              <Text style={s.actTitle}>{a.title}</Text>
              {!!a.meta && (
                <View style={[s.metaPill, a.primary && { borderColor: tint(c.success, '55') }]}>
                  <Text style={[s.metaTxt, a.primary && { color: c.success }]}>{a.meta}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {/* ── Intro éventuelle (rare) ── */}
      {!!report.intro && <AiRichText text={report.intro} style={baseTextStyle} />}

      {/* ── Sections riches (le fond de l'analyse) ── */}
      {report.sections.map((sec, i) => (
        <View key={i} style={s.section}>
          <View style={s.secHead}>
            {!!sec.emoji && <Text style={s.secEmoji}>{sec.emoji}</Text>}
            <Text style={s.secTitle}>{sec.title}</Text>
          </View>
          {!!sec.body && <AiRichText text={sec.body} style={baseTextStyle} />}
        </View>
      ))}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    stack: { gap: 10 },

    verdict: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, padding: 15 },
    ring: { width: 60, height: 60, borderRadius: 30, borderWidth: 3, alignItems: 'center', justifyContent: 'center', flex: 0 },
    ringNum: { fontSize: 21, fontWeight: '800', lineHeight: 23 },
    ringUnit: { fontSize: 9, color: c.textSecondary, fontWeight: '600', marginTop: -1 },
    tagPill: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2, marginBottom: 7 },
    tagTxt: { fontSize: 11, fontWeight: '800' },
    verdictTxt: { fontSize: 15.5, fontWeight: '800', color: c.text, lineHeight: 21 },

    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, padding: 14 },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    cardHeadTxt: { fontSize: 13.5, fontWeight: '800', color: c.text },
    cardHeadN: { marginLeft: 'auto', fontSize: 11, color: c.textSecondary, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },

    srow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.cardBorder },
    dot: { width: 9, height: 9, borderRadius: 5, flex: 0 },
    srowLabel: { fontSize: 13.5, fontWeight: '700', color: c.text },
    srowSub: { fontSize: 11.5, color: c.textSecondary, marginTop: 1 },
    pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
    pillTxt: { fontSize: 11, fontWeight: '700' },

    act: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8 },
    rank: { width: 24, height: 24, borderRadius: 7, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center', justifyContent: 'center', flex: 0 },
    rankTxt: { fontSize: 12, fontWeight: '800', color: c.text },
    actTitle: { flex: 1, fontSize: 13.5, fontWeight: '700', color: c.text },
    metaPill: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
    metaTxt: { fontSize: 11, fontWeight: '700', color: c.textSecondary },

    section: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, padding: 14 },
    secHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    secEmoji: { fontSize: 16 },
    secTitle: { flex: 1, fontSize: 14.5, fontWeight: '800', color: c.text },
  });
}
