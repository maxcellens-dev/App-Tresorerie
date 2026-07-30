/**
 * Police du nom de l'app (titre/logo), configurable en admin (Style Editor).
 * Repli sur « Arial Rounded MT Bold » si rien n'est défini.
 *
 * Sur NATIF, une police IMPORTÉE doit être chargée (expo-font) AVANT que fontFamily ne s'applique.
 * On s'abonne à la version des polices natives → dès que la police du nom est chargée, ce hook
 * re-rend ses consommateurs (welcome, questionnaire…) pour que la police s'affiche enfin.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useStyleConfig } from './useStyleConfig';
import { ensureNativeFonts, useNativeFontsVersion, isNativeFontReady } from '../lib/nativeFonts';

/**
 * Props à étaler sur un <Text> qui affiche le NOM de l'app. Sur WEB, pose l'attribut `data-appfont`
 * → FontApplier EXCLUT ces éléments de la police globale du TEXTE (sinon son `!important` écraserait
 * la police du nom). Sur natif : aucun effet (la police du nom s'applique via fontFamily direct).
 */
export const APP_NAME_TEXT_PROPS: any = Platform.OS === 'web' ? { dataSet: { appfont: '1' } } : {};

export function useAppNameFont(): string {
  const { data } = useStyleConfig();
  useNativeFontsVersion(); // re-render quand une police importée finit de charger → fontFamily s'applique
  // Charge les polices importées si besoin (idempotent) — indépendant de FontApplier.
  useEffect(() => {
    const cf = data?.custom_fonts ?? [];
    if (cf.length) ensureNativeFonts(cf as any);
  }, [data?.custom_fonts]);
  const f = data?.app_name_font?.trim();
  // On renvoie TOUJOURS la vraie famille : tant qu'elle n'est pas chargée sur natif, le système sert de
  // repli (aucun « tofu » pour du texte) ; dès qu'elle charge, le re-render ci-dessus l'applique.
  return f && f.length > 0 ? f : 'Arial Rounded MT Bold';
}

/**
 * Style complet à poser sur un <Text> qui affiche le NOM de l'app : famille + neutralisation du gras
 * sur natif pour les polices IMPORTÉES.
 *
 * Pourquoi neutraliser le gras : expo-font enregistre une police téléversée au seul style NORMAL
 * (`ReactFontManager.setTypeface(famille, Typeface.NORMAL, …)`). Si le <Text> demande un poids ≥ 700,
 * Android cherche un slot « bold » inexistant pour cette famille → repli silencieux sur la police
 * système (Roboto). On rend donc la police importée à son poids naturel (`fontWeight: 'normal'`) —
 * elle est déjà grasse par construction (« ITCErasStd Bold », « Barlow Black »…). Sur web, le gras est
 * synthétisé par le navigateur : on n'y touche pas. Pour la police système par défaut (non importée),
 * on laisse aussi le style d'origine (le gras système est voulu).
 *
 * À placer EN DERNIER dans le tableau de styles pour écraser le `fontWeight` du style de base :
 *   <Text {...APP_NAME_TEXT_PROPS} style={[styles.brand, appNameFontStyle]}>Relyka</Text>
 */
export function useAppNameFontStyle(): { fontFamily: string; fontWeight?: 'normal' } {
  const fontFamily = useAppNameFont();
  const { data } = useStyleConfig();
  const selected = data?.app_name_font?.trim();
  const isImported = !!selected && (data?.custom_fonts ?? []).some((cf) => cf.family === selected);
  return Platform.OS !== 'web' && isImported ? { fontFamily, fontWeight: 'normal' } : { fontFamily };
}

/**
 * La police du nom est-elle DÉJÀ posée, ou le texte va-t-il changer d'aspect sous les yeux ?
 *
 * Sur natif, une police importée se charge en asynchrone : le texte s'affiche d'abord avec la police
 * système, puis SAUTE quand `ensureNativeFonts` termine (cf. useNativeFontsVersion). Sur un écran de
 * marque (accueil), ce saut se voit — surtout à la déconnexion, où plus aucun splash ne le couvre.
 * Les écrans concernés s'en servent pour ne RÉVÉLER leur contenu qu'une fois la police en place.
 *
 * Renvoie `true` sur WEB (le navigateur gère le remplacement via `font-display`).
 *
 * ⚠️ Renvoie `false` tant que la config de style n'est pas LUE : c'est précisément l'état de la
 * déconnexion (`queryClient.clear()` vide le cache) et du démarrage à froid — le nom s'affiche
 * alors avec la police de repli, puis saute dès que la config arrive. « Pas encore su » n'est donc
 * pas « rien à attendre ». C'est à l'APPELANT de borner cette attente (aucune config lisible
 * hors-ligne → sans plafond, l'écran ne s'afficherait jamais).
 */
export function useAppNameFontReady(): boolean {
  const { data } = useStyleConfig();
  useNativeFontsVersion(); // re-render dès qu'une police importée finit de charger
  if (Platform.OS === 'web') return true;
  if (data === undefined) return false; // config inconnue → on ne sait pas encore quelle police sortira
  const selected = data.app_name_font?.trim();
  const isImported = !!selected && (data.custom_fonts ?? []).some((cf) => cf.family === selected);
  if (!isImported) return true; // police système : appliquée dès la première frame
  return isNativeFontReady(selected);
}
