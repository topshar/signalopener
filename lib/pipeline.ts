import { getProvider } from "./ai";
import type { AIProvider, GenerateJsonRequest, GenerateJsonResult } from "./ai/types";
import { cacheKey, TtlCache } from "./cache";
import { AppError } from "./errors";
import { assessContent, extractPage } from "./extract";
import { selectPages } from "./pages";
import { parseModelOutput } from "./parse";
import { buildUserPrompt, OUTPUT_SCHEMA, SYSTEM_PROMPT } from "./prompt";
import { safeFetchHtml, type FetchedPage, type FetchOptions } from "./safe-fetch";
import type {
  OpenerInsufficient,
  OpenerSuccess,
  PageContent,
  PageRead,
  TokenUsage,
  ValidationCheck,
} from "./types";
import { normalizeUrl } from "./url";
import { validateOutput } from "./validate";

export type GenerateInput = {
  url: string;
  senderContext: string;
  avoidObservation?: string; // "try a different angle"
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
const MAX_ATTEMPTS = 2; // generate + one retry after failed validation
const RUN_BUDGET_MS = 85_000; // keeps us inside the route's maxDuration
const MODEL_TIMEOUT_MS = 25_000;

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
  // "Different angle" requests skip the cache in both directions.
  const cache = input.avoidObservation ? undefined : deps.cache;
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

  // --- Research: homepage, then up to three internal pages in parallel -------
  const fetchStart = Date.now();
  const homeFetched = await deps.fetchPage(url, { timeoutMs: 8000 });
  const home = extractPage(homeFetched.html, homeFetched.finalUrl, HOMEPAGE_CHARS);

  const selected = selectPages(home.internalLinks, home.url, 3);
  const settled = await Promise.allSettled(
    selected.map((s) => deps.fetchPage(new URL(s.url), { timeoutMs: 6000, maxBytes: 1_000_000 })),
  );

  const pages: PageContent[] = [home];
  const pagesRead: PageRead[] = [{ url: home.url, title: home.title, category: "homepage" }];
  const skipped: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === "rejected") {
      skipped.push(`${selected[i].url} (${r.reason instanceof AppError ? r.reason.code : "error"})`);
      return;
    }
    const page = extractPage(r.value.html, r.value.finalUrl, SUBPAGE_CHARS);
    const duplicate = pages.some((p) => p.url === page.url || p.text === page.text);
    if (duplicate || page.wordCount < 30) {
      skipped.push(`${selected[i].url} (${duplicate ? "duplicate" : "too little text"})`);
      return;
    }
    pages.push(page);
    pagesRead.push({ url: page.url, title: page.title, category: selected[i].category });
  });
  const fetchMs = Date.now() - fetchStart;
  const wordsExtracted = pages.reduce((n, p) => n + p.wordCount, 0);

  // --- Enough to work with? If not, don't spend a model call. ----------------
  const assessment = assessContent(home, wordsExtracted);
  if (!assessment.ok) {
    log({ outcome: assessment.reason, url: home.url, words: wordsExtracted, fetchMs, skipped });
    return store({
      status: "insufficient",
      reason: assessment.reason,
      message: assessment.message,
      cached: false,
      meta: { pagesRead, wordsExtracted, fetchMs, totalMs: Date.now() - started },
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
    const { result, calls } = await callModel(provider, req, remaining, sleep);
    modelCalls += calls;
    modelMs += result.latencyMs;
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
        evidence: v.evidence,
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

function idsWith(checks: ValidationCheck[], status: string): string[] {
  return checks.filter((c) => c.status === status).map((c) => c.id);
}

function logMeta(m: Record<string, unknown>) {
  const { pagesRead, ...rest } = m as { pagesRead: PageRead[] };
  return { ...rest, pages: pagesRead.length };
}

/** One structured log line per event: timings and token usage, never page content. */
function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event: "generate", ...fields }));
}
