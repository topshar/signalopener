// Shared types. Safe to import from both server and client code.

export type PageContent = {
  url: string;
  title: string;
  description: string;
  siteName: string;
  structuredData: string[]; // short "Type: name - description" strings from JSON-LD
  headings: string[];
  text: string; // cleaned body text, one block per line
  wordCount: number;
  internalLinks: string[]; // same-site links, kept for Stage 2 page selection
  scriptCount: number;
};

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
};

export type RunMeta = {
  provider: string;
  model: string;
  pagesFetched: string[];
  wordsExtracted: number;
  fetchMs: number;
  modelMs: number;
  totalMs: number;
  usage?: TokenUsage;
};

export type OpenerSuccess = {
  status: "ok";
  companySummary: string;
  observation: string;
  supportingQuote: string; // as cited by the model; NOT verified in Stage 1
  sourceUrl: string;
  interpretation: string;
  lines: [string, string, string];
  meta: RunMeta;
};

export type InsufficientReason = "js_rendered" | "thin_content" | "model_insufficient";

export type OpenerInsufficient = {
  status: "insufficient";
  reason: InsufficientReason;
  message: string;
  meta: Partial<RunMeta>;
};

export type ErrorCode =
  | "INVALID_INPUT"
  | "INVALID_URL"
  | "BLOCKED_HOST"
  | "DNS_FAILED"
  | "TIMEOUT"
  | "HTTP_ERROR"
  | "NOT_HTML"
  | "TOO_LARGE"
  | "TOO_MANY_REDIRECTS"
  | "NETWORK"
  | "AI_CONFIG"
  | "AI_RATE_LIMITED"
  | "AI_MODEL_UNAVAILABLE"
  | "AI_TIMEOUT"
  | "AI_BLOCKED"
  | "AI_BAD_RESPONSE"
  | "AI_PROVIDER_ERROR"
  | "INTERNAL";

export type OpenerError = {
  status: "error";
  code: ErrorCode;
  message: string;
};

export type GenerateResponse = OpenerSuccess | OpenerInsufficient | OpenerError;
