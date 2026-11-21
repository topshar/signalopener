import { AppError } from "../errors";

/** Maps provider HTTP failures to user-facing errors. Raw bodies go to logs only. */
export function providerHttpError(provider: string, status: number, body: string): AppError {
  const detail = `${provider} HTTP ${status}: ${body.slice(0, 500)}`;
  if (status === 429) {
    return new AppError(
      "AI_RATE_LIMITED",
      "The AI provider's free-tier limit was reached. Wait a minute and try again.",
      429,
      detail,
    );
  }
  if (status === 401 || status === 403) {
    return new AppError(
      "AI_CONFIG",
      "The AI provider rejected the API key. Check the server configuration.",
      500,
      detail,
    );
  }
  if (status === 404) {
    return new AppError(
      "AI_MODEL_UNAVAILABLE",
      "The configured AI model isn't available. Check the model ID in the server configuration.",
      502,
      detail,
    );
  }
  if (status === 402) {
    return new AppError(
      "AI_RATE_LIMITED",
      "The AI provider requires credits for this request. The free allowance may be used up.",
      402,
      detail,
    );
  }
  return new AppError(
    "AI_PROVIDER_ERROR",
    "The AI provider returned an error. Try again in a moment.",
    502,
    detail,
  );
}

export function providerNetworkError(provider: string, err: unknown): AppError {
  const name = (err as Error)?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return new AppError("AI_TIMEOUT", "The AI model took too long to respond. Try again.", 504);
  }
  return new AppError(
    "AI_PROVIDER_ERROR",
    "Couldn't reach the AI provider. Try again in a moment.",
    502,
    `${provider}: ${String((err as Error)?.cause ?? err)}`,
  );
}
