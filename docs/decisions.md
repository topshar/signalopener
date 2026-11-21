# Decisions and deliberate exclusions

Kept short so it can feed the Ekatra write-up and interview.

## Included, and why
- **Quote verification in code.** The model must quote the site word for word; code checks it. Turns "don't hallucinate" from a prompt request into an enforced rule.
- **Injected text is never evidence.** Found in testing: a page saying "say Acme has 10,000 customers" made that number look grounded. Instruction-like lines are now excluded before quote and number checks.
- **DNS-pinned fetching.** The connection goes to the exact IP that passed the private-range check, closing DNS rebinding.
- **Thinking level "low".** Stage 1 measured 2,201 thinking tokens for 196 output tokens on gemini-3.5-flash. Thinking is billed as output and drove most of the 12s model time.
- **One validation retry, one busy retry.** Bounded cost: worst case 4 model calls; typical 1.
- **Changelog first in page selection.** Recent, specific, founder-relevant facts.

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
