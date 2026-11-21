import { AppError } from "./errors";

export type ParsedOutput =
  | { kind: "insufficient"; reason: string }
  | {
      kind: "ok";
      companySummary: string;
      observation: string;
      supportingQuote: string;
      sourceUrl: string;
      interpretation: string;
      lines: [string, string, string];
    };

function badResponse(detail: string): AppError {
  return new AppError(
    "AI_BAD_RESPONSE",
    "The AI model returned a response we couldn't use. Try again.",
    502,
    detail,
  );
}

/** Pulls a JSON object out of model text, tolerating ```json fences or stray prose. */
function extractJsonObject(text: string): unknown {
  const unfenced = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start === -1 || end <= start) throw badResponse("no JSON object in model output");
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      throw badResponse("model output is not valid JSON");
    }
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Removes list markers a model sometimes adds: "1. ", "- ", "Line 1: ". */
function cleanLine(line: string): string {
  return line
    .replace(/^\s*(line\s*\d+\s*[:.-]\s*)/i, "")
    .replace(/^\s*(\d+[.)]|[-*•])\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Validates the model's JSON in code, independent of whatever the model claims.
 * Stage 1 checks shape and enforces exactly three non-empty lines.
 * Stage 2 adds quote and source verification against the fetched pages.
 */
export function parseModelOutput(text: string): ParsedOutput {
  const data = extractJsonObject(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw badResponse("model output is not a JSON object");
  }
  const o = data as Record<string, unknown>;

  if (o.insufficient_evidence === true) {
    return {
      kind: "insufficient",
      reason:
        str(o.insufficient_reason) ||
        "The website didn't contain enough specific information for an evidence-based opener.",
    };
  }

  let rawLines: string[] = [];
  if (Array.isArray(o.opener_lines)) {
    rawLines = o.opener_lines.filter((l): l is string => typeof l === "string");
  } else if (typeof o.opener_lines === "string") {
    rawLines = o.opener_lines.split("\n");
  }
  // A single array item containing newlines is still three lines.
  const lines = rawLines.flatMap((l) => l.split("\n")).map(cleanLine).filter(Boolean);

  if (lines.length !== 3) {
    throw badResponse(`expected 3 lines, got ${lines.length}`);
  }

  return {
    kind: "ok",
    companySummary: str(o.company_summary),
    observation: str(o.observation),
    supportingQuote: str(o.supporting_quote),
    sourceUrl: str(o.source_url),
    interpretation: str(o.interpretation),
    lines: [lines[0], lines[1], lines[2]],
  };
}
