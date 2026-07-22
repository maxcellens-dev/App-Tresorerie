/**
 * AiRichText — rendu markdown LÉGER et robuste des réponses IA (Conseils IA).
 * Gère ce que les modèles produisent réellement, sans lib externe (déterministe, léger) :
 *  • blocs : titres (# … ####), puces (-, •, *), listes numérotées (1. / 1)), citations (>),
 *    séparateurs (---, ***, ___), lignes vides ;
 *  • en ligne : **gras**, *italique* / _italique_, `code` (backticks autour d'un montant → mis en avant).
 * Tout marqueur non fermé est laissé tel quel. Aucune régression : le texte simple s'affiche normalement.
 */
import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';

interface Props {
  text: string;
  /** Style de base du texte (celui de la bulle / section). */
  style?: StyleProp<TextStyle>;
}

const INLINE_RE = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`(.+?)`/g;

/** Découpe une ligne sur **gras** / *italique* / _italique_ / `code` → <Text> imbriqués. */
function inline(text: string, base: StyleProp<TextStyle>, key: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  let i = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] != null) nodes.push(<Text key={`b${i}`} style={st.bold}>{m[1]}</Text>);
    else if (m[2] != null) nodes.push(<Text key={`i${i}`} style={st.italic}>{m[2]}</Text>);
    else if (m[3] != null) nodes.push(<Text key={`u${i}`} style={st.italic}>{m[3]}</Text>);
    else if (m[4] != null) nodes.push(<Text key={`c${i}`} style={st.code}>{m[4]}</Text>);
    last = INLINE_RE.lastIndex;
    i++;
  }
  if (nodes.length === 0) return <Text key={key} style={base}>{text}</Text>;
  if (last < text.length) nodes.push(text.slice(last));
  return <Text key={key} style={base}>{nodes}</Text>;
}

function stripBold(s: string): string { return s.replace(/[*`]/g, ''); }

export default function AiRichText({ text, style }: Props) {
  const lines = String(text ?? '').split('\n');
  const out: React.ReactNode[] = [];

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const key = `l${idx}`;
    const t = line.trim();

    if (!t) { out.push(<View key={key} style={st.blank} />); return; }

    // Séparateur horizontal (---, ***, ___) → filet discret.
    if (/^([-*_])\1{2,}$/.test(t)) { out.push(<View key={key} style={st.hr} />); return; }

    // Titre markdown (# … ####) → gras, sans les #.
    const title = t.match(/^#{1,4}\s+(.*)$/);
    if (title) { out.push(<Text key={key} style={[style, st.title]}>{stripBold(title[1])}</Text>); return; }

    // Citation (> …) → bloc avec filet à gauche, en atténué.
    const quote = t.match(/^>\s?(.*)$/);
    if (quote) {
      out.push(
        <View key={key} style={st.quoteRow}>
          <View style={st.quoteBar} />
          <View style={{ flex: 1 }}>{inline(quote[1], [style, st.quoteTxt], `${key}q`)}</View>
        </View>,
      );
      return;
    }

    // Liste numérotée (1. / 1) …).
    const num = t.match(/^(\d{1,2})[.)]\s+(.*)$/);
    if (num) {
      out.push(
        <View key={key} style={st.bulletRow}>
          <Text style={[style, st.numDot]}>{num[1]}.</Text>
          <View style={{ flex: 1 }}>{inline(num[2], style, `${key}t`)}</View>
        </View>,
      );
      return;
    }

    // Puce (-, •, *  suivi d'une espace). Le « * » d'une puce exige l'espace → pas confondu avec *italique*.
    const bullet = t.match(/^[-•*]\s+(.*)$/);
    if (bullet) {
      out.push(
        <View key={key} style={st.bulletRow}>
          <Text style={[style, st.bulletDot]}>•</Text>
          <View style={{ flex: 1 }}>{inline(bullet[1], style, `${key}t`)}</View>
        </View>,
      );
      return;
    }

    out.push(inline(line, style, key));
  });

  return <View>{out}</View>;
}

const st = StyleSheet.create({
  blank: { height: 8 },
  hr: { height: 1, backgroundColor: 'rgba(128,128,128,0.25)', marginVertical: 10, borderRadius: 1 },
  title: { fontWeight: '800', marginTop: 4, marginBottom: 2 },
  bold: { fontWeight: '800' },
  italic: { fontStyle: 'italic' },
  code: { fontWeight: '700' }, // backticks = mise en avant (souvent un montant), sans look « code »
  bulletRow: { flexDirection: 'row', gap: 7, paddingLeft: 2, marginVertical: 2 },
  bulletDot: { lineHeight: 20, opacity: 0.7 },
  numDot: { lineHeight: 20, fontWeight: '700', minWidth: 18 },
  quoteRow: { flexDirection: 'row', gap: 9, marginVertical: 3, paddingLeft: 2 },
  quoteBar: { width: 3, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.35)' },
  quoteTxt: { opacity: 0.85 },
});
