import type { TokenUsage } from "../types";

export type GenerateJsonRequest = {
  system: string;
  user: string;
  schema: object;
};

export type GenerateJsonResult = {
  text: string; // raw model output, parsed and validated by the caller
  usage?: TokenUsage;
  latencyMs: number;
};

/** Every provider implements this one method. Swapping providers is a config change. */
export interface AIProvider {
  readonly name: "gemini" | "openrouter";
  readonly model: string;
  generateJson(req: GenerateJsonRequest): Promise<GenerateJsonResult>;
}

export const MODEL_TIMEOUT_MS = 45_000;
