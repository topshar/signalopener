import { AppError } from "../errors";
import { createGeminiProvider } from "./gemini";
import { createOpenRouterProvider } from "./openrouter";
import type { AIProvider } from "./types";

/**
 * Picks the provider from AI_PROVIDER. There is deliberately no automatic
 * fallback: if the configured provider fails, the user sees that failure
 * instead of a silent switch to a different model.
 */
export function getProvider(): AIProvider {
  const provider = (process.env.AI_PROVIDER ?? "gemini").trim().toLowerCase();

  if (provider === "gemini") {
    const key = process.env.GEMINI_API_KEY?.trim();
    const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
    // Unset -> "low". Set to an empty string to send no thinking config.
    const thinking = process.env.GEMINI_THINKING_LEVEL ?? "low";
    if (!key) throw configError("GEMINI_API_KEY is not set.");
    return createGeminiProvider(key, model, thinking.trim().toLowerCase());
  }

  if (provider === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY?.trim();
    const model = process.env.OPENROUTER_MODEL?.trim();
    if (!key) throw configError("OPENROUTER_API_KEY is not set.");
    if (!model) throw configError("OPENROUTER_MODEL is not set.");
    return createOpenRouterProvider(key, model);
  }

  throw configError(`Unknown AI_PROVIDER "${provider}". Use "gemini" or "openrouter".`);
}

function configError(detail: string): AppError {
  return new AppError(
    "AI_CONFIG",
    "The AI provider isn't configured on the server.",
    500,
    detail,
  );
}
