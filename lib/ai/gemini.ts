import { AppError } from "../errors";
import { providerHttpError, providerNetworkError } from "./http-errors";
import { MODEL_TIMEOUT_MS, type AIProvider, type GenerateJsonRequest } from "./types";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

export function createGeminiProvider(apiKey: string, model: string): AIProvider {
  return {
    name: "gemini",
    model,
    async generateJson({ system, user, schema }: GenerateJsonRequest) {
      const started = Date.now();
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: user }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: schema,
              temperature: 0.6,
              // Generous cap: on thinking models, reasoning tokens count against it.
              maxOutputTokens: 8192,
            },
          }),
        });
      } catch (err) {
        throw providerNetworkError("gemini", err);
      }

      if (!res.ok) throw providerHttpError("gemini", res.status, await res.text());

      const data = (await res.json()) as GeminiResponse;
      const latencyMs = Date.now() - started;

      if (data.promptFeedback?.blockReason) {
        throw new AppError(
          "AI_BLOCKED",
          "The AI provider declined to process this website's content.",
          422,
          `blockReason=${data.promptFeedback.blockReason}`,
        );
      }

      const candidate = data.candidates?.[0];
      const text = (candidate?.content?.parts ?? [])
        .filter((p) => !p.thought && typeof p.text === "string")
        .map((p) => p.text)
        .join("");

      if (!text) {
        const reason = candidate?.finishReason ?? "unknown";
        throw new AppError(
          reason === "SAFETY" ? "AI_BLOCKED" : "AI_BAD_RESPONSE",
          reason === "SAFETY"
            ? "The AI provider declined to process this website's content."
            : "The AI model returned an empty response. Try again.",
          502,
          `finishReason=${reason}`,
        );
      }

      const u = data.usageMetadata;
      return {
        text,
        latencyMs,
        usage: u
          ? {
              inputTokens: u.promptTokenCount,
              outputTokens: u.candidatesTokenCount,
              thinkingTokens: u.thoughtsTokenCount,
            }
          : undefined,
      };
    },
  };
}
