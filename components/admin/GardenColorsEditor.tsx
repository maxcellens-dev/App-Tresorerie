/**
 * Couleurs du JARDIN dans le Style Editor : fond, cartes, textes, filets, bouton principal et
 * matières de l'arbre, réglables PAR MODE (clair / sombre). Chaque ligne : pastille (sélecteur),
 * code hex, « Défaut ». L'aperçu est calculé sans toucher aux couleurs actives (gardenThemeColors),
 * avec l'accent par défaut — ce que voit un utilisateur qui n'a pas choisi d'autre couleur.
 */
import { Platform, Pressable, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import GardenText from '../garden/GardenText';
import { GARDEN_COLORS as G, GARDEN_DEFAULTS, GARDEN_RADII, GARDEN_SPACE, gardenThemeColors, mergeGlow, GARDEN_GLOW_DEFAULTS, type GardenGlowConfig, type GardenOverrides, type GardenPaletteValues } from '../../lib/garden/theme';
import { GARDEN_FONTS as GF } from '../../lib/garden/fontFamilies';
import { pointer } from '../../lib/ui/webLayout';

type Mode = 'light' | 'dark';
type Key = keyof GardenPaletteValues;

const GROUPS: { title: string; hint?: string; keys: [Key, string][] }[] = [
  { title: 'Surfaces', keys: [['bg', 'Fond des pages'], ['card', 'Cartes'], ['field', 'Champs et zones douces'], ['track', 'Pistes (barres, segments)'], ['line', 'Filets et bordures']] },
  { title: 'Textes', keys: [['ink', 'Texte principal'], ['inkSoft', 'Texte secondaire'], ['muted', 'Texte discret']] },
  { title: 'Bouton principal', hint: "Laisse « Défaut » pour que la couleur d'accent choisie par chacun dans Apparence s'applique : une couleur fixée ici n'est remplacée que par un accent personnel.", keys: [['primary', 'Couleur du bouton'], ['onPrimary', 'Texte sur le bouton']] },
  { title: "Matières de l'arbre", hint: 'Une matière = une partie de l’arbre, partout dans l’app (comptes courants = eau, épargne = racines…).', keys: [['water', 'Eau (comptes courants)'], ['roots', 'Racines (épargne)'], ['branches', 'Branches (placements)'], ['fruits', 'Fruits'], ['flowers', 'Fleurs (projets)'], ['brambles', 'Ronces (dette)']] },
];

const isHex = (v: string) => /^#[0-9A-Fa-f]{6}$/.test(v);

/* Contraste WCAG : un texte courant doit atteindre 4,5:1 sur ce qui est derrière lui. */
const lum = (h: string) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** Les paires texte / fond que l'app affiche partout : chacune doit rester lisible. */
const PAIRS: [Key, Key, string][] = [
  ['ink', 'bg', 'Texte principal sur le fond'], ['ink', 'card', 'Texte principal sur les cartes'], ['ink', 'field', 'Texte principal dans les champs'],
  ['inkSoft', 'card', 'Texte secondaire sur les cartes'], ['muted', 'card', 'Texte discret sur les cartes'], ['muted', 'bg', 'Texte discret sur le fond'],
  ['onPrimary', 'primary', 'Texte du bouton principal'],
  ['waterText', 'card', 'Texte « eau » sur les cartes'], ['rootsText', 'card', 'Texte « racines » sur les cartes'], ['branchesText', 'card', 'Texte « branches » sur les cartes'], ['fruitsText', 'card', 'Texte « fruits » sur les cartes'],
];

export default function GardenColorsEditor({ mode, onModeChange, value, onChange, glowValue, onGlowChange, onPickColor }: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  /** Surcharges en cours d'édition, par mode (saisies brutes : peuvent être invalides). */
  value: Record<Mode, Record<string, string>>;
  onChange: (next: Record<Mode, Record<string, string>>) => void;
  /** Dégradé du haut des pages, par mode (vide = réglages par défaut). */
  glowValue: Record<Mode, Partial<GardenGlowConfig>>;
  onGlowChange: (next: Record<Mode, Partial<GardenGlowConfig>>) => void;
  onPickColor: (initial: string, onPick: (hex: string) => void) => void;
}) {
  const cur = value[mode] ?? {};
  const defaults = GARDEN_DEFAULTS[mode];
  const valid: GardenOverrides = Object.fromEntries(Object.entries(cur).filter(([, v]) => isHex(v)));
  const glowRaw = glowValue[mode] ?? {};
  const glow = mergeGlow(mode, glowRaw);
  const setGlow = (patch: Partial<GardenGlowConfig>) => onGlowChange({ ...glowValue, [mode]: { ...glowRaw, ...patch } });
  const P = gardenThemeColors(mode, null, valid, glowRaw);
  const set = (k: Key, v: string | null) => {
    const nextMode = { ...cur };
    if (v == null) delete nextMode[k]; else nextMode[k] = v;
    onChange({ ...value, [mode]: nextMode });
  };
  const changed = Object.keys(valid).length;
  const unreadable = PAIRS.map(([t, b, l]) => ({ l, r: contrast(P[t], P[b]) })).filter((x) => x.r < 4.5);

  return (
    <View style={{ gap: GARDEN_SPACE.lg }}>
      {/* Mode édité */}
      <View style={{ flexDirection: 'row', backgroundColor: G.track, borderRadius: GARDEN_RADII.pill, padding: 4 }}>
        {(['light', 'dark'] as const).map((m) => (
          <Pressable key={m} onPress={() => onModeChange(m)} accessibilityRole="button" accessibilityState={{ selected: mode === m }}
            style={[{ flex: 1, minHeight: 40, borderRadius: GARDEN_RADII.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: mode === m ? G.card : 'transparent' }, pointer]}>
            <Ionicons name={m === 'light' ? 'sunny-outline' : 'moon-outline'} size={16} color={mode === m ? G.ink : G.muted} />
            <GardenText variant="bodyStrong" color={mode === m ? G.ink : G.muted}>{m === 'light' ? 'Jardin de jour' : 'Jardin de nuit'}</GardenText>
          </Pressable>
        ))}
      </View>

      {/* Des couleurs enregistrées REMPLACENT celles par défaut : sans ce bandeau, on croyait voir la
          palette de l'app alors qu'on voyait ses propres essais. */}
      {changed ? (
        <View style={{ backgroundColor: G.notice, borderRadius: GARDEN_RADII.md, padding: GARDEN_SPACE.md, gap: GARDEN_SPACE.sm }}>
          <GardenText variant="bodyStrong" color={G.noticeText}>{changed} couleur{changed > 1 ? 's' : ''} personnalisée{changed > 1 ? 's' : ''} pour le {mode === 'light' ? 'Jardin de jour' : 'Jardin de nuit'}</GardenText>
          <GardenText variant="small" color={G.noticeText}>Elles remplacent la palette par défaut de l'app. Pour retrouver celle-ci, remets tout par défaut puis appuie sur « Appliquer les changements ».</GardenText>
          <Pressable onPress={() => onChange({ ...value, [mode]: {} })} accessibilityRole="button"
            style={[{ alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 999, backgroundColor: G.primary }, pointer]}>
            <GardenText variant="bodyStrong" color={G.onPrimary}>Revenir à la palette par défaut</GardenText>
          </Pressable>
        </View>
      ) : (
        <GardenText variant="small" color={G.muted}>Palette par défaut de l'app : aucune couleur personnalisée pour ce mode.</GardenText>
      )}

      {/* Aperçu */}
      <View style={{ borderRadius: GARDEN_RADII.lg, backgroundColor: P.bg, padding: GARDEN_SPACE.lg, gap: GARDEN_SPACE.md, borderWidth: 1, borderColor: P.line, overflow: 'hidden' }}>
        {P.glow !== P.bg ? <LinearGradient pointerEvents="none" colors={[P.glow, P.bg]} locations={[0, 0.6]} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: Math.min(glow.height, 420) }} /> : null}
        <GardenText variant="label" color={P.muted}>Aperçu</GardenText>
        <View style={{ backgroundColor: P.card, borderRadius: 22, borderWidth: 1, borderColor: P.line, padding: GARDEN_SPACE.lg, gap: 6 }}>
          <GardenText variant="label" color={P.inkSoft}>Tout ce que tu as</GardenText>
          <GardenText variant="title" color={P.ink}>12 351 €</GardenText>
          <GardenText variant="small" color={P.muted}>Texte discret · mis à jour aujourd’hui</GardenText>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: P.track, overflow: 'hidden', marginTop: 4 }}>
            <View style={{ width: '62%', height: 8, backgroundColor: P.branches }} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {([['water', 'Eau'], ['roots', 'Racines'], ['branches', 'Branches'], ['fruits', 'Fruits'], ['flowers', 'Fleurs']] as const).map(([k, l]) => (
              <View key={k} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: P[`${k}Bg` as Key] }}>
                <GardenText variant="smallStrong" color={P[`${k}Text` as Key]}>{l}</GardenText>
              </View>
            ))}
          </View>
        </View>
        <View style={{ backgroundColor: P.field, borderRadius: 16, borderWidth: 1, borderColor: P.line, paddingHorizontal: 14, minHeight: 46, justifyContent: 'center' }}>
          <GardenText variant="body" color={P.muted}>Un champ de saisie…</GardenText>
        </View>
        <View style={{ backgroundColor: P.primary, borderRadius: 999, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
          <GardenText variant="bodyStrong" color={P.onPrimary}>Bouton principal</GardenText>
        </View>
      </View>

      {unreadable.length ? (
        <View style={{ backgroundColor: G.notice, borderRadius: GARDEN_RADII.md, padding: GARDEN_SPACE.md, gap: 4 }}>
          <GardenText variant="bodyStrong" color={G.noticeText}>Attention : certains textes deviennent difficiles à lire</GardenText>
          {unreadable.map((x) => <GardenText key={x.l} variant="small" color={G.noticeText}>• {x.l} : contraste {x.r.toFixed(1).replace('.', ',')}:1 (il faut au moins 4,5:1)</GardenText>)}
        </View>
      ) : (
        <GardenText variant="small" color={G.muted}>Tous les textes restent lisibles avec ces couleurs.</GardenText>
      )}

      {/* ── Dégradé du haut des pages (l'ancien « dégradé de fond ») ── */}
      <View style={{ gap: GARDEN_SPACE.sm }}>
        <GardenText variant="label">Dégradé du haut des pages</GardenText>
        <GardenText variant="small" color={G.muted}>Une couleur descend du haut de chaque page et se fond dans le fond. Par défaut : la couleur d'accent de chacun. Désactivé, le fond est uni.</GardenText>
        <View style={{ borderRadius: GARDEN_RADII.md, borderWidth: 1, borderColor: G.line, backgroundColor: G.card, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', backgroundColor: G.track, borderRadius: GARDEN_RADII.pill, padding: 4, margin: GARDEN_SPACE.md }}>
            {([true, false] as const).map((on) => (
              <Pressable key={String(on)} onPress={() => setGlow({ enabled: on })} accessibilityRole="button" accessibilityState={{ selected: glow.enabled === on }}
                style={[{ flex: 1, minHeight: 38, borderRadius: GARDEN_RADII.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: glow.enabled === on ? G.card : 'transparent' }, pointer]}>
                <GardenText variant="bodyStrong" color={glow.enabled === on ? G.ink : G.muted}>{on ? 'Activé' : 'Désactivé'}</GardenText>
              </Pressable>
            ))}
          </View>
          {glow.enabled ? (
            <>
              <Slider label="Intensité" unit="%" value={glow.strength} min={0} max={60} step={1} onChange={(v) => setGlow({ strength: v })} />
              <Slider label="Hauteur" unit="px" value={glow.height} min={160} max={1000} step={20} onChange={(v) => setGlow({ height: v })} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, paddingHorizontal: GARDEN_SPACE.md, paddingVertical: 10, borderTopWidth: 1, borderTopColor: G.line }}>
                <Pressable onPress={() => onPickColor(cur.glow && isHex(cur.glow) ? cur.glow : P.primary, (hex) => set('glow', hex.toUpperCase()))} accessibilityRole="button" accessibilityLabel="Choisir la couleur du dégradé"
                  style={[{ width: 36, height: 36, borderRadius: 18, backgroundColor: cur.glow && isHex(cur.glow) ? cur.glow : P.primary, borderWidth: 1, borderColor: G.line }, pointer]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <GardenText variant="bodyStrong">Couleur du dégradé</GardenText>
                  <GardenText variant="small" color={G.muted}>{cur.glow ? 'personnalisée' : "celle de l'accent de chacun"}</GardenText>
                </View>
                <Pressable onPress={() => set('glow', null)} disabled={!cur.glow} accessibilityRole="button" accessibilityLabel="Revenir à la couleur d'accent" hitSlop={8} style={pointer}>
                  <Ionicons name="refresh-outline" size={20} color={cur.glow ? G.primary : G.line} />
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
        {Object.keys(glowRaw).length ? (
          <Pressable onPress={() => onGlowChange({ ...glowValue, [mode]: {} })} accessibilityRole="button" style={[{ alignSelf: 'flex-start', paddingVertical: 6 }, pointer]}>
            <GardenText variant="smallStrong" color={G.primary}>Dégradé par défaut ({GARDEN_GLOW_DEFAULTS[mode].enabled ? `activé, ${GARDEN_GLOW_DEFAULTS[mode].strength} %` : 'désactivé'})</GardenText>
          </Pressable>
        ) : null}
      </View>

      {GROUPS.map((g) => (
        <View key={g.title} style={{ gap: GARDEN_SPACE.sm }}>
          <GardenText variant="label">{g.title}</GardenText>
          {g.hint ? <GardenText variant="small" color={G.muted}>{g.hint}</GardenText> : null}
          <View style={{ borderRadius: GARDEN_RADII.md, borderWidth: 1, borderColor: G.line, backgroundColor: G.card, overflow: 'hidden' }}>
            {g.keys.map(([k, label], i) => {
              const raw = cur[k] ?? '';
              const isSet = raw !== '';
              const ok = !isSet || isHex(raw);
              const shown = isSet && isHex(raw) ? raw.toUpperCase() : defaults[k];
              return (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, paddingHorizontal: GARDEN_SPACE.md, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: G.line }}>
                  <Pressable onPress={() => onPickColor(shown, (hex) => set(k, hex.toUpperCase()))} accessibilityRole="button" accessibilityLabel={`Choisir : ${label}`}
                    style={[{ width: 36, height: 36, borderRadius: 18, backgroundColor: shown, borderWidth: 1, borderColor: G.line }, pointer]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <GardenText variant="bodyStrong" numberOfLines={1}>{label}</GardenText>
                    <GardenText variant="small" color={G.muted}>{isSet ? 'personnalisée' : `défaut · ${defaults[k]}`}</GardenText>
                  </View>
                  <TextInput value={raw} onChangeText={(v) => set(k, v.trim() === '' ? null : v.trim())} placeholder={defaults[k]} placeholderTextColor={G.muted}
                    maxLength={7} autoCapitalize="characters" autoCorrect={false}
                    style={{ width: 92, minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: ok ? G.line : G.fruitsText, backgroundColor: G.field, color: G.ink, textAlign: 'center', fontFamily: GF.bodyBold, fontSize: 13 }} />
                  <Pressable onPress={() => set(k, null)} disabled={!isSet} accessibilityRole="button" accessibilityLabel={`Revenir au défaut : ${label}`} hitSlop={8} style={pointer}>
                    <Ionicons name="refresh-outline" size={20} color={isSet ? G.primary : G.line} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      ))}

    </View>
  );
}

/** Réglage numérique : curseur sur le web, boutons − / + partout. */
function Slider({ label, unit, value, min, max, step, onChange }: { label: string; unit: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const btn = (d: number, icon: 'remove' | 'add') => (
    <Pressable onPress={() => onChange(clamp(value + d))} accessibilityRole="button" accessibilityLabel={`${label} ${d > 0 ? 'plus' : 'moins'}`} hitSlop={6}
      style={[{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: G.field, borderWidth: 1, borderColor: G.line }, pointer]}>
      <Ionicons name={icon} size={18} color={G.ink} />
    </Pressable>
  );
  return (
    <View style={{ paddingHorizontal: GARDEN_SPACE.md, paddingVertical: 10, borderTopWidth: 1, borderTopColor: G.line, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
        <GardenText variant="bodyStrong" style={{ flex: 1 }}>{label}</GardenText>
        {btn(-step * (unit === 'px' ? 1 : 1), 'remove')}
        <GardenText variant="bodyStrong" tabular style={{ minWidth: 64, textAlign: 'center' }}>{value} {unit}</GardenText>
        {btn(step, 'add')}
      </View>
      {Platform.OS === 'web' ? (
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e: any) => onChange(clamp(Number(e.target.value)))}
          style={{ width: '100%', cursor: 'pointer', accentColor: G.primary } as any} />
      ) : null}
    </View>
  );
}
