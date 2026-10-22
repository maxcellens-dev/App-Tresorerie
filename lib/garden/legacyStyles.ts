/**
 * Habillage Jardin des ANCIENS écrans (Succès, Boutique, Plan, Aide…) : quelques briques communes
 * pour que chaque écran surcharge ses propres styles sans être réécrit.
 *
 * Règle des polices : chaque graisse est une FAMILLE et `fontWeight` reste à 'normal' — sinon
 * Android retombe sur Roboto (même piège que la police du nom de l'app).
 */
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { GARDEN_COLORS as G } from './theme';
import { GARDEN_FONTS as GF } from './fontFamilies';
import { live } from './live';

export const gFont = (w: 'body' | 'bodyBold' | 'bodyHeavy' | 'display'): TextStyle => ({ fontFamily: GF[w], fontWeight: 'normal' });

export const gCard: ViewStyle = live(() => ({
  backgroundColor: G.card, borderRadius: 24, borderWidth: 1, borderColor: G.line,
  shadowColor: '#1E3A2C', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
} as ViewStyle));

export const gLabel: TextStyle = live(() => ({ ...gFont('bodyHeavy'), fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: G.inkSoft } as TextStyle));

/** Fusionne les surcharges Jardin par-dessus les styles d'origine (mêmes clés). */
export function withGarden<T extends Record<string, any>>(base: T, overrides: Partial<Record<keyof T, ViewStyle | TextStyle>>): T {
  return { ...base, ...StyleSheet.create(overrides as any) } as T;
}

/**
 * Habillage Jardin GÉNÉRIQUE des écrans de saisie (opération, solde, compte…) : les mêmes noms de
 * styles reviennent d'un écran à l'autre (`label`, `input`, `chip`, `toggleBtn`, `btn`…). Pour chaque
 * clé PRÉSENTE dans l'écran, on garde sa mise en page et on remplace l'habillage : champs arrondis,
 * pastilles et segments en pilule, bouton principal plein, polices du Jardin.
 */
export function gardenFormStyles<T extends Record<string, any>>(base: T): T {
  const o: Record<string, any> = {};
  const set = (keys: string[], v: Record<string, any>) => keys.forEach((k) => { if (k in base) o[k] = { ...(base as any)[k], ...v }; });
  /* Clés à risque (« container », « btn », « card ») : on ne les rhabille que si l'écran en fait
     vraiment une surface pleine — un « container » de mise en page ne doit pas devenir une carte. */
  const filled = (k: string) => { const b = (base as any)[k]; return !!b && !!b.backgroundColor && b.backgroundColor !== 'transparent'; };
  const setFilled = (keys: string[], v: Record<string, any>) => set(keys.filter(filled), v);
  const card = { backgroundColor: G.card, borderRadius: 22, borderWidth: 1, borderColor: G.line };
  set(['root'], { backgroundColor: G.bg });
  set(['title', 'stepTitle', 'summaryTitle', 'confirmTitle'], { ...gFont('display'), color: G.ink });
  set(['label', 'sectionLabel', 'sectionTitle', 'dateLabel'], { ...gLabel, marginBottom: 8 });
  set(['input', 'dateInput', 'dropdownField', 'dateField', 'readOnlyInput'], { backgroundColor: G.card, borderColor: G.line, borderWidth: 1, borderRadius: 16, minHeight: 50, color: G.ink, fontFamily: GF.body, fontWeight: 'normal' });
  set(['lockedField'], { backgroundColor: G.field, borderColor: G.line, borderRadius: 16 });
  set(['inputError', 'dateInputError'], { borderColor: G.fruitsText });
  set(['chip', 'periodChip', 'badge'], { borderRadius: 999, borderColor: G.line, backgroundColor: G.card });
  set(['chipActive'], { borderColor: G.primary, backgroundColor: G.branchesBg });
  set(['chipText', 'periodChipText', 'lockedFieldText', 'readOnlyText', 'dropdownText', 'dateText', 'dropdownOptionLabel'], { ...gFont('bodyBold'), color: G.ink });
  set(['chipTextActive'], { ...gFont('bodyHeavy'), color: G.primary });
  set(['toggle', 'toggleRow'], { backgroundColor: G.track, borderRadius: 999, padding: 4, borderWidth: 0 });
  set(['recurringToggle'], { backgroundColor: G.card, borderColor: G.line, borderWidth: 1, borderRadius: 16, minHeight: 54 });
  set(['recurringToggleActive'], { backgroundColor: G.branchesBg, borderColor: G.primary });
  set(['recurringLabel'], { ...gFont('bodyBold'), color: G.ink, flexShrink: 1 });
  set(['recurringLabelActive'], { ...gFont('bodyHeavy'), color: G.primary });
  set(['recurringCheck'], { borderColor: G.line, backgroundColor: G.card });
  set(['recurringCheckOn'], { borderColor: G.primary, backgroundColor: G.primary });
  set(['toggleBtn', 'typeBtn', 'instanceModeBtn'], { borderRadius: 999, borderWidth: 0, backgroundColor: 'transparent' });
  set(['toggleBtnActive', 'typeBtnActive', 'instanceModeBtnActive'], { backgroundColor: G.card, shadowColor: '#1E3A2C', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 });
  set(['toggleLabel', 'typeBtnLabel', 'instanceModeLabel'], { ...gFont('bodyBold'), color: G.inkSoft });
  set(['toggleLabelActive', 'typeBtnLabelActive', 'instanceModeLabelActive'], { ...gFont('bodyHeavy'), color: G.ink });
  setFilled(['btn', 'cta', 'confirmOk'], { backgroundColor: G.primary, borderColor: G.primary, borderRadius: 999, minHeight: 52, justifyContent: 'center' });
  (['btnLabel', 'ctaLabel', 'confirmOkText'] as const).forEach((k, i) => { const btn = ['btn', 'cta', 'confirmOk'][i]; if (k in base && filled(btn)) o[k] = { ...(base as any)[k], ...gFont('bodyHeavy'), color: G.onPrimary }; });
  set(['confirmCancel'], { backgroundColor: G.card, borderColor: G.line, borderRadius: 999 });
  set(['confirmCancelText', 'deleteLabel'], { ...gFont('bodyHeavy') });
  setFilled(['card', 'dateCard', 'summary', 'withdrawCard', 'recurringSection', 'projectSection', 'futureBlock'], card);
  setFilled(['container', 'confirmBox', 'calSheet', 'calendarContainer', 'sheet', 'modal', 'modalCard', 'panel'], { backgroundColor: G.bg, borderRadius: 28, borderWidth: 0 });
  set(['cardName', 'withdrawTitle', 'refundLabel', 'defaultLabel'], { ...gFont('bodyBold'), color: G.ink });
  set(['hint', 'helperText', 'lede', 'dateHint', 'refundHint', 'defaultHint', 'infoText', 'summaryText', 'withdrawText', 'projectHint', 'gapText', 'emptyText', 'text', 'foot', 'confirmMessage', 'recScopeHint'], { ...gFont('body'), color: G.inkSoft });
  set(['errorBanner', 'warningBanner', 'gapBox'], { backgroundColor: G.notice, borderColor: G.notice, borderRadius: 16 });
  set(['errorBannerText', 'warningText'], { ...gFont('bodyBold'), color: G.noticeText });
  set(['unit', 'known'], { ...gFont('bodyBold'), color: G.inkSoft });
  set(['prevLinkText'], { ...gFont('bodyBold'), color: G.primary });
  return withGarden(base, o as any);
}
