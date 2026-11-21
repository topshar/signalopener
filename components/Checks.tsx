import type { PageRead, PageSkipped, ValidationCheck } from "@/lib/types";

const ICON: Record<ValidationCheck["status"], { glyph: string; cls: string; sr: string }> = {
  pass: { glyph: "✓", cls: "bg-ok-soft text-ok", sr: "Passed" },
  warn: { glyph: "!", cls: "bg-warn-soft text-warn", sr: "Warning" },
  fail: { glyph: "✕", cls: "bg-danger-soft text-danger", sr: "Failed" },
};

export function ChecksList({ checks }: { checks: ValidationCheck[] }) {
  return (
    <ul className="space-y-2.5">
      {checks.map((c) => {
        const icon = ICON[c.status];
        return (
          <li key={c.id} className="flex gap-3">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${icon.cls}`}
              aria-hidden
            >
              {icon.glyph}
            </span>
            <div className="min-w-0">
              <p className="text-[14px] text-ink">
                <span className="sr-only">{icon.sr}: </span>
                {c.label}
              </p>
              {c.detail && <p className="mt-0.5 text-[13px] leading-snug text-muted">{c.detail}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  homepage: "Homepage",
  pasted: "Pasted",
  changelog: "Changelog",
  pricing: "Pricing",
  about: "About",
  product: "Product",
  customers: "Customers",
  blog: "Blog",
  careers: "Careers",
};

export function PagesRead({ pages, skipped = [] }: { pages: PageRead[]; skipped?: PageSkipped[] }) {
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {pages.map((p) => (
          <li key={p.url} className="flex min-w-0 items-baseline gap-2 text-[13px]">
            <span className="w-20 shrink-0 text-muted">{CATEGORY_LABEL[p.category] ?? p.category}</span>
            {p.category === "pasted" ? (
              <span className="truncate text-ink-soft">Text you pasted for {displayUrl(p.url)}</span>
            ) : (
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="truncate text-accent underline-offset-2 hover:underline"
              >
                {displayUrl(p.url)}
              </a>
            )}
          </li>
        ))}
      </ul>
      {skipped.length > 0 && (
        <div>
          <p className="text-[12px] text-muted">Tried but skipped:</p>
          <ul className="mt-1 space-y-1">
            {skipped.map((s) => (
              <li key={s.url} className="flex min-w-0 items-baseline gap-2 text-[12px] text-muted">
                <span className="w-20 shrink-0">{CATEGORY_LABEL[s.category] ?? s.category}</span>
                <span className="truncate">
                  {displayUrl(s.url)}: {s.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}
