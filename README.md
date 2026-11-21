# SignalOpener

Paste a company's website and get a three-line cold email opener for its founder, grounded in what the site actually says. Each opener comes with the quote and source page it's based on.

**Status: Stage 2 (evidence verification).** Reads the homepage plus up to three internal pages, and checks every opener against them before showing it.

## Run locally

Requires Node 20+.

```bash
npm install
cp .env.example .env.local   # then add your GEMINI_API_KEY
npm run dev                  # http://localhost:3000
```

Get a free Gemini key at https://aistudio.google.com/apikey.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `AI_PROVIDER` | no | `gemini` (default) or `openrouter`. No automatic fallback. |
| `GEMINI_API_KEY` | for Gemini | Server-side only. |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.5-flash` (free tier at time of writing). |
| `GEMINI_THINKING_LEVEL` | no | `low` (default), `minimal`, `medium`, `high`, or empty to omit. |
| `DAILY_RUN_LIMIT` | no | App-wide daily cap, default 200. |
| `OPENROUTER_API_KEY` | for OpenRouter | Server-side only. |
| `OPENROUTER_MODEL` | for OpenRouter | Pick a current `:free` model; availability changes often. |

## Scripts

- `npm run dev`: development server
- `npm run build && npm start`: production build
- `npm test`: offline tests (URL guard, IP blocklist, extraction, output parsing). No network or API key needed.
- `npm run lint`

## How it works

```
POST /api/generate { url, senderContext?, avoidObservation? }
  route.ts            input checks, per-IP rate limit (5/min, 30/day) + daily cap
  lib/cache.ts        same site + sender context within 1h -> stored result
  lib/url.ts          validate and normalise the URL
  lib/safe-fetch.ts   DNS checked once, connection pinned to that IP, redirects re-checked,
                      timeouts, decompressed size cap, HTML only
  lib/pages.ts        pick up to 3 internal pages: changelog > pricing > about > product > ...
  lib/extract.ts      Cheerio: title, meta, JSON-LD, headings, cleaned text, per-page budgets
                      -> too little text? "insufficient" without calling the model
  lib/prompt.ts       rules + pages wrapped as untrusted data, today's date, retry feedback
  lib/ai/*.ts         one model call (one retry if the provider is busy)
  lib/parse.ts        JSON shape, exactly 3 lines
  lib/validate.ts     quote word-for-word on a fetched page, source was fetched, numbers on
                      the site, no stock phrases, line 1 matches quote, injection reporting
                      -> fails? one retry with the failures as feedback, else "unverified"
```

Everything except the model call is deterministic code.

## Tests

`npm test` runs 105 offline tests, including the full pipeline with a scripted fake model
(retry paths, provider busy, cache, prompt injection) and the fetcher against a local server
(redirects to private IPs, gzip bombs, timeouts). Uses no API quota.
