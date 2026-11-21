import type { OpenerSuccess } from "@/lib/types";
import { CopyButton } from "./CopyButton";

function formatMeta(meta: OpenerSuccess["meta"]): string {
  const parts = [meta.model, `${(meta.totalMs / 1000).toFixed(1)}s`];
  if (meta.usage?.inputTokens !== undefined) {
    parts.push(
      `${meta.usage.inputTokens.toLocaleString()} in / ${(meta.usage.outputTokens ?? 0).toLocaleString()} out tokens`,
    );
  }
  return parts.join(" · ");
}

function displayHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

export function ResultView({ result }: { result: OpenerSuccess }) {
  const openerText = result.lines.join("\n");

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-6 py-3.5">
          <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted">Opener</h2>
          <CopyButton text={openerText} />
        </div>
        <div className="space-y-3 px-6 py-5">
          {result.lines.map((line, i) => (
            <p key={i} className="text-[17px] leading-relaxed text-ink">
              {line}
            </p>
          ))}
        </div>
      </section>

      <section className="space-y-4 px-1">
        <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted">
          Where this came from
        </h2>

        {result.companySummary && (
          <p className="text-[15px] leading-relaxed text-ink-soft">{result.companySummary}</p>
        )}

        {result.supportingQuote && (
          <figure className="border-l-2 border-accent pl-4">
            <blockquote className="text-[15px] leading-relaxed text-ink">
              &ldquo;{result.supportingQuote}&rdquo;
            </blockquote>
            <figcaption className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              <a
                href={result.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-medium text-accent underline-offset-2 hover:underline"
              >
                {displayHost(result.sourceUrl)}
              </a>
              <span className="rounded bg-warn-soft px-1.5 py-0.5 text-warn">
                Quote not yet checked against the page
              </span>
            </figcaption>
          </figure>
        )}

        {result.interpretation && (
          <div>
            <p className="text-[13px] font-medium text-muted">Our read (interpretation, not a fact)</p>
            <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{result.interpretation}</p>
          </div>
        )}
      </section>

      <p className="px-1 font-mono text-[12px] text-muted">{formatMeta(result.meta)}</p>
    </div>
  );
}
