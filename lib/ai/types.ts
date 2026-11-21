import type { TokenUsage } from "../types";

export type GenerateJsonRequest = {
  system: string;
  user: string;
  schema: object;
  timeoutMs?: number;
};

export type GenerateJsonResult = {
  text: string; // raw model output, parsed and validated by the caller
  usage?: TokenUsage;
  latencyMs: number;
};

/** Every provider implements this one method. Swapping providers is a config change. */
export interface AIProvider {
  readonly name: "gemini" | "openrouter" | "test";
  readonly model: string;
  generateJson(req: GenerateJsonRequest): Promise<GenerateJsonResult>;
}

// Stage 1 used 45s and a 503 took 46s to surface. Fail fast instead; the
// pipeline retries a "busy" error once if there is time left.
export const MODEL_TIMEOUT_MS = 40_000;
