/**
 * SEO — schéma de configuration + application au <head> côté WEB.
 *
 * La config (app_config.seo) est éditée dans l'admin « SEO Center » et appliquée au document par
 * `applySeoHead` (composant SeoHead, monté à la racine web). Cela couvre le titre, la description,
 * les balises Open Graph / Twitter, la canonical, robots, les codes de vérification et un bloc
 * JSON-LD (Organization + WebSite).
 *
 * NB : l'app web est un SPA (export statique) → l'injection runtime profite aux navigateurs et aux
 * crawlers qui exécutent le JS (Google). Pour les aperçus sociaux (scrapers sans JS), garder aussi
 * des valeurs de base dans app/+html.tsx.
 */
import { Platform } from 'react-native';

export interface SeoPageOverride { title?: string; description?: string }

export interface SeoConfig {
  // Général
  siteName: string;
  titleDefault: string;
  titleTemplate: string; // ex. "%s · Relyka" (%s = titre de page)
  description: string;
  keywords: string;
  canonicalBase: string; // ex. https://relyka.app (sans / final)
  language: string;      // ex. fr
  author: string;
  themeColor: string;    // #RRGGBB
  // Robots
  index: boolean;
  follow: boolean;
  // Open Graph
  ogType: string;        // website
  ogImage: string;       // URL absolue
  ogImageAlt: string;
  // Twitter / X
  twitterCard: string;   // summary_large_image | summary
  twitterSite: string;   // @compte
  twitterCreator: string;
  // Réseaux (→ sameAs du JSON-LD)
  social: { twitter: string; facebook: string; instagram: string; linkedin: string; youtube: string };
  // Vérification de propriété
  verifyGoogle: string;
  verifyBing: string;
  // Organisation (JSON-LD)
  orgName: string;
  orgLogo: string; // URL du logo
  // Surcharges par page (clé libre : 'landing', 'app', …)
  pages: Record<string, SeoPageOverride>;
}

export const SEO_DEFAULTS: SeoConfig = {
  siteName: 'Relyka',
  titleDefault: 'Relyka — Pilote ta trésorerie personnelle',
  titleTemplate: '%s · Relyka',
  description: "Relyka t'aide à piloter ta trésorerie au quotidien : reste à vivre, projections, épargne et investissement, en toute sérénité.",
  keywords: 'trésorerie, budget, finances personnelles, épargne, investissement, reste à vivre',
  canonicalBase: 'https://relyka.app',
  language: 'fr',
  author: 'Relyka',
  themeColor: '#0D2E2A',
  index: true,
  follow: true,
  ogType: 'website',
  ogImage: '',
  ogImageAlt: 'Relyka — pilote ta trésorerie',
  twitterCard: 'summary_large_image',
  twitterSite: '',
  twitterCreator: '',
  social: { twitter: '', facebook: '', instagram: '', linkedin: '', youtube: '' },
  verifyGoogle: '',
  verifyBing: '',
  orgName: 'Relyka',
  orgLogo: '',
  pages: {},
};

/** Fusionne une config admin (partielle) avec les défauts. */
export function resolveSeoConfig(admin?: Partial<SeoConfig> | null): SeoConfig {
  const a = admin ?? {};
  return {
    ...SEO_DEFAULTS,
    ...a,
    social: { ...SEO_DEFAULTS.social, ...(a.social ?? {}) },
    pages: { ...(a.pages ?? {}) },
  };
}

/** Titre effectif d'une page : surcharge éventuelle appliquée au gabarit, sinon titre par défaut. */
export function seoTitleFor(cfg: SeoConfig, page?: string): string {
  const override = page ? cfg.pages?.[page]?.title : undefined;
  if (!override) return cfg.titleDefault;
  return cfg.titleTemplate.includes('%s') ? cfg.titleTemplate.replace('%s', override) : override;
}

/** Description effective d'une page. */
export function seoDescriptionFor(cfg: SeoConfig, page?: string): string {
  return (page ? cfg.pages?.[page]?.description : undefined) || cfg.description;
}

/** URL canonique (base + chemin courant), ou base seule si indisponible. */
function canonicalUrl(cfg: SeoConfig): string {
  const base = (cfg.canonicalBase || '').replace(/\/$/, '');
  if (Platform.OS !== 'web' || typeof window === 'undefined') return base;
  try { return base + window.location.pathname; } catch { return base; }
}

/** Construit le JSON-LD (Organization + WebSite). */
export function buildJsonLd(cfg: SeoConfig): object[] {
  const sameAs = Object.values(cfg.social).map((s) => (s || '').trim()).filter(Boolean);
  const org: any = { '@context': 'https://schema.org', '@type': 'Organization', name: cfg.orgName || cfg.siteName };
  if (cfg.canonicalBase) org.url = cfg.canonicalBase;
  if (cfg.orgLogo) org.logo = cfg.orgLogo;
  if (sameAs.length) org.sameAs = sameAs;
  const site: any = { '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.siteName };
  if (cfg.canonicalBase) site.url = cfg.canonicalBase;
  return [org, site];
}

// ── Application au <head> (web uniquement) ───────────────────────────────────
// Toutes les balises gérées portent data-seo="1" → réappliquer remplace proprement.

function upsertMeta(selector: string, attrs: Record<string, string>) {
  const head = document.head;
  let el = head.querySelector(selector) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('data-seo', '1');
    head.appendChild(el);
  }
  Object.entries(attrs).forEach(([k, v]) => el!.setAttribute(k, v));
}

function upsertLink(rel: string, href: string) {
  const head = document.head;
  let el = head.querySelector(`link[rel="${rel}"][data-seo="1"]`) as HTMLLinkElement | null;
  if (!href) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('link'); el.setAttribute('rel', rel); el.setAttribute('data-seo', '1'); head.appendChild(el); }
  el.setAttribute('href', href);
}

/** Applique la config SEO au document (no-op hors web). */
export function applySeoHead(cfg: SeoConfig, page?: string): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;

  const title = seoTitleFor(cfg, page);
  const description = seoDescriptionFor(cfg, page);
  const url = canonicalUrl(cfg);
  const robots = `${cfg.index ? 'index' : 'noindex'},${cfg.follow ? 'follow' : 'nofollow'}`;

  document.title = title;
  try { document.documentElement.lang = cfg.language || 'fr'; } catch {}

  upsertMeta('meta[name="description"][data-seo="1"]', { name: 'description', content: description });
  upsertMeta('meta[name="keywords"][data-seo="1"]', { name: 'keywords', content: cfg.keywords });
  upsertMeta('meta[name="author"][data-seo="1"]', { name: 'author', content: cfg.author });
  upsertMeta('meta[name="theme-color"][data-seo="1"]', { name: 'theme-color', content: cfg.themeColor });
  upsertMeta('meta[name="robots"][data-seo="1"]', { name: 'robots', content: robots });
  upsertLink('canonical', url);

  // Open Graph
  upsertMeta('meta[property="og:title"][data-seo="1"]', { property: 'og:title', content: title });
  upsertMeta('meta[property="og:description"][data-seo="1"]', { property: 'og:description', content: description });
  upsertMeta('meta[property="og:type"][data-seo="1"]', { property: 'og:type', content: cfg.ogType || 'website' });
  upsertMeta('meta[property="og:site_name"][data-seo="1"]', { property: 'og:site_name', content: cfg.siteName });
  upsertMeta('meta[property="og:locale"][data-seo="1"]', { property: 'og:locale', content: (cfg.language || 'fr') + '_' + (cfg.language || 'fr').toUpperCase() });
  if (url) upsertMeta('meta[property="og:url"][data-seo="1"]', { property: 'og:url', content: url });
  if (cfg.ogImage) {
    upsertMeta('meta[property="og:image"][data-seo="1"]', { property: 'og:image', content: cfg.ogImage });
    upsertMeta('meta[property="og:image:alt"][data-seo="1"]', { property: 'og:image:alt', content: cfg.ogImageAlt });
  }

  // Twitter / X
  upsertMeta('meta[name="twitter:card"][data-seo="1"]', { name: 'twitter:card', content: cfg.twitterCard || 'summary_large_image' });
  upsertMeta('meta[name="twitter:title"][data-seo="1"]', { name: 'twitter:title', content: title });
  upsertMeta('meta[name="twitter:description"][data-seo="1"]', { name: 'twitter:description', content: description });
  if (cfg.twitterSite) upsertMeta('meta[name="twitter:site"][data-seo="1"]', { name: 'twitter:site', content: cfg.twitterSite });
  if (cfg.twitterCreator) upsertMeta('meta[name="twitter:creator"][data-seo="1"]', { name: 'twitter:creator', content: cfg.twitterCreator });
  if (cfg.ogImage) upsertMeta('meta[name="twitter:image"][data-seo="1"]', { name: 'twitter:image', content: cfg.ogImage });

  // Vérification de propriété
  if (cfg.verifyGoogle) upsertMeta('meta[name="google-site-verification"][data-seo="1"]', { name: 'google-site-verification', content: cfg.verifyGoogle });
  if (cfg.verifyBing) upsertMeta('meta[name="msvalidate.01"][data-seo="1"]', { name: 'msvalidate.01', content: cfg.verifyBing });

  // JSON-LD (remplacé à chaque application)
  document.head.querySelectorAll('script[type="application/ld+json"][data-seo="1"]').forEach((n) => n.remove());
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.setAttribute('data-seo', '1');
  ld.textContent = JSON.stringify(buildJsonLd(cfg));
  document.head.appendChild(ld);
}
