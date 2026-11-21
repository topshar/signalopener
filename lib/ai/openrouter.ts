import { AppError } from "../errors";
import { providerHttpError, providerNetworkError } from "./http-errors";
import { MODEL_TIMEOUT_MS, type AIProvider, type GenerateJsonRequest } from "./types";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

type OpenRouterResponse = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: number };
};

/**
 * OpenRouter uses the OpenAI chat format. Free models differ in whether they
 * support structured output, so we don't send response_format; the schema goes
 * in the prompt and our own parser validates the result either way.
 */
export function createOpenRouterProvider(apiKey: string, model: string): AIProvider {
  return {
    name: "openrouter",
    model,
    async generateJson({ system, user, schema, timeoutMs }: GenerateJsonRequest) {
      const started = Date.now();
      let res: Response;
      try {
        res = await fetch(API_URL, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs ?? MODEL_TIMEOUT_MS),
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
            "x-title": "SignalOpener",
          },
          body: JSON.stringify({
            model,
            temperature: 0.6,
            messages: [
              {
                role: "system",
                content: `${system}\n\nJSON schema to follow exactly:\n${JSON.stringify(schema)}`,
              },
              { role: "user", content: user },
            ],
          }),
        });
      } catch (err) {
        throw providerNetworkError("openrouter", err);
      }

      if (!res.ok) throw providerHttpError("openrouter", res.status, await res.text());

      const data = (await res.json()) as OpenRouterResponse;
      // OpenRouter can return 200 with an error object when the upstream model fails.
      if (data.error) {
        throw providerHttpError("openrouter", data.error.code ?? 502, data.error.message ?? "");
      }

      const text = data.choices?.[0]?.message?.content ?? "";
      if (!text) {
        throw new AppError(
          "AI_BAD_RESPONSE",
          "The AI model returned an empty response. Try again.",
          502,
          `finish_reason=${data.choices?.[0]?.finish_reason}`,
        );
      }

      return {
        text,
        latencyMs: Date.now() - started,
        usage: data.usage
          ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
          : undefined,
      };
    },
  };
}
