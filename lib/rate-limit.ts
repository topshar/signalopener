// Basic in-memory rate limiting. Its job in this MVP is to stop one visitor (or
// a script) from burning the free-tier model quota for everyone else.
//
// Limitation: per serverless instance, and it resets on cold start. Production
// needs a shared counter (e.g. Upstash Redis) keyed the same way.

const PER_IP_PER_MINUTE = 5;
const PER_IP_PER_DAY = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export type RateLimitResult = { ok: true } | { ok: false; message: string; retryAfterSec: number };

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private globalDay = { start: 0, count: 0 };

  constructor(
    private dailyGlobalLimit: number,
    private now: () => number = Date.now,
  ) {}

  check(ip: string): RateLimitResult {
    const now = this.now();

    if (now - this.globalDay.start >= DAY_MS) this.globalDay = { start: now, count: 0 };
    if (this.globalDay.count >= this.dailyGlobalLimit) {
      return {
        ok: false,
        message: "SignalOpener has reached its daily limit for the free AI tier. Please try again tomorrow.",
        retryAfterSec: Math.ceil((this.globalDay.start + DAY_MS - now) / 1000),
      };
    }

    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < DAY_MS);
    const lastMinute = recent.filter((t) => now - t < MINUTE_MS);
    if (lastMinute.length >= PER_IP_PER_MINUTE) {
      return {
        ok: false,
        message: "Too many requests in a short time. Wait a minute and try again.",
        retryAfterSec: Math.ceil((lastMinute[0] + MINUTE_MS - now) / 1000),
      };
    }
    if (recent.length >= PER_IP_PER_DAY) {
      return {
        ok: false,
        message: "You've reached today's limit for this demo. Please try again tomorrow.",
        retryAfterSec: Math.ceil((recent[0] + DAY_MS - now) / 1000),
      };
    }

    recent.push(now);
    this.hits.set(ip, recent);
    this.globalDay.count++;
    // Keep memory bounded: drop idle IPs occasionally.
    if (this.hits.size > 5000) {
      for (const [key, times] of this.hits) {
        if (!times.some((t) => now - t < DAY_MS)) this.hits.delete(key);
      }
    }
    return { ok: true };
  }
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
