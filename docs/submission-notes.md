# Ekatra submission notes

Drafts for the form, word-counted with `wc -w`. The form's counter may differ by a word or two, so keep a small margin.

## How to run it (limit 50, draft 39)

Open the demo link, paste a company website and press Generate opener. To run locally: clone the repo, run npm install, copy .env.example to .env.local, add a free Gemini key from aistudio.google.com, then npm run dev and open localhost:3000.

## What runs in code, what runs in the model, what breaks at 1,000 runs a day (limit 150, draft 147)

Code does everything that has to be reliable. It validates the URL, blocks private IPs, pins DNS, fetches the homepage plus up to three pages it picks (changelog, pricing, about) and strips them to text. Then it checks the model's answer: the quote must appear word for word on a fetched page, every number must exist on the site, exactly three lines, no stock sales phrases. If a check fails it retries once with the reasons, then says "not enough evidence" rather than guess.

The model only reads, picks the angle and writes.

At 1,000 runs a day the model isn't what breaks. Gemini 3.5 Flash-Lite measured about 3,100 input and 250 output tokens a run, roughly $0.0016, so about $50 a month. What breaks: free-tier quotas, "model busy" errors, sites that block bots or render in JavaScript, and in-memory caching and rate limits that need Redis.

If it comes out over the limit, cut "(changelog, pricing, about)" first.

## Which tools did you use? (limit 40, draft 25)

Claude (planning, code, review), Next.js, TypeScript, Tailwind CSS, Cheerio, Gemini 3.5 Flash-Lite on the Google AI Studio free tier, Node's built-in test runner, GitHub, Vercel.

## Part 3: what you left out and why (one piece of a 150-word answer)

I left out a headless browser, logins, CRM sync and email sending. One workflow done properly mattered more, and JavaScript-only sites now get an honest "can't read this" instead of a guess. I also dropped an AI quality score, because a model grading itself proves nothing.

The rest of Part 3 (where you want to be in two years, what you're giving up) has to be yours.

---

# Interview prep: the system in plain words

## The flow, in order
1. **Route** (`app/api/generate/route.ts`): checks the input, validates the URL, then applies the rate limit (5 a minute, 30 a day per visitor, plus an app-wide daily cap).
2. **Cache** (`lib/cache.ts`): the same site and sender text within an hour returns the stored result.
3. **Fetch** (`lib/safe-fetch.ts`): resolves DNS once, refuses private/loopback/metadata IPs, and connects to that exact IP (stops DNS rebinding). Follows at most 3 redirects, re-checking each. 8s timeout, 1.5MB cap after decompression, HTML only.
4. **Pick pages** (`lib/pages.ts`): from the homepage's own links, up to 3 of changelog, pricing, about, product, customers, blog, careers, in that priority order.
5. **Extract** (`lib/extract.ts`): Cheerio strips nav, footer, scripts and cookie banners; keeps title, meta, JSON-LD, headings and body text, capped per page. Too little text means "insufficient" with no model call.
6. **Prompt** (`lib/prompt.ts`): rules, then the pages inside a data block marked untrusted, the sender context, today's date and (on retry) the reasons the last answer failed.
7. **Model** (`lib/ai/`): one JSON call. A 503 gets one retry after 1.5s. Swapping Gemini for OpenRouter is a config change.
8. **Validate** (`lib/validate.ts`): quote word for word on a fetched page; source was fetched; every number on the site; three lines under 40 words; no stock phrases or meeting asks; line 1 shares the quote's key words (warning only); injection signals reported. A hard failure triggers one retry with the reasons; a second failure returns "unverified" with the failed checks.

## Questions they may ask
- **"Why not trust the prompt?"** Prompts are requests. The checks are code. The prompt makes good output likely; the checks make bad output visible.
- **"Can quote checking be fooled?"** Yes, in two ways. A real quote can be used for a misleading claim; the line-1 check and the "interpretation" label limit that, and the UI says the interpretation isn't verified. And a site can plant text; that's why instruction-like lines are excluded from evidence (testing found that exact hole).
- **"Why Flash-Lite?"** Measured. Flash spent 2,201 thinking tokens on a 196-token answer and timed out under load. Flash-Lite took 4-6s with good output.
- **"Why no headless browser?"** Heavy, slow and costly on serverless. Detecting JavaScript-only sites honestly was the better two-hour trade.
- **"What would you build next?"** Redis for cache and limits, a paid Gemini project, then measure real fetch failure rates before buying a rendering service.

See `scale-and-cost.md`, `test-results.md` and `decisions.md` for the details.
