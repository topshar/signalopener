import type { OpenerSuccess } from "@/lib/types";
import { ChecksList, displayUrl, PagesRead } from "./Checks";
import { CopyButton } from "./CopyButton";

function formatMeta(meta: OpenerSuccess["meta"]): string {
  const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const parts = [
    meta.model,
    `${s(meta.totalMs)} (fetch ${s(meta.fetchMs)}, model ${s(meta.modelMs)})`,
  ];
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
  const { evidence } = result;
  const quoteVerified = result.checks.find((c) => c.id === "quote")?.status === "pass";

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-line bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-6">
          <SectionTitle>Opener</SectionTitle>
          <div className="flex items-center gap-2">
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
        <div className="space-y-3 px-5 py-5 sm:px-6">
          {result.lines.map((line, i) => (
            <p key={i} className="text-[17px] leading-relaxed text-ink">
              {line}
            </p>
          ))}
        </div>
        {result.cached && (
          <p className="border-t border-line px-5 py-2.5 text-[12px] text-muted sm:px-6">
            Same result as a request in the last hour. Use &ldquo;Different angle&rdquo; for a new one.
          </p>
        )}
      </section>

      <section className="space-y-3 px-1">
        <SectionTitle>Evidence from the website</SectionTitle>
        <figure className="border-l-2 border-accent pl-4">
          <blockquote className="text-[15px] leading-relaxed text-ink">
            &ldquo;{evidence.quote}&rdquo;
          </blockquote>
          <figcaption className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
            <a
              href={evidence.sourceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              {displayUrl(evidence.sourceUrl)}
            </a>
            {quoteVerified && (
              <span className="rounded bg-ok-soft px-1.5 py-0.5 font-medium text-ok">
                Found word for word on this page
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
          <ChecksList checks={result.checks} />
          <p className="text-[12px] leading-relaxed text-muted">
            These checks confirm the quote and any numbers really appear on the site. They can&apos;t
            confirm the interpretation is right, so read the opener before you send it.
          </p>
        </div>
        <div className="space-y-3">
          <SectionTitle>Pages read</SectionTitle>
          <PagesRead pages={result.meta.pagesRead} />
        </div>
      </section>

      <p className="px-1 font-mono text-[12px] leading-relaxed text-muted">{formatMeta(result.meta)}</p>
    </div>
  );
}
