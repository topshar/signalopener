// In-memory result cache: same site + same sender context within an hour
// returns the stored result instead of spending another model call.
//
// Limitation: on serverless each warm instance has its own memory, so this is
// best-effort. A shared store (e.g. Redis) is the production answer.

const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 200;

type Entry<T> = { value: T; expires: number };

export class TtlCache<T> {
  private store = new Map<string, Entry<T>>();

  constructor(
    private ttlMs = TTL_MS,
    private maxEntries = MAX_ENTRIES,
    private now: () => number = Date.now,
  ) {}

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    this.store.delete(key);
    this.store.set(key, { value, expires: this.now() + this.ttlMs });
    // Map keeps insertion order, so the first key is the oldest.
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}

export function cacheKey(url: URL, senderContext: string): string {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return `${host}${path}|${senderContext.trim().toLowerCase().replace(/\s+/g, " ")}`;
}
