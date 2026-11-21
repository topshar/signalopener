"use client";

import { useRef, useState, type FormEvent } from "react";
import { LoadingSteps } from "@/components/LoadingSteps";
import { ErrorNotice, InsufficientNotice } from "@/components/Notice";
import { ResultView } from "@/components/ResultView";
import type { GenerateResponse } from "@/lib/types";

const MAX_SENDER_CONTEXT = 300;
const MAX_PASTED_TEXT = 20_000;

type RunRequest = { url: string; senderContext: string; pastedText?: string };

/** Failures where pasting the site's text is the sensible next step. */
function suggestsPaste(result: GenerateResponse | null): boolean {
  if (!result) return false;
  if (result.status === "error") {
    return ["BLOCKED_BY_SITE", "HTTP_ERROR", "TIMEOUT", "NETWORK", "NOT_HTML"].includes(result.code);
  }
  return result.status === "insufficient" && result.reason !== "model_insufficient";
}

const inputClass =
  "mt-2 w-full rounded-lg border border-line-strong bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15";

export default function Home() {
  const [url, setUrl] = useState("");
  const [senderContext, setSenderContext] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  // What the current result came from, so retry and "Different angle" reuse it
  // even if the user has started editing the form.
  const [lastRequest, setLastRequest] = useState<RunRequest | null>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);

  async function run(request: RunRequest, avoidObservation?: string) {
    if (loading) return;
    setLoading(true);
    setResult(null);
    setLastRequest(request);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, avoidObservation }),
      });
      setResult((await res.json()) as GenerateResponse);
    } catch {
      setResult({
        status: "error",
        code: "NETWORK",
        message: "Couldn't reach SignalOpener's server. Check your connection and try again.",
      });
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    run({
      url: url.trim(),
      senderContext: senderContext.trim(),
      pastedText: pasteMode ? pastedText : undefined,
    });
  }

  function openPaste() {
    setPasteMode(true);
    setTimeout(() => {
      pasteRef.current?.focus();
      pasteRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }

  const onRetry = () => lastRequest && run(lastRequest);
  const onRegenerate = () =>
    result?.status === "ok" && lastRequest && run(lastRequest, result.observation);

  const canSubmit = url.trim() && (!pasteMode || pastedText.trim());

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-[720px] items-center px-5 pt-6 sm:px-6">
        <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" aria-hidden />
          SignalOpener
        </span>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-5 pb-20 pt-12 sm:px-6 sm:pt-16">
        <h1 className="text-[30px] font-semibold leading-[1.15] tracking-tight sm:text-[38px]">
          Founder openers built from what their website actually says.
        </h1>
        <p className="mt-4 max-w-[560px] text-[16px] leading-relaxed text-ink-soft">
          Paste a company&apos;s website. SignalOpener picks one specific detail from it and drafts a
          three-line cold email opener you can check before you send.
        </p>
        <ol className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-muted">
          {["Reads up to four pages", "Picks one specific fact", "Checks the quote word for word"].map(
            (step, i) => (
              <li key={step} className="flex items-center gap-1.5">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">
                  {i + 1}
                </span>
                {step}
              </li>
            ),
          )}
        </ol>

        <form
          onSubmit={onSubmit}
          className="mt-8 space-y-5 rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(14,26,51,0.04)] sm:p-6"
        >
          <div>
            <label htmlFor="url" className="text-[14px] font-medium text-ink">
              Company website
            </label>
            <input
              id="url"
              name="url"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="acme.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              maxLength={2048}
              className={`${inputClass} h-11`}
            />
          </div>

          {pasteMode && (
            <div className="rounded-lg border border-accent/25 bg-accent-soft/50 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="pasted" className="text-[14px] font-medium text-ink">
                  Text from their website
                </label>
                <button
                  type="button"
                  onClick={() => setPasteMode(false)}
                  className="text-[13px] text-accent underline-offset-2 hover:underline"
                >
                  Read the website instead
                </button>
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                Open their About, Product or Pricing page in your browser, select all (Ctrl+A or ⌘A),
                copy and paste it here. The quote is checked against this text.
              </p>
              <textarea
                ref={pasteRef}
                id="pasted"
                rows={6}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value.slice(0, MAX_PASTED_TEXT))}
                placeholder="Paste the page text here…"
                className={`${inputClass} resize-y py-2.5 leading-relaxed`}
              />
              <p className="mt-1 text-right text-[12px] tabular-nums text-muted">
                {pastedText.length.toLocaleString()}/{MAX_PASTED_TEXT.toLocaleString()}
              </p>
            </div>
          )}

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="sender" className="text-[14px] font-medium text-ink">
                What are you reaching out about?{" "}
                <span className="font-normal text-muted">Optional</span>
              </label>
              <span className="text-[12px] tabular-nums text-muted">
                {senderContext.length}/{MAX_SENDER_CONTEXT}
              </span>
            </div>
            <textarea
              id="sender"
              name="sender"
              rows={2}
              placeholder="I help SaaS companies improve customer onboarding with AI automation."
              value={senderContext}
              onChange={(e) => setSenderContext(e.target.value.slice(0, MAX_SENDER_CONTEXT))}
              className={`${inputClass} min-h-[88px] resize-none py-2.5 leading-relaxed sm:min-h-0`}
            />
            <p className="mt-1.5 text-[13px] text-muted">
              Shapes the last line so it connects to why you&apos;re writing.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-ink px-5 text-[15px] font-medium text-white transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {loading ? "Researching…" : pasteMode ? "Generate from pasted text" : "Generate opener"}
            </button>
            {!pasteMode && (
              <button
                type="button"
                onClick={openPaste}
                className="text-left text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                Site won&apos;t load? Paste its text instead
              </button>
            )}
          </div>

        </form>

        <div className="mt-10" aria-live="polite">
          {loading && <LoadingSteps pasted={Boolean(lastRequest?.pastedText)} />}
          {!loading && result?.status === "ok" && (
            <ResultView result={result} onRegenerate={onRegenerate} />
          )}
          {!loading && result?.status === "insufficient" && (
            <InsufficientNotice
              result={result}
              onPaste={suggestsPaste(result) && !pasteMode ? openPaste : undefined}
            />
          )}
          {!loading && result?.status === "error" && (
            <ErrorNotice
              error={result}
              onRetry={onRetry}
              onPaste={suggestsPaste(result) && !pasteMode ? openPaste : undefined}
            />
          )}
        </div>
      </main>

      <footer className="mx-auto w-full max-w-[720px] px-5 sm:px-6">
        <p className="border-t border-line py-6 text-[12px] leading-relaxed text-muted">
          Reads public pages only, at most four per site, and respects sites that block automated
          tools. Quotes and numbers are checked word for word; the interpretation is AI-written, so
          read before you send.
        </p>
      </footer>
    </div>
  );
}
