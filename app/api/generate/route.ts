import { AppError } from "@/lib/errors";
import { generateOpener } from "@/lib/pipeline";
import { MAX_SENDER_CONTEXT } from "@/lib/prompt";
import { clientIp, RateLimiter } from "@/lib/rate-limit";
import { normalizeUrl } from "@/lib/url";
import type { GenerateResponse, OpenerError } from "@/lib/types";

// Run budget is 85s (fetching + up to 2 model rounds + one busy-retry), with headroom.
// Vercel Hobby allows up to 300s.
export const maxDuration = 100;

const MAX_PASTED_TEXT = 20_000;

const limiter = new RateLimiter(Number(process.env.DAILY_RUN_LIMIT) || 200);

function errorResponse(err: AppError, headers?: HeadersInit): Response {
  const body: OpenerError = { status: "error", code: err.code, message: err.message };
  return Response.json(body satisfies GenerateResponse, { status: err.httpStatus, headers });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(new AppError("INVALID_INPUT", "Request body must be JSON."));
  }

  const { url, senderContext, avoidObservation, pastedText } = (body ?? {}) as Record<string, unknown>;
  if (typeof url !== "string") {
    return errorResponse(new AppError("INVALID_INPUT", "Enter a company website address."));
  }
  for (const [name, value] of [
    ["senderContext", senderContext],
    ["avoidObservation", avoidObservation],
    ["pastedText", pastedText],
  ] as const) {
    if (value !== undefined && typeof value !== "string") {
      return errorResponse(new AppError("INVALID_INPUT", `${name} must be text.`));
    }
  }
  if (typeof senderContext === "string" && senderContext.length > MAX_SENDER_CONTEXT) {
    return errorResponse(
      new AppError(
        "INVALID_INPUT",
        `Keep "what you're reaching out about" under ${MAX_SENDER_CONTEXT} characters.`,
      ),
    );
  }

  if (typeof pastedText === "string" && pastedText.length > MAX_PASTED_TEXT) {
    return errorResponse(
      new AppError("INVALID_INPUT", "That's a lot of text. Paste one or two pages, up to about 20,000 characters."),
    );
  }

  // Validate the URL before counting the request, so a typo doesn't use up a visitor's quota.
  try {
    normalizeUrl(url);
  } catch (err) {
    if (err instanceof AppError) return errorResponse(err);
    throw err;
  }

  const limit = limiter.check(clientIp(request));
  if (!limit.ok) {
    return errorResponse(new AppError("RATE_LIMITED", limit.message, 429), {
      "retry-after": String(limit.retryAfterSec),
    });
  }

  try {
    const result = await generateOpener({
      url,
      senderContext: (senderContext as string | undefined) ?? "",
      avoidObservation: (avoidObservation as string | undefined)?.slice(0, MAX_SENDER_CONTEXT) || undefined,
      pastedText: (pastedText as string | undefined) || undefined,
    });
    return Response.json(result satisfies GenerateResponse);
  } catch (err) {
    if (err instanceof AppError) {
      console.warn(JSON.stringify({ event: "generate_error", code: err.code, detail: err.detail }));
      return errorResponse(err);
    }
    console.error("Unexpected error in /api/generate", err);
    return errorResponse(
      new AppError("INTERNAL", "Something went wrong on our side. Please try again.", 500),
    );
  }
}
