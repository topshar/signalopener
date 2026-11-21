# SignalOpener

Paste a company's website and get a three-line cold email opener for its founder, grounded in what the site actually says. Each opener comes with the quote and source page it's based on.

**Status: Stage 1 (basic end-to-end).** Homepage only. Quotes are shown but not yet verified against the page; that arrives in Stage 2.

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
| `OPENROUTER_API_KEY` | for OpenRouter | Server-side only. |
| `OPENROUTER_MODEL` | for OpenRouter | Pick a current `:free` model; availability changes often. |

## Scripts

- `npm run dev`: development server
- `npm run build && npm start`: production build
- `npm test`: offline tests (URL guard, IP blocklist, extraction, output parsing). No network or API key needed.
- `npm run lint`

## How it works

```
POST /api/generate { url, senderContext? }
  lib/url.ts          validate and normalise the URL
  lib/ai/index.ts     load provider config (fails fast if the key is missing)
  lib/safe-fetch.ts   fetch homepage: DNS + private-IP check, manual redirects (max 3,
                      each re-checked), 8s timeout, 2MB cap, HTML only
  lib/extract.ts      Cheerio: title, meta, JSON-LD, headings, cleaned body text
                      -> too little text? return "insufficient" without calling the model
  lib/prompt.ts       system rules + page content wrapped as untrusted data
  lib/ai/*.ts         one model call, JSON output
  lib/parse.ts        validate JSON in code, enforce exactly 3 non-empty lines
```

Everything except the model call is deterministic code.
