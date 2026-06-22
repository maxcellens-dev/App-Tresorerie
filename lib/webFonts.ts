/**
 * Polices Google chargeables à la demande sur le WEB (clé = nom EXACT de la famille, tel que
 * stocké dans app_config.font_family / app_name_font et utilisé dans `font-family`).
 * Sur natif, ces polices ne sont pas embarquées (repli système) — voir FontApplier (no-op natif).
 */
export const GOOGLE_FONTS: Record<string, string> = {
  'Inter': 'https://fonts.googleapis.com/css2?family=Inter:wght@400..800&display=swap',
  'DM Sans': 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400..800&display=swap',
  'Plus Jakarta Sans': 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400..800&display=swap',
};

/**
 * Injecte (web uniquement) les feuilles Google Fonts demandées dans un <style> identifié par `id`.
 * Les entrées inconnues sont ignorées ; si aucune n'est connue, le <style> est retiré.
 */
export function injectGoogleFonts(id: string, families: (string | null | undefined)[]): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(id) as HTMLStyleElement | null;
  const urls = Array.from(
    new Set(
      families
        .filter((f): f is string => !!f && !!GOOGLE_FONTS[f])
        .map((f) => GOOGLE_FONTS[f]),
    ),
  );
  if (urls.length === 0) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  const next = urls.map((u) => `@import url('${u}');`).join('\n');
  if (el.textContent !== next) el.textContent = next;
}
