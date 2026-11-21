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
  internalLinks: string[]; // same-site links, used for page selection
  scriptCount: number;
};

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
};

export type PageRead = { url: string; title: string; category: string };

export type RunMeta = {
  provider: string;
  model: string;
  pagesRead: PageRead[];
  wordsExtracted: number;
  fetchMs: number;
  modelMs: number;
  totalMs: number;
  attempts: number; // generate-and-validate rounds (max 2)
  modelCalls: number; // includes a retry after a provider "busy" error
  usage?: TokenUsage;
};

export type CheckStatus = "pass" | "warn" | "fail";

export type ValidationCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
};

export type Evidence = {
  quote: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceCorrected: boolean; // quote found on a different fetched page than the model cited
};

export type OpenerSuccess = {
  status: "ok";
  companySummary: string;
  observation: string;
  interpretation: string;
  lines: [string, string, string];
  evidence: Evidence;
  checks: ValidationCheck[];
  cached: boolean;
  meta: RunMeta;
};

export type InsufficientReason =
  | "js_rendered"
  | "thin_content"
  | "model_insufficient"
  | "unverified";

export type OpenerInsufficient = {
  status: "insufficient";
  reason: InsufficientReason;
  message: string;
  checks?: ValidationCheck[];
  cached: boolean;
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
  | "RATE_LIMITED"
  | "AI_CONFIG"
  | "AI_RATE_LIMITED"
  | "AI_UNAVAILABLE"
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
