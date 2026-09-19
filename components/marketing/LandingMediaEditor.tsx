import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import type { LandingMedia as Media } from '../../hooks/config/useLandingConfig';
import LandingMedia from './LandingMedia';

export default function LandingMediaEditor({ label, media, onChange, onUpload, uploading, colors: c }: {
  label: string; media: Media; onChange: (patch: Partial<Media>) => void;
  onUpload: () => void; uploading: boolean; colors: { bg: string; text: string; textSecondary: string; cardBorder: string; emerald: string };
}) {
  const s = StyleSheet.create({
    root: { gap: 10, marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderColor: c.cardBorder },
    label: { color: c.text, fontSize: 13, fontWeight: '600' },
    hint: { color: c.textSecondary, fontSize: 12, lineHeight: 18 },
    input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 8, padding: 12, color: c.text, minHeight: 44 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    button: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 8, padding: 12, minHeight: 44 },
    preview: { height: 180, backgroundColor: c.bg, borderRadius: 10, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  });
  return <View style={s.root}>
    <Text style={s.label}>{label}</Text>
    <Text style={s.hint}>PNG, JPEG ou WebP. Vide : aperçu produit ou fond uni. Le voile colore uniquement l’image.</Text>
    <TextInput accessibilityLabel={`${label} : URL`} value={media.url} onChangeText={url => onChange({ url })} placeholder="https://…" placeholderTextColor={c.textSecondary} autoCapitalize="none" style={s.input} />
    <View style={s.row}>
      <TouchableOpacity accessibilityRole="button" disabled={uploading} onPress={onUpload} style={s.button}><Text style={s.label}>{uploading ? 'Téléversement…' : 'Importer une image'}</Text></TouchableOpacity>
      {!!media.url && <TouchableOpacity accessibilityRole="button" onPress={() => onChange({ url: '' })} style={s.button}><Text style={s.label}>Retirer</Text></TouchableOpacity>}
    </View>
    <View style={s.preview}><LandingMedia media={media} fallback={<Text style={s.hint}>Visuel de démonstration / fond uni</Text>} /></View>
    <Text style={s.label}>Description de l’image (accessibilité)</Text>
    <TextInput accessibilityLabel={`${label} : description`} value={media.alt} onChangeText={alt => onChange({ alt })} style={s.input} />
    <View style={s.row}>{([['contain', 'Image entière'], ['cover', 'Remplir / recadrer']] as const).map(([fit, text]) => <TouchableOpacity key={fit} accessibilityRole="button" accessibilityState={{ selected: media.fit === fit }} onPress={() => onChange({ fit })} style={[s.button, media.fit === fit && { borderColor: c.emerald }]}><Text style={s.label}>{text}</Text></TouchableOpacity>)}</View>
    <Text style={s.label}>Couleur du voile — #RRGGBB</Text>
    <TextInput accessibilityLabel={`${label} : couleur du voile`} value={media.overlay} onChangeText={overlay => onChange({ overlay })} autoCapitalize="none" maxLength={7} style={s.input} />
    {!/^#[0-9a-f]{6}$/i.test(media.overlay) && <Text style={s.hint}>Utilise six caractères hexadécimaux, par exemple #123B37.</Text>}
    <Text style={s.label}>Opacité du voile — {media.opacity} %</Text>
    <TextInput accessibilityLabel={`${label} : opacité de 0 à 100`} keyboardType="numeric" value={String(media.opacity)} onChangeText={v => { const n = Number(v.replace(',', '.')); if (Number.isFinite(n)) onChange({ opacity: Math.max(0, Math.min(100, n)) }); }} style={s.input} />
  </View>;
}
