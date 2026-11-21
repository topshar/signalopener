import type { PageRead, ValidationCheck } from "@/lib/types";

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
  changelog: "Changelog",
  pricing: "Pricing",
  about: "About",
  product: "Product",
  customers: "Customers",
  blog: "Blog",
  careers: "Careers",
};

export function PagesRead({ pages }: { pages: PageRead[] }) {
  return (
    <ul className="space-y-1.5">
      {pages.map((p) => (
        <li key={p.url} className="flex min-w-0 items-baseline gap-2 text-[13px]">
          <span className="w-20 shrink-0 text-muted">{CATEGORY_LABEL[p.category] ?? p.category}</span>
          <a
            href={p.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="truncate text-accent underline-offset-2 hover:underline"
          >
            {displayUrl(p.url)}
          </a>
        </li>
      ))}
    </ul>
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
