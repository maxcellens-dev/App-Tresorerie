/**
 * AiRichText — rendu LÉGER du texte des réponses IA (Conseils IA).
 * Supporte uniquement ce que les prompts demandent : **gras** en ligne, listes à puces
 * (lignes commençant par -, •, *), petits titres markdown (## / ###, affichés en gras sans les #).
 * Tout le reste est affiché tel quel — pas de lib markdown (léger, déterministe).
 */
import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';

interface Props {
  text: string;
  /** Style de base du texte (celui de la bulle). */
  style?: StyleProp<TextStyle>;
}

/** Découpe une ligne sur les segments **gras** → <Text> imbriqués. */
function inline(line: string, base: StyleProp<TextStyle>, key: string) {
  const parts = line.split(/\*\*(.+?)\*\*/g); // pairs : impair = gras
  if (parts.length === 1) return <Text key={key} style={base}>{line}</Text>;
  return (
    <Text key={key} style={base}>
      {parts.map((p, i) => (i % 2 === 1 ? <Text key={i} style={{ fontWeight: '800' }}>{p}</Text> : p))}
    </Text>
  );
}

export default function AiRichText({ text, style }: Props) {
  const lines = String(text ?? '').split('\n');
  const out: React.ReactNode[] = [];
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const key = `l${idx}`;
    if (!line.trim()) { out.push(<View key={key} style={st.blank} />); return; }
    const title = line.match(/^#{1,4}\s+(.*)$/);
    if (title) {
      out.push(<Text key={key} style={[style, st.title]}>{stripBold(title[1])}</Text>);
      return;
    }
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
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

function stripBold(s: string): string { return s.replace(/\*\*/g, ''); }

const st = StyleSheet.create({
  blank: { height: 8 },
  title: { fontWeight: '800', marginTop: 2 },
  bulletRow: { flexDirection: 'row', gap: 6, paddingLeft: 2, marginVertical: 1 },
  bulletDot: { lineHeight: 19 },
});
