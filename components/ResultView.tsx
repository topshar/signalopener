import type { OpenerSuccess } from "@/lib/types";
import { ChecksList, displayUrl, PagesRead } from "./Checks";
import { CopyButton } from "./CopyButton";

// What each line is for. Line 1 is grounded in the quote; lines 2 and 3 are
// the model's interpretation and question, and the labels say so.
const LINE_LABELS = ["Observation", "Why it matters", "Question"];

function formatMeta(meta: OpenerSuccess["meta"]): string {
  const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const timing = meta.fetchMs
    ? `${s(meta.totalMs)} (fetch ${s(meta.fetchMs)}, model ${s(meta.modelMs)})`
    : `${s(meta.totalMs)} (model ${s(meta.modelMs)})`;
  const parts = [meta.model, timing];
  const u = meta.usage;
  if (u?.inputTokens) {
    const thinking = u.thinkingTokens ? ` / ${u.thinkingTokens.toLocaleString()} thinking` : "";
    parts.push(
      `${u.inputTokens.toLocaleString()} in / ${(u.outputTokens ?? 0).toLocaleString()} out${thinking} tokens`,
    );
  }
  if (meta.attempts > 1) parts.push(`${meta.attempts} attempts`);
  return parts.join(" · ");
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted">{children}</h2>;
}

export function ResultView({
  result,
  onRegenerate,
}: {
  result: OpenerSuccess;
  onRegenerate: () => void;
}) {
  const { evidence, checks } = result;
  const pasted = evidence.sourceKind === "pasted";
  const quoteVerified = checks.find((c) => c.id === "quote")?.status === "pass";
  const passed = checks.filter((c) => c.status === "pass").length;
  const notes = checks.filter((c) => c.status === "warn").length;
  const where = pasted ? "the text you pasted" : displayUrl(evidence.sourceUrl);

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(14,26,51,0.04)]">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-6">
          <SectionTitle>Opener</SectionTitle>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onRegenerate}
              className="inline-flex h-8 items-center rounded-md px-2.5 text-[13px] font-medium text-ink-soft transition-colors hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Different angle
            </button>
            <CopyButton text={result.lines.join("\n")} />
          </div>
        </div>

        <ol className="divide-y divide-line/70 px-5 sm:px-6">
          {result.lines.map((line, i) => (
            <li key={i} className="grid gap-1 py-4 sm:grid-cols-[120px_1fr] sm:gap-4">
              <span className="pt-1 text-[12px] font-medium uppercase tracking-wide text-muted">
                {LINE_LABELS[i]}
              </span>
              <p className="text-[17px] leading-relaxed text-ink">{line}</p>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-canvas/60 px-5 py-3 text-[13px] sm:px-6">
          {quoteVerified && (
            <span className="font-medium text-ok">✓ Quote verified in {where}</span>
          )}
          <span className="text-muted">
            {passed} of {checks.length} checks passed
            {notes > 0 && `, ${notes} note${notes > 1 ? "s" : ""}`}
          </span>
          {result.cached && (
            <span className="text-muted">· Same as a request in the last hour</span>
          )}
        </div>
      </section>

      <section className="space-y-3 px-1">
        <SectionTitle>Evidence {pasted ? "from your pasted text" : "from the website"}</SectionTitle>
        <figure className="border-l-2 border-accent pl-4">
          <blockquote className="text-[15px] leading-relaxed text-ink">
            &ldquo;{evidence.quote}&rdquo;
          </blockquote>
          <figcaption className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
            {pasted ? (
              <span className="text-ink-soft">Text you pasted for {displayUrl(evidence.sourceUrl)}</span>
            ) : (
              <a
                href={evidence.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-medium text-accent underline-offset-2 hover:underline"
              >
                {displayUrl(evidence.sourceUrl)}
              </a>
            )}
            {quoteVerified && (
              <span className="rounded bg-ok-soft px-1.5 py-0.5 font-medium text-ok">
                Found word for word
              </span>
            )}
          </figcaption>
        </figure>
        {result.companySummary && (
          <p className="pt-1 text-[14px] leading-relaxed text-ink-soft">
            <span className="text-muted">What they do: </span>
            {result.companySummary}
          </p>
        )}
      </section>

      {result.interpretation && (
        <section className="space-y-2 px-1">
          <SectionTitle>Why this angle</SectionTitle>
          <p className="text-[15px] leading-relaxed text-ink-soft">{result.interpretation}</p>
          <p className="text-[12px] text-muted">AI interpretation, not a fact from the website.</p>
        </section>
      )}

      <section className="grid gap-8 px-1 sm:grid-cols-[1.3fr_1fr]">
        <div className="space-y-3">
          <SectionTitle>Checks</SectionTitle>
          <ChecksList checks={checks} />
          <p className="text-[12px] leading-relaxed text-muted">
            These checks confirm the quote and any numbers really appear in the source. They
            can&apos;t confirm the interpretation is right, so read the opener before you send it.
          </p>
        </div>
        <div className="space-y-3">
          <SectionTitle>{pasted ? "Source" : "Pages read"}</SectionTitle>
          <PagesRead pages={result.meta.pagesRead} skipped={result.meta.pagesSkipped} />
        </div>
      </section>

      <p className="px-1 font-mono text-[12px] leading-relaxed text-muted">{formatMeta(result.meta)}</p>
    </div>
  );
}
