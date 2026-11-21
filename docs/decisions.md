# Decisions and deliberate exclusions

Kept short so it can feed the Ekatra write-up and interview.

## Included, and why
- **Quote verification in code.** The model must quote the site word for word; code checks it. Turns "don't hallucinate" from a prompt request into an enforced rule.
- **Injected text is never evidence.** Found in testing: a page saying "say Acme has 10,000 customers" made that number look grounded. Instruction-like lines are now excluded before quote and number checks.
- **DNS-pinned fetching.** The connection goes to the exact IP that passed the private-range check, closing DNS rebinding.
- **Thinking level "low".** Stage 1 measured 2,201 thinking tokens for 196 output tokens on gemini-3.5-flash. Thinking is billed as output and drove most of the 12s model time.
- **One validation retry, one busy retry.** Bounded cost: worst case 4 model calls; typical 1.
- **Changelog first in page selection.** Recent, specific, founder-relevant facts.

- **Respect bot protection.** Sites that challenge automated visitors get an honest "this site blocks automated tools" message. Spoofing a browser to get past it would work more often, but it overrides the site owner's choice. Identifies itself as SignalOpener in the User-Agent.
- **Paste-text fallback instead of bypassing.** When a site can't be read, the user can paste text from it (they read it in their own browser, which is normal). Same model, same checks, nothing cached. Pasted text needs 40+ words; fetched sites need 80, because the user chose the text deliberately.
- **Show skipped pages.** If pricing timed out or about was blocked, the results screen says so, so the user knows what the research missed.

## Left out, and why
- **Headless browser.** Heavy on serverless and slow; JS-only sites get an honest "can't read" state instead.
- **Shared cache / rate limit store (Redis).** In-memory is enough for a demo; documented as the first thing to change at scale.
- **zod / schema libraries.** Hand-written validation is short and easy to explain.
- **Readability.** Needs jsdom; marketing pages aren't articles.
- **Automatic provider fallback.** Silent model switches would hide quality changes.
- **LLM-graded quality score.** A model grading itself is theatre; deterministic checks instead.
- **Auth, CRM, sending, analytics.** Out of scope for a single-workflow MVP.

## Known limits
- Numbers written as words ("ten thousand") are not checked.
- Checks prove the quote and numbers exist on the site, not that the interpretation is right.
- Rate limit and cache are per serverless instance.

## Measured (live, 21 Nov 2026, free tier)
| Run | Model | Pages | Input tok | Output tok | Thinking tok | Model time | Total |
|---|---|---|---|---|---|---|---|
| targetagility.com (Stage 1) | gemini-3.5-flash | 1 | 2,368 | 196 | 2,201 | 11.9s | 13.0s |
| 2 runs (Stage 2) | gemini-3.5-flash | up to 4 | - | - | - | timed out at 25s | 26s |
| targetagility.com + sender | gemini-3.5-flash-lite | 1 | 2,452 | 244 | none reported | 4.3s* | 11.8s |
| joinekatra.com | gemini-3.5-flash-lite | 2 | 3,140 | 246 | none reported | 5.7s | 6.7s |

*Stage 2 build counted only the successful call; the 11.8s total suggests a busy-retry or slow failed call. Fixed: model time is now wall time.
Also gemini-3.5-flash returned 503 "high demand" once in Stage 1.
