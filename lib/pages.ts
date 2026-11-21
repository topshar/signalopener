// Chooses which internal pages to read after the homepage. Pure function, no I/O.

export type PageCategory =
  | "changelog"
  | "pricing"
  | "about"
  | "product"
  | "customers"
  | "blog"
  | "careers";

// Order = priority. Changelog and pricing hold the most specific, recent,
// founder-relevant facts; careers is a weaker hiring signal.
const CATEGORIES: { category: PageCategory; pattern: RegExp }[] = [
  { category: "changelog", pattern: /^(changelog|release-?notes|releases|whats-?new|updates|product-updates)$/ },
  { category: "pricing", pattern: /^(pricing|plans|plans-and-pricing)$/ },
  { category: "about", pattern: /^(about|about-us|aboutus|company|our-company|our-story|story|who-we-are|team|our-team|mission)$/ },
  { category: "product", pattern: /^(product|products|features|platform|how-it-works|solutions|use-cases|services|our-services|what-we-do|shop|range|brands|our-brands|catalog|catalogue|collections)$/ },
  { category: "customers", pattern: /^(customers|case-studies|customer-stories|testimonials|success-stories)$/ },
  { category: "blog", pattern: /^(blog|news|insights|articles|journal)$/ },
  { category: "careers", pattern: /^(careers|jobs|join-us|hiring|work-with-us)$/ },
];

const SKIP_PATH =
  /(login|log-in|signin|sign-in|signup|sign-up|register|account|cart|checkout|privacy|terms|legal|cookie|gdpr|security|status|docs|api|help|support|contact|search|tag|category|author|feed|rss|wp-)/;
const SKIP_EXTENSION = /\.(pdf|png|jpe?g|gif|svg|webp|zip|mp4|xml|json|txt|csv)$/i;
const LOCALE_PREFIX = /^[a-z]{2}(-[a-z]{2})?$/i; // /fr/about, /en-gb/pricing

export type SelectedPage = { url: string; category: PageCategory };

/**
 * From the homepage's same-site links, pick up to `max` pages, at most one per
 * category, in priority order. Only shallow pages (/pricing, /en/pricing) are
 * considered, so we read the section index rather than a random deep post.
 */
export function selectPages(links: string[], homepageUrl: string, max = 3): SelectedPage[] {
  const home = new URL(homepageUrl);
  const best = new Map<PageCategory, { url: string; depth: number }>();

  for (const link of links) {
    let u: URL;
    try {
      u = new URL(link);
    } catch {
      continue;
    }
    if (u.hostname.replace(/^www\./, "") !== home.hostname.replace(/^www\./, "")) continue;
    if (SKIP_EXTENSION.test(u.pathname)) continue;

    const segments = u.pathname.toLowerCase().split("/").filter(Boolean);
    if (segments.length === 0) continue; // the homepage itself
    // Allow one locale prefix, but prefer the unprefixed page.
    const hasLocale = segments.length === 2 && LOCALE_PREFIX.test(segments[0]);
    if (segments.length > (hasLocale ? 2 : 1)) continue;
    const slug = segments[segments.length - 1];
    if (SKIP_PATH.test(slug)) continue;

    const match = CATEGORIES.find((c) => c.pattern.test(slug));
    if (!match) continue;

    const depth = segments.length;
    const current = best.get(match.category);
    if (!current || depth < current.depth) {
      best.set(match.category, { url: `${u.origin}${u.pathname.replace(/\/$/, "")}`, depth });
    }
  }

  const selected: SelectedPage[] = [];
  for (const { category } of CATEGORIES) {
    const hit = best.get(category);
    if (hit) selected.push({ url: hit.url, category });
    if (selected.length >= max) break;
  }
  return selected;
}
