import { AppError } from "@/lib/errors";
import { generateOpener } from "@/lib/pipeline";
import { MAX_SENDER_CONTEXT } from "@/lib/prompt";
import type { GenerateResponse, OpenerError } from "@/lib/types";

// Fetch (8s) + model (45s) with headroom. Vercel Hobby allows up to 300s.
export const maxDuration = 60;

function errorResponse(err: AppError): Response {
  const body: OpenerError = { status: "error", code: err.code, message: err.message };
  return Response.json(body satisfies GenerateResponse, { status: err.httpStatus });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(new AppError("INVALID_INPUT", "Request body must be JSON."));
  }

  const { url, senderContext } = (body ?? {}) as Record<string, unknown>;
  if (typeof url !== "string") {
    return errorResponse(new AppError("INVALID_INPUT", "Enter a company website address."));
  }
  if (senderContext !== undefined && typeof senderContext !== "string") {
    return errorResponse(new AppError("INVALID_INPUT", "Sender context must be text."));
  }
  if (typeof senderContext === "string" && senderContext.length > MAX_SENDER_CONTEXT) {
    return errorResponse(
      new AppError(
        "INVALID_INPUT",
        `Keep "what you're reaching out about" under ${MAX_SENDER_CONTEXT} characters.`,
      ),
    );
  }

  try {
    const result = await generateOpener({ url, senderContext: senderContext ?? "" });
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
