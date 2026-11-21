"use client";

import { useEffect, useState } from "react";

// Timed labels for the one request in flight. They describe the real stages of
// the pipeline, but the timing is approximate (the server doesn't stream progress).
const STEPS = [
  { label: "Fetching the homepage", at: 0 },
  { label: "Reading and cleaning the content", at: 2500 },
  { label: "Finding a specific observation and drafting", at: 5000 },
];

export function LoadingSteps() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - started), 250);
    return () => clearInterval(id);
  }, []);

  const active = STEPS.reduce((idx, s, i) => (elapsed >= s.at ? i : idx), 0);

  return (
    <div className="rounded-xl border border-line bg-surface p-6" role="status" aria-live="polite">
      <ol className="space-y-3">
        {STEPS.map((step, i) => {
          const done = i < active;
          const current = i === active;
          return (
            <li key={step.label} className="flex items-center gap-3 text-[15px]">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                  done
                    ? "border-accent bg-accent text-white"
                    : current
                      ? "border-accent text-accent"
                      : "border-line-strong text-transparent"
                }`}
                aria-hidden
              >
                {done ? "✓" : current ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> : ""}
              </span>
              <span className={done ? "text-muted" : current ? "text-ink" : "text-muted/70"}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-5 text-[13px] text-muted">Usually takes 5 to 20 seconds.</p>
    </div>
  );
}
