import * as cheerio from "cheerio";
import type { PageContent } from "./types";

const DEFAULT_MAX_TEXT_CHARS = 6_000; // ~1.5k tokens per page; keeps model input small
const MAX_HEADINGS = 30;
const MAX_LINKS = 100;

// Elements that never carry useful company information.
const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "canvas",
  "form",
  "nav",
  "footer",
  "[role=navigation]",
  "[role=contentinfo]",
  "[aria-hidden=true]",
  "[hidden]",
].join(",");

// Cookie / consent banners are usually identifiable by id or class.
const CONSENT_PATTERN = /cookie|consent|gdpr|onetrust|cookiebot/i;

const BLOCK_TAGS =
  "p,div,section,article,main,aside,header,li,ul,ol,h1,h2,h3,h4,h5,h6,tr,td,th,blockquote,dt,dd,figcaption,br,hr";

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function parseJsonLd($: cheerio.CheerioAPI): string[] {
  const out: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      const items: unknown[] = Array.isArray(data) ? data : data?.["@graph"] ?? [data];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        const type = Array.isArray(rec["@type"]) ? rec["@type"].join("/") : rec["@type"];
        const name = typeof rec.name === "string" ? rec.name : "";
        const desc = typeof rec.description === "string" ? rec.description : "";
        if (typeof type === "string" && (name || desc)) {
          out.push(clean(`${type}: ${name}${desc ? ` - ${desc}` : ""}`).slice(0, 300));
        }
      }
    } catch {
      // Malformed JSON-LD is common; ignore it.
    }
  });
  return out.slice(0, 5);
}

function collectInternalLinks($: cheerio.CheerioAPI, pageUrl: URL): string[] {
  const seen = new Set<string>();
  const baseHost = pageUrl.hostname.replace(/^www\./, "");
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) return;
    try {
      const u = new URL(href, pageUrl);
      if (u.hostname.replace(/^www\./, "") !== baseHost) return;
      if (!/^https?:$/.test(u.protocol)) return;
      u.hash = "";
      u.search = "";
      seen.add(u.toString());
    } catch {
      // ignore bad hrefs
    }
  });
  return [...seen].slice(0, MAX_LINKS);
}

/**
 * Turns raw HTML into a compact, readable summary of the page.
 * Deterministic and model-free: what goes to the AI is exactly what this returns.
 */
export function extractPage(
  html: string,
  pageUrl: string,
  maxTextChars = DEFAULT_MAX_TEXT_CHARS,
): PageContent {
  const url = new URL(pageUrl);
  const $ = cheerio.load(html);

  const meta = (sel: string) => clean($(sel).attr("content") ?? "");
  const title = clean($("title").first().text()) || meta('meta[property="og:title"]');
  const description =
    meta('meta[name="description"]') || meta('meta[property="og:description"]');
  const siteName = meta('meta[property="og:site_name"]');
  const structuredData = parseJsonLd($);
  const scriptCount = $("script").length;

  // Links are collected before nav/footer removal; nav links are the best map of the site.
  const internalLinks = collectInternalLinks($, url);

  $(NOISE_SELECTORS).remove();
  $("[id],[class]").each((_, el) => {
    const $el = $(el);
    const marker = `${$el.attr("id") ?? ""} ${$el.attr("class") ?? ""}`;
    if (CONSENT_PATTERN.test(marker)) $el.remove();
  });

  // Prefer <main> when it holds real content; otherwise use the whole body.
  const main = $("main").first();
  const root = main.length && clean(main.text()).length > 200 ? main : $("body");

  const headings: string[] = [];
  root.find("h1,h2,h3").each((_, el) => {
    const h = clean($(el).text());
    if (h && h.length <= 200 && !headings.includes(h)) headings.push(h);
  });

  // Put line breaks after block elements so "Features" and "Pricing" in adjacent
  // divs don't become "FeaturesPricing".
  root.find(BLOCK_TAGS).after("\n");

  const seenLines = new Set<string>();
  const lines: string[] = [];
  for (const rawLine of root.text().split("\n")) {
    const line = clean(rawLine);
    if (line.length < 2 || seenLines.has(line)) continue; // drop blanks and repeated text
    seenLines.add(line);
    // Lines of one or two words are almost always buttons and menu labels
    // ("Get started", "Pricing"). Headings are kept separately above.
    if (line.split(" ").length <= 2 && !/\d/.test(line)) continue;
    lines.push(line);
  }

  let text = lines.join("\n");
  if (text.length > maxTextChars) {
    // Cut at a line boundary so we never hand the model half a sentence to quote.
    const cut = text.lastIndexOf("\n", maxTextChars);
    text = text.slice(0, cut > maxTextChars * 0.6 ? cut : maxTextChars);
  }
  const wordCount = text ? text.split(/\s+/).length : 0;

  return {
    url: url.toString(),
    title,
    description,
    siteName,
    structuredData,
    headings: headings.slice(0, MAX_HEADINGS),
    text,
    wordCount,
    internalLinks,
    scriptCount,
  };
}

/**
 * Everything the model is shown for a page, as one string. Quote verification
 * runs against exactly this, so the model can only "quote" what it was given.
 */
export function pageCorpus(page: PageContent): string {
  return [page.title, page.description, ...page.structuredData, ...page.headings, page.text].join(
    "\n",
  );
}

export type ContentAssessment =
  | { ok: true }
  | { ok: false; reason: "js_rendered" | "thin_content"; message: string };

const MIN_WORDS = 80;

/**
 * Decides, before spending a model call, whether there is enough text to work with.
 * A page with very little text and lots of scripts is most likely a JavaScript app
 * that renders in the browser, which a plain HTTP fetch can't see.
 */
export function assessContent(home: PageContent, totalWords = home.wordCount): ContentAssessment {
  if (totalWords >= MIN_WORDS) return { ok: true };

  if (home.scriptCount >= 3 && home.wordCount < MIN_WORDS) {
    return {
      ok: false,
      reason: "js_rendered",
      message:
        "This website seems to build its content with JavaScript in the browser, so there was almost no readable text in the page we received. SignalOpener doesn't run a browser yet.",
    };
  }
  return {
    ok: false,
    reason: "thin_content",
    message:
      "The website has too little readable text to find a specific, honest observation. Try a page with more detail, such as the company's About or Product page.",
  };
}
