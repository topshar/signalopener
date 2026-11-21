// Deterministic checks on the model's output. None of these ask the model
// anything; they compare its output with the pages we actually fetched.

import { pageCorpus } from "./extract";
import { findInjectionSignals, OUTPUT_LEAK_PATTERN, stripInjectionLines } from "./injection";
import type { ParsedOutput } from "./parse";
import type { Evidence, PageContent, ValidationCheck } from "./types";

type ParsedOk = Extract<ParsedOutput, { kind: "ok" }>;

export type ValidationResult = {
  checks: ValidationCheck[];
  /** Hard failures, phrased as feedback for the retry prompt. Empty = accepted. */
  failures: string[];
  evidence: Evidence;
};

const MIN_QUOTE_WORDS = 4;
const MAX_LINE_WORDS = 40;

export const GENERIC_PHRASES: { pattern: RegExp; label: string }[] = [
  { pattern: /\bi (just )?came across\b/i, label: "I came across" },
  { pattern: /\bi(?:'m| am) (?:really |so |very )?impressed\b/i, label: "I'm impressed" },
  { pattern: /\blove what you(?:'re| are) (?:building|doing|creating)\b/i, label: "love what you're building" },
  { pattern: /\binnovative\b/i, label: "innovative" },
  { pattern: /\bhope (?:this|the|my) (?:email|message|note) finds you\b/i, label: "hope this finds you well" },
  { pattern: /\bgame[- ]?changer\b/i, label: "game-changer" },
  { pattern: /\bcutting[- ]edge\b/i, label: "cutting-edge" },
  { pattern: /\brevolutioni[sz]\w*/i, label: "revolutionize" },
  { pattern: /\bi wanted to reach out\b/i, label: "I wanted to reach out" },
  { pattern: /\bquick question\b/i, label: "quick question" },
  { pattern: /\btouch base\b/i, label: "touch base" },
  { pattern: /\bin today's (?:fast-paced|competitive|digital)\b/i, label: "in today's fast-paced..." },
  { pattern: /\bsynergy\b/i, label: "synergy" },
];

const STOPWORDS = new Set(
  "the and for with your you our are that this from have has was were will can all into their them they its it's about more than just what when where which while also been being over under very most some such only then there these those each other into onto".split(
    " ",
  ),
);

/**
 * Normalises text so harmless differences don't fail a match: case, curly vs
 * straight quotes, en/em dashes, non-breaking spaces, zero-width characters and
 * whitespace. Words themselves must still match exactly.
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[​-‍﻿]/g, "")
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips wrapping quote marks and trailing punctuation the model may add. */
function cleanQuote(q: string): string {
  return normalizeForMatch(q)
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/[.,;:!?]+$/, "")
    .trim();
}

export function normalizeUrlForCompare(u: string): string {
  try {
    const url = new URL(u);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

/** Numbers as written ("5,000", "$29", "14-day", "2.5x") reduced to digits for comparison. */
export function extractNumbers(text: string): string[] {
  const matches = text.match(/\d+(?:[.,]\d+)*/g) ?? [];
  return matches.map((n) => n.replace(/,(?=\d{3}\b)/g, "").replace(/\.0+$/, ""));
}

function significantWords(text: string): Set<string> {
  return new Set(
    normalizeForMatch(text)
      .replace(/[^a-z0-9\s'-]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/^'+|'+$/g, "").replace(/(?:'s|s)$/, ""))
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

export function validateOutput(
  out: ParsedOk,
  pages: PageContent[],
  ctx: { senderContext: string; now: Date },
): ValidationResult {
  const checks: ValidationCheck[] = [];
  const failures: string[] = [];
  // Instruction-like lines are never evidence (see stripInjectionLines).
  const corpora = pages.map((p) => normalizeForMatch(stripInjectionLines(pageCorpus(p))));

  // 1. Quote exists, word for word, on a page we fetched.
  const quote = cleanQuote(out.supportingQuote);
  const quoteWords = quote ? quote.split(" ").length : 0;
  const citedIdx = pages.findIndex(
    (p) => normalizeUrlForCompare(p.url) === normalizeUrlForCompare(out.sourceUrl),
  );
  let foundIdx = -1;
  if (quoteWords >= MIN_QUOTE_WORDS) {
    if (citedIdx >= 0 && corpora[citedIdx].includes(quote)) foundIdx = citedIdx;
    else foundIdx = corpora.findIndex((c) => c.includes(quote));
  }

  if (quoteWords < MIN_QUOTE_WORDS) {
    checks.push({
      id: "quote",
      label: "Quote found on the website",
      status: "fail",
      detail: `Quote is too short to verify (${quoteWords} words; minimum ${MIN_QUOTE_WORDS}).`,
    });
    failures.push(
      `supporting_quote must be an exact passage of at least ${MIN_QUOTE_WORDS} words copied from the website content.`,
    );
  } else if (foundIdx === -1) {
    checks.push({
      id: "quote",
      label: "Quote found on the website",
      status: "fail",
      detail: "The quoted text does not appear on any page we read.",
    });
    failures.push(
      `supporting_quote "${out.supportingQuote.slice(0, 160)}" does not appear word for word in the website content. Copy an exact passage instead of paraphrasing.`,
    );
  } else {
    checks.push({ id: "quote", label: "Quote found on the website", status: "pass" });
  }

  // 2. Source URL is one of the pages we fetched.
  const sourceCorrected = foundIdx >= 0 && foundIdx !== citedIdx;
  if (citedIdx >= 0 && !sourceCorrected) {
    checks.push({ id: "source", label: "Source page was actually read", status: "pass" });
  } else if (sourceCorrected) {
    checks.push({
      id: "source",
      label: "Source page was actually read",
      status: "warn",
      detail: "The model cited a different page; the source link was corrected to where the quote appears.",
    });
  } else {
    checks.push({
      id: "source",
      label: "Source page was actually read",
      status: "fail",
      detail: "The cited source is not one of the pages we fetched.",
    });
    failures.push("source_url must be exactly one of the page URLs given in the website content.");
  }

  // 3. Structure: exactly three lines (enforced by the parser), each a sensible length.
  const longLines = out.lines
    .map((l, i) => ({ i: i + 1, words: l.split(/\s+/).length }))
    .filter((l) => l.words > MAX_LINE_WORDS);
  if (longLines.length) {
    checks.push({
      id: "structure",
      label: "Exactly three concise lines",
      status: "fail",
      detail: `Line ${longLines.map((l) => l.i).join(", ")} is over ${MAX_LINE_WORDS} words.`,
    });
    failures.push(`Each opener line must be at most 30 words. Shorten line ${longLines.map((l) => l.i).join(", ")}.`);
  } else {
    checks.push({ id: "structure", label: "Exactly three concise lines", status: "pass" });
  }

  // 4. Every number in the opener appears on the website (or in the sender's own context).
  const allowed = new Set([
    ...corpora.flatMap(extractNumbers),
    ...extractNumbers(ctx.senderContext),
    String(ctx.now.getFullYear()),
  ]);
  const unsupported = [
    ...new Set(extractNumbers(`${out.lines.join(" ")} ${out.observation}`).filter((n) => !allowed.has(n))),
  ];
  if (unsupported.length) {
    checks.push({
      id: "numbers",
      label: "Every number appears on the website",
      status: "fail",
      detail: `Not found on the website: ${unsupported.join(", ")}.`,
    });
    failures.push(
      `These numbers are not in the website content and must not be used: ${unsupported.join(", ")}.`,
    );
  } else {
    checks.push({ id: "numbers", label: "Every number appears on the website", status: "pass" });
  }

  // 5. No stock sales phrases.
  const generic = GENERIC_PHRASES.filter((g) => out.lines.some((l) => g.pattern.test(l))).map(
    (g) => g.label,
  );
  if (generic.length) {
    checks.push({
      id: "generic",
      label: "No generic sales phrases",
      status: "fail",
      detail: `Found: ${generic.join(", ")}.`,
    });
    failures.push(`Remove these generic phrases: ${generic.join(", ")}.`);
  } else {
    checks.push({ id: "generic", label: "No generic sales phrases", status: "pass" });
  }

  // 6. Line 1 is built from the quote (shares its key words). Soft check.
  const quoteKeys = significantWords(out.supportingQuote);
  const line1Keys = significantWords(out.lines[0]);
  const shared = [...quoteKeys].filter((w) => line1Keys.has(w)).length;
  const grounded = quoteKeys.size > 0 && (shared >= 2 || shared / quoteKeys.size >= 0.4);
  checks.push({
    id: "line1",
    label: "First line is based on the quote",
    status: grounded ? "pass" : "warn",
    detail: grounded ? undefined : "Line 1 shares few key words with the quote; check it says what the site says.",
  });

  // 7. Prompt injection: report what was on the site, fail if it leaked into the output.
  const leaked = out.lines.some((l) => OUTPUT_LEAK_PATTERN.test(l));
  const signals = findInjectionSignals(pages.map((p) => p.text));
  if (leaked) {
    checks.push({
      id: "injection",
      label: "Website text treated as data only",
      status: "fail",
      detail: "The opener contains text that looks like leaked instructions.",
    });
    failures.push("The opener must not mention prompts, instructions or AI. Write about the company only.");
  } else if (signals.length) {
    checks.push({
      id: "injection",
      label: "Website text treated as data only",
      status: "warn",
      detail: `The site contains ${signals.length} instruction-like passage${signals.length > 1 ? "s" : ""} aimed at AI tools. They were ignored.`,
    });
  } else {
    checks.push({ id: "injection", label: "Website text treated as data only", status: "pass" });
  }

  const sourcePage = foundIdx >= 0 ? pages[foundIdx] : pages[Math.max(citedIdx, 0)];
  return {
    checks,
    failures,
    evidence: {
      quote: out.supportingQuote.trim().replace(/^["'“‘]+|["'”’]+$/g, ""),
      sourceUrl: sourcePage.url,
      sourceTitle: sourcePage.title,
      sourceCorrected,
    },
  };
}
