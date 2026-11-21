"use client";

import { useState, type FormEvent } from "react";
import { LoadingSteps } from "@/components/LoadingSteps";
import { ErrorNotice, InsufficientNotice } from "@/components/Notice";
import { ResultView } from "@/components/ResultView";
import type { GenerateResponse } from "@/lib/types";

const MAX_SENDER_CONTEXT = 300;

export default function Home() {
  const [url, setUrl] = useState("");
  const [senderContext, setSenderContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  // What the current result was generated from, so "Different angle" reuses it
  // even if the user has started editing the form.
  const [lastRequest, setLastRequest] = useState<{ url: string; senderContext: string } | null>(
    null,
  );

  async function run(request: { url: string; senderContext: string }, avoidObservation?: string) {
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
      const data = (await res.json()) as GenerateResponse;
      setResult(data);
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
    run({ url: url.trim(), senderContext: senderContext.trim() });
  }

  function onRegenerate() {
    if (result?.status === "ok" && lastRequest) run(lastRequest, result.observation);
  }

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
          Paste a company&apos;s website. SignalOpener reads a few of its pages, picks one specific
          observation and drafts a three-line cold email opener. Every quote is checked against the
          site before you see it.
        </p>

        <form
          onSubmit={onSubmit}
          className="mt-10 space-y-5 rounded-xl border border-line bg-surface p-5 sm:p-6"
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
              className="mt-2 h-11 w-full rounded-lg border border-line-strong bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15"
            />
          </div>

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
              rows={3}
              placeholder="I help SaaS companies improve customer onboarding with AI automation."
              value={senderContext}
              onChange={(e) => setSenderContext(e.target.value.slice(0, MAX_SENDER_CONTEXT))}
              className="mt-2 w-full resize-none rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-[15px] leading-relaxed text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15"
            />
            <p className="mt-1.5 text-[13px] text-muted">
              Shapes the last line so it connects to why you&apos;re writing.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-ink px-5 text-[15px] font-medium text-white transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-auto"
          >
            {loading ? "Researching…" : "Generate opener"}
          </button>
        </form>

        <div className="mt-10" aria-live="polite">
          {loading && <LoadingSteps />}
          {!loading && result?.status === "ok" && (
            <ResultView result={result} onRegenerate={onRegenerate} />
          )}
          {!loading && result?.status === "insufficient" && <InsufficientNotice result={result} />}
          {!loading && result?.status === "error" && <ErrorNotice error={result} />}
        </div>
      </main>
    </div>
  );
}
