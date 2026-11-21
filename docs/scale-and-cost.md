# What breaks at 1,000 runs a day

Every number below is labelled **measured** (from a real run of this app) or **estimate** (worked out from stated assumptions). Prices were checked on Google's Gemini pricing page in November 2026 and will change.

## What one run costs

**Measured** with `gemini-3.5-flash-lite` on the free tier, 21 Nov 2026:

| Site | Pages read | Input tokens | Output tokens | Thinking tokens | Model time |
|---|---|---|---|---|---|
| joinekatra.com | 2 | 3,140 | 246 | none reported | 5.7s |
| targetagility.com | 1 | 2,452 | 244 | none reported | 4.3s |

**Paid price** for Gemini 3.5 Flash-Lite: $0.30 per 1M input tokens, $2.50 per 1M output tokens.

**Estimate per run:**
- Typical (about 2,800 in / 250 out): 2,800 × $0.30/1M + 250 × $2.50/1M ≈ **$0.0015**
- Allowing for retries (assume 15% of runs need the second attempt): ≈ **$0.0017**
- Worst case (4 full pages ≈ 4,800 in, two attempts): ≈ **$0.0044**

**At 1,000 runs a day:** about **$1.70 a day, or $50 a month**. The model bill is not what breaks.

### Why the model choice mattered
Stage 1 used `gemini-3.5-flash`. **Measured:** 2,368 input, 196 output and **2,201 thinking tokens**, 11.9s of model time. Thinking is billed as output, so the reasoning cost about 11 times as many output tokens as the email itself. In Stage 2 the same model then timed out twice at 25s. Flash-Lite answered in 4-6s with no reported thinking tokens and good openers. For a three-line email, the smaller model is the right call.

## What actually breaks

1. **The free tier.** Free-tier limits are per project and per day, they're lower than 1,000 requests, and Google has cut them without much notice. 1,000 runs a day needs a paid Gemini project. At the cost above that's cheap, but it's a hard switch, not a gradual one.
2. **"Model busy" errors.** **Measured:** `gemini-3.5-flash` returned a 503 "high demand" once and timed out twice in five calls. Flash-Lite: none in two. The app retries a 503 once, but at volume you'd want a queue with backoff and possibly a second provider. That's a deliberate choice, not a silent fallback.
3. **Websites that don't want to be read.** Some sites block datacenter IPs (403/429), and many SaaS sites render in JavaScript, so a plain fetch gets an empty shell. The app detects both and says so honestly, but at 1,000 runs a day a meaningful share would fail this way. **Not measured yet:** the share depends on whose sites you're targeting. Fixing it means a headless-browser or scraping service, which is the biggest new cost line.
4. **Memory that isn't shared.** The cache (same site within an hour) and the rate limits live in each serverless instance's memory. At volume, instances multiply and both stop working reliably. The fix is a shared store such as Redis.
5. **Hosting terms and time.** Each run spends 5-15s mostly waiting on network calls. **Estimate:** 1,000 runs × ~10s ≈ 3 hours of function time a day, well within normal limits. Vercel's Hobby plan is for personal, non-commercial use, so a real product would need a paid plan.
6. **Bursts.** 1,000 a day averages under one a minute, but real traffic comes in bursts. Paid-tier per-minute limits cover that comfortably; the free tier doesn't.

## What I'd change first, in order
1. Paid Gemini project (minutes of work, ~$50/month).
2. Redis for cache and rate limits (one small module swap; the interfaces are already isolated in `lib/cache.ts` and `lib/rate-limit.ts`).
3. Measure fetch failure rates on real target sites, and only then decide whether a rendering service is worth its cost.
4. A queue for model calls, so bursts and 503s wait instead of failing.
