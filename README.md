# SignalOpener

Paste a company's website and get a three-line cold email opener for its founder, built from something specific the site actually says. Every opener comes with the exact quote it rests on, a link to the page it came from, and a list of checks it passed.

If the site doesn't give it enough to work with, it says so instead of making something up.

## What it does

- Reads the homepage and up to three more pages it picks itself (changelog, pricing, about and so on).
- Finds one concrete observation and writes three lines: what it noticed, why that might matter, and a genuine question.
- Optional "What are you reaching out about?" field so the last line connects to why you're writing.
- Checks the draft in code before showing it: the quote must appear word for word on a page it read, every number must be on the site, no stock sales lines or meeting asks. A failed check gets one retry; a second failure shows "couldn't verify" with the reasons.
- "Different angle" asks for a new observation. Repeat requests within an hour come from cache.
- **Site won't load?** Paste the text from its About, Product or Pricing page instead. The same checks run against the pasted text. This covers sites with bot protection or JavaScript-only rendering without trying to get around them.

## Tech stack

Next.js 16 (App Router, TypeScript), Tailwind CSS 4, Cheerio, Gemini API (free tier, `gemini-3.5-flash-lite`) with OpenRouter as a configurable alternative, Node's built-in test runner. Deploys to Vercel.

Runtime dependencies beyond Next/React: `cheerio` and `geist` (the font). Nothing else.

## Run it locally

Needs Node 20 or newer.

```bash
npm install
cp .env.example .env.local    # Windows: copy .env.example .env.local
# open .env.local and paste your key after GEMINI_API_KEY=
npm run dev                   # http://localhost:3000
```

Get a free Gemini key at https://aistudio.google.com/apikey. Keep it in `.env.local` only; that file is git-ignored.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `AI_PROVIDER` | no | `gemini` | `gemini` or `openrouter`. No automatic fallback between them. |
| `GEMINI_API_KEY` | yes, for Gemini | | Server-side only, never sent to the browser. |
| `GEMINI_MODEL` | no | `gemini-3.5-flash-lite` | Check current free-tier models in AI Studio. |
| `GEMINI_THINKING_LEVEL` | no | `low` | `minimal`, `low`, `medium`, `high`, or empty to send none. |
| `OPENROUTER_API_KEY` | yes, for OpenRouter | | |
| `OPENROUTER_MODEL` | yes, for OpenRouter | | Pick a current `:free` model; they change often. |
| `DAILY_RUN_LIMIT` | no | `200` | App-wide cap per day, protects the free quota. |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` then `npm start` | Production build and server |
| `npm test` | 119 offline tests: no network, no API key, no quota used |
| `npm run lint` | ESLint |

## Architecture

Code handles everything that has to be reliable; the model only reads, chooses the angle and writes.

```
app/page.tsx                 the single page
app/api/generate/route.ts    input checks, URL validation, rate limit
lib/cache.ts                 1-hour result cache
lib/safe-fetch.ts            SSRF-safe fetching with DNS pinning
lib/pages.ts                 which internal pages to read
lib/extract.ts               HTML to clean text (Cheerio); enough content?
lib/prompt.ts                rules, untrusted-data wrapping, retry feedback
lib/ai/                      Gemini and OpenRouter behind one interface
lib/parse.ts                 JSON shape, exactly three lines
lib/validate.ts              quote, source, numbers, phrases, injection checks
lib/injection.ts             spots text aimed at AI tools; never used as evidence
lib/pipeline.ts              runs it all in order, one retry, logging
```

Each run logs one JSON line with timings, attempts and token usage (never page content).

## Limitations

- **JavaScript-only sites** can't be read (no headless browser). The app detects them, says so, and offers the paste-text option.
- **Sites with bot protection** (Cloudflare and similar, including "Just a moment..." challenge pages) get a clear message. SignalOpener respects that choice and doesn't try to get around it.
- **The checks prove the quote and numbers are on the site.** They don't prove the interpretation is right, and numbers written as words aren't checked.
- **The cache and rate limits are in memory**, per serverless instance. Fine for a demo; a real product needs Redis.
- **The free Gemini tier** has low daily limits and occasional "model busy" errors.
- **OpenRouter support** is built but hasn't been tested live.

## More detail

- [`docs/deploy.md`](docs/deploy.md): GitHub and Vercel, step by step
- [`docs/scale-and-cost.md`](docs/scale-and-cost.md): what breaks at 1,000 runs a day, with measured token counts
- [`docs/test-results.md`](docs/test-results.md): what was tested, live or offline, and what testing caught
- [`docs/decisions.md`](docs/decisions.md): what's in, what's out, and why
- [`docs/submission-notes.md`](docs/submission-notes.md): drafts for the take-home form, plus interview prep
