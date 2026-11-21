import { getProvider } from "./ai";
import type { AIProvider, GenerateJsonRequest, GenerateJsonResult } from "./ai/types";
import { cacheKey, TtlCache } from "./cache";
import { AppError } from "./errors";
import {
  assessContent,
  extractPage,
  isBotChallenge,
  pageFromPastedText,
  type ContentAssessment,
} from "./extract";
import { selectPages } from "./pages";
import { parseModelOutput } from "./parse";
import { buildUserPrompt, OUTPUT_SCHEMA, SYSTEM_PROMPT } from "./prompt";
import { blockedBySite, safeFetchHtml, type FetchedPage, type FetchOptions } from "./safe-fetch";
import type {
  OpenerInsufficient,
  OpenerSuccess,
  PageContent,
  PageRead,
  PageSkipped,
  TokenUsage,
  ValidationCheck,
} from "./types";
import { normalizeUrl } from "./url";
import { validateOutput } from "./validate";

export type GenerateInput = {
  url: string;
  senderContext: string;
  avoidObservation?: string; // "try a different angle"
  pastedText?: string; // text the user copied from the site, used instead of fetching
};

export type PipelineDeps = {
  fetchPage: (url: URL, opts: FetchOptions) => Promise<FetchedPage>;
  provider?: AIProvider;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  cache?: TtlCache<OpenerSuccess | OpenerInsufficient>;
};

const sharedCache = new TtlCache<OpenerSuccess | OpenerInsufficient>();
const defaultDeps: PipelineDeps = { fetchPage: safeFetchHtml, cache: sharedCache };

const HOMEPAGE_CHARS = 6_000;
const SUBPAGE_CHARS = 3_000;
const MIN_PASTED_WORDS = 40;
const MAX_ATTEMPTS = 2; // generate + one retry after failed validation
const RUN_BUDGET_MS = 85_000; // keeps us inside the route's maxDuration
const MODEL_TIMEOUT_MS = 40_000;

type Usage = Required<TokenUsage>;

/**
 * The whole flow:
 *   cache? -> validate URL -> fetch homepage -> pick and fetch up to 3 internal
 *   pages -> enough content? -> model -> parse -> validate against the pages
 *   -> (one retry with the failures as feedback) -> result
 * Everything except the model call is deterministic code.
 */
export async function generateOpener(
  input: GenerateInput,
  deps: PipelineDeps = defaultDeps,
): Promise<OpenerSuccess | OpenerInsufficient> {
  const started = Date.now();
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const remaining = () => RUN_BUDGET_MS - (Date.now() - started);

  const url = normalizeUrl(input.url);
  const key = cacheKey(url, input.senderContext);
  // "Different angle" and pasted-text requests skip the cache in both directions.
  const pasted = Boolean(input.pastedText?.trim());
  const cache = input.avoidObservation || pasted ? undefined : deps.cache;
  if (cache) {
    const hit = cache.get(key);
    if (hit) {
      log({ outcome: "cache_hit", url: url.toString() });
      return { ...hit, cached: true };
    }
  }

  const store = <T extends OpenerSuccess | OpenerInsufficient>(result: T): T => {
    cache?.set(key, result);
    return result;
  };

  // Read AI config before fetching so a missing API key fails fast.
  const provider = deps.provider ?? getProvider();

  // --- Research: fetch the site, or use the text the user pasted ------------
  const { pages, pagesRead, pagesSkipped, fetchMs } = pasted
    ? pastedResearch(input.pastedText!, url)
    : await researchSite(url, deps);
  const home = pages[0];
  const wordsExtracted = pages.reduce((n, p) => n + p.wordCount, 0);

  // --- Enough to work with? If not, don't spend a model call. ----------------
  // Pasted text was chosen by the user, so one solid paragraph is enough.
  const assessment: ContentAssessment = !pasted
    ? assessContent(home, wordsExtracted)
    : wordsExtracted >= MIN_PASTED_WORDS
      ? { ok: true }
      : {
          ok: false,
          reason: "thin_content",
          message:
            "The pasted text is too short to find a specific observation. Paste a few paragraphs from their About, Product or Pricing page.",
        };
  if (!assessment.ok) {
    log({ outcome: assessment.reason, url: home.url, words: wordsExtracted, fetchMs, skipped: pagesSkipped });
    return store({
      status: "insufficient",
      reason: assessment.reason,
      message: assessment.message,
      cached: false,
      meta: { pagesRead, pagesSkipped, wordsExtracted, fetchMs, totalMs: Date.now() - started },
    });
  }

  // --- Generate, validate, retry once with feedback --------------------------
  const usage: Usage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
  let modelMs = 0;
  let modelCalls = 0;
  let attempts = 0;
  let feedback: string[] = [];
  let lastChecks: ValidationCheck[] | undefined;
  let lastError: AppError | undefined;

  while (attempts < MAX_ATTEMPTS) {
    if (attempts > 0 && remaining() < MODEL_TIMEOUT_MS) break; // no time for a retry
    attempts++;

    const req: GenerateJsonRequest = {
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(pages, input.senderContext, {
        today: now(),
        avoidObservation: input.avoidObservation,
        feedback,
      }),
      schema: OUTPUT_SCHEMA,
    };

    // Provider errors (busy twice, rate limit, bad key) go straight to the user.
    // modelMs is wall time, so it includes a failed "busy" call and the pause.
    const callStart = Date.now();
    const { result, calls } = await callModel(provider, req, remaining, sleep);
    modelCalls += calls;
    modelMs += Date.now() - callStart;
    usage.inputTokens += result.usage?.inputTokens ?? 0;
    usage.outputTokens += result.usage?.outputTokens ?? 0;
    usage.thinkingTokens += result.usage?.thinkingTokens ?? 0;

    let parsed;
    try {
      parsed = parseModelOutput(result.text);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      lastError = err;
      feedback = [
        "Your previous response was not valid JSON matching the schema with exactly three opener_lines. Return only the JSON object.",
      ];
      continue;
    }

    const meta = {
      provider: provider.name,
      model: provider.model,
      pagesRead,
      pagesSkipped,
      wordsExtracted,
      fetchMs,
      modelMs,
      totalMs: Date.now() - started,
      attempts,
      modelCalls,
      usage,
    };

    if (parsed.kind === "insufficient") {
      log({ outcome: "model_insufficient", url: home.url, ...logMeta(meta) });
      return store({
        status: "insufficient",
        reason: "model_insufficient",
        message: parsed.reason,
        cached: false,
        meta,
      });
    }

    const v = validateOutput(parsed, pages, { senderContext: input.senderContext, now: now() });
    lastChecks = v.checks;
    if (v.failures.length === 0) {
      log({ outcome: "ok", url: home.url, ...logMeta(meta), warnings: idsWith(v.checks, "warn") });
      return store({
        status: "ok",
        companySummary: parsed.companySummary,
        observation: parsed.observation,
        interpretation: parsed.interpretation,
        lines: parsed.lines,
        evidence: { ...v.evidence, sourceKind: pasted ? "pasted" : "page" },
        checks: v.checks,
        cached: false,
        meta,
      });
    }
    log({ outcome: "validation_failed", attempt: attempts, failed: idsWith(v.checks, "fail") });
    feedback = v.failures;
  }

  // Two rounds and still nothing we can stand behind.
  if (!lastChecks && lastError) throw lastError; // the model never produced usable JSON
  const meta = {
    provider: provider.name,
    model: provider.model,
    pagesRead,
    pagesSkipped,
    wordsExtracted,
    fetchMs,
    modelMs,
    totalMs: Date.now() - started,
    attempts,
    modelCalls,
    usage,
  };
  log({ outcome: "unverified", url: home.url, ...logMeta(meta) });
  return {
    status: "insufficient",
    reason: "unverified",
    message:
      "The AI drafted an opener, but it didn't pass our checks against the website (see below), so we're not showing it. This usually means the site doesn't give it enough specific material.",
    checks: lastChecks,
    cached: false,
    meta,
  };
}

/** Homepage, then up to three internal pages in parallel. */
async function researchSite(url: URL, deps: PipelineDeps) {
  const fetchStart = Date.now();
  const homeFetched = await deps.fetchPage(url, { timeoutMs: 8000 });
  const home = extractPage(homeFetched.html, homeFetched.finalUrl, HOMEPAGE_CHARS);
  // A 200 response can still be a "Just a moment..." challenge instead of the site.
  if (isBotChallenge(home)) throw blockedBySite();

  const selected = selectPages(home.internalLinks, home.url, 3);
  const settled = await Promise.allSettled(
    selected.map((s) => deps.fetchPage(new URL(s.url), { timeoutMs: 6000, maxBytes: 1_000_000 })),
  );

  const pages: PageContent[] = [home];
  const pagesRead: PageRead[] = [{ url: home.url, title: home.title, category: "homepage" }];
  const pagesSkipped: PageSkipped[] = [];
  const skip = (i: number, reason: string) =>
    pagesSkipped.push({ url: selected[i].url, category: selected[i].category, reason });
  settled.forEach((r, i) => {
    if (r.status === "rejected") {
      skip(i, skipReason(r.reason));
      return;
    }
    const page = extractPage(r.value.html, r.value.finalUrl, SUBPAGE_CHARS);
    if (isBotChallenge(page)) {
      skip(i, "blocked by bot protection");
      return;
    }
    const duplicate = pages.some((p) => p.url === page.url || p.text === page.text);
    if (duplicate || page.wordCount < 30) {
      skip(i, duplicate ? "same content as another page" : "too little text");
      return;
    }
    pages.push(page);
    pagesRead.push({ url: page.url, title: page.title, category: selected[i].category });
  });
  const fetchMs = Date.now() - fetchStart;
  return { pages, pagesRead, pagesSkipped, fetchMs };
}

function pastedResearch(text: string, url: URL) {
  const page = pageFromPastedText(text, url.toString());
  return {
    pages: [page],
    pagesRead: [{ url: page.url, title: "Text you pasted", category: "pasted" }] as PageRead[],
    pagesSkipped: [] as PageSkipped[],
    fetchMs: 0,
  };
}

/** One model call, plus one retry if the provider says it's busy and time allows. */
async function callModel(
  provider: AIProvider,
  req: GenerateJsonRequest,
  remaining: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ result: GenerateJsonResult; calls: number }> {
  try {
    const result = await provider.generateJson({ ...req, timeoutMs: Math.min(MODEL_TIMEOUT_MS, remaining()) });
    return { result, calls: 1 };
  } catch (err) {
    const retryable = err instanceof AppError && err.code === "AI_UNAVAILABLE";
    if (!retryable || remaining() < MODEL_TIMEOUT_MS) throw err;
    log({ outcome: "provider_busy_retry", detail: (err as AppError).detail?.slice(0, 120) });
    await sleep(1500);
    const result = await provider.generateJson({ ...req, timeoutMs: Math.min(MODEL_TIMEOUT_MS, remaining()) });
    return { result, calls: 2 };
  }
}

function skipReason(err: unknown): string {
  if (!(err instanceof AppError)) return "couldn't load";
  switch (err.code) {
    case "TIMEOUT":
      return "too slow to respond";
    case "BLOCKED_BY_SITE":
      return "blocked by bot protection";
    case "NOT_HTML":
      return "not a web page";
    case "HTTP_ERROR":
      return "returned an error";
    case "BLOCKED_HOST":
      return "points to a private address";
    default:
      return "couldn't load";
  }
}

function idsWith(checks: ValidationCheck[], status: string): string[] {
  return checks.filter((c) => c.status === status).map((c) => c.id);
}

function logMeta(m: Record<string, unknown>) {
  const { pagesRead, pagesSkipped, ...rest } = m as {
    pagesRead: PageRead[];
    pagesSkipped: PageSkipped[];
  };
  return { ...rest, pages: pagesRead.length, skipped: pagesSkipped.map((s) => `${s.category}: ${s.reason}`) };
}

/** One structured log line per event: timings and token usage, never page content. */
function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event: "generate", ...fields }));
}
