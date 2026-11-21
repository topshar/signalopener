import { getProvider } from "./ai";
import { assessContent, extractPage } from "./extract";
import { parseModelOutput } from "./parse";
import { buildUserPrompt, OUTPUT_SCHEMA, SYSTEM_PROMPT } from "./prompt";
import { safeFetchHtml } from "./safe-fetch";
import type { OpenerInsufficient, OpenerSuccess } from "./types";
import { normalizeUrl } from "./url";

export type GenerateInput = { url: string; senderContext: string };

/**
 * The whole Stage 1 flow, in order:
 *   validate URL -> fetch homepage -> extract text -> enough content? ->
 *   model call -> parse and validate JSON -> result
 * Everything except the model call is deterministic code.
 */
export async function generateOpener(
  input: GenerateInput,
): Promise<OpenerSuccess | OpenerInsufficient> {
  const started = Date.now();

  const url = normalizeUrl(input.url);

  // Read AI config before fetching so a missing API key fails fast.
  const provider = getProvider();

  const fetchStart = Date.now();
  const fetched = await safeFetchHtml(url);
  const fetchMs = Date.now() - fetchStart;

  const page = extractPage(fetched.html, fetched.finalUrl);

  const assessment = assessContent(page);
  if (!assessment.ok) {
    // No model call: nothing to ground an opener in, so we don't pay for one.
    log({ outcome: assessment.reason, url: page.url, words: page.wordCount, fetchMs });
    return {
      status: "insufficient",
      reason: assessment.reason,
      message: assessment.message,
      meta: {
        pagesFetched: [page.url],
        wordsExtracted: page.wordCount,
        fetchMs,
        totalMs: Date.now() - started,
      },
    };
  }

  const result = await provider.generateJson({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt([page], input.senderContext),
    schema: OUTPUT_SCHEMA,
  });

  const parsed = parseModelOutput(result.text);

  const meta = {
    provider: provider.name,
    model: provider.model,
    pagesFetched: [page.url],
    wordsExtracted: page.wordCount,
    fetchMs,
    modelMs: result.latencyMs,
    totalMs: Date.now() - started,
    usage: result.usage,
  };

  log({ outcome: parsed.kind, url: page.url, words: page.wordCount, ...meta, pagesFetched: undefined });

  if (parsed.kind === "insufficient") {
    return { status: "insufficient", reason: "model_insufficient", message: parsed.reason, meta };
  }

  return {
    status: "ok",
    companySummary: parsed.companySummary,
    observation: parsed.observation,
    supportingQuote: parsed.supportingQuote,
    sourceUrl: parsed.sourceUrl || page.url,
    interpretation: parsed.interpretation,
    lines: parsed.lines,
    meta,
  };
}

/** One structured log line per run: timings and token usage, never page content. */
function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event: "generate", ...fields }));
}
