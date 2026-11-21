import type { OpenerError, OpenerInsufficient } from "@/lib/types";

const INSUFFICIENT_TITLES: Record<OpenerInsufficient["reason"], string> = {
  js_rendered: "We couldn't read this website's content",
  thin_content: "Not enough on the page to work with",
  model_insufficient: "No honest observation to make",
};

export function InsufficientNotice({ result }: { result: OpenerInsufficient }) {
  return (
    <div className="rounded-xl border border-line bg-warn-soft/60 p-6">
      <p className="text-[15px] font-semibold text-ink">{INSUFFICIENT_TITLES[result.reason]}</p>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{result.message}</p>
      <p className="mt-4 text-[13px] text-muted">
        SignalOpener only writes openers it can ground in the website. When there isn&apos;t enough
        to go on, it says so rather than guessing.
      </p>
    </div>
  );
}

export function ErrorNotice({ error }: { error: OpenerError }) {
  return (
    <div className="rounded-xl border border-danger/20 bg-danger-soft p-6" role="alert">
      <p className="text-[15px] font-semibold text-danger">Couldn&apos;t generate an opener</p>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{error.message}</p>
    </div>
  );
}
