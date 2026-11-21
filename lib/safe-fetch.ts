import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "./errors";
import { isBlockedIp } from "./ip";
import { assertUrlShape } from "./url";

export type FetchedPage = {
  requestedUrl: string;
  finalUrl: string;
  html: string;
  truncated: boolean;
};

type Options = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

const USER_AGENT =
  "Mozilla/5.0 (compatible; SignalOpener/0.1; company research for outreach drafts)";

/**
 * Resolves the hostname and refuses if ANY resolved address is private.
 * Checking all addresses stops "one public + one private A record" tricks.
 *
 * Known gap (fixed in Stage 2): fetch() does its own DNS lookup after this
 * check, so a hostile DNS server could answer differently the second time
 * (DNS rebinding). Closing that needs the connection pinned to the IP we
 * checked here.
 */
async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");

  if (isIP(host)) {
    if (isBlockedIp(host)) {
      throw new AppError("BLOCKED_HOST", "That address points to a private network.");
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new AppError("DNS_FAILED", "We couldn't find that domain. Check the spelling.");
  }
  if (addresses.length === 0 || addresses.some((a) => isBlockedIp(a.address))) {
    throw new AppError("BLOCKED_HOST", "That domain resolves to a private network address.");
  }
}

function isHtml(contentType: string | null): boolean {
  if (!contentType) return true; // many small sites omit it; the extractor copes
  const ct = contentType.toLowerCase();
  return ct.includes("text/html") || ct.includes("application/xhtml+xml");
}

function charsetFrom(contentType: string | null): string {
  const m = contentType?.match(/charset=["']?([\w-]+)/i);
  return m ? m[1].toLowerCase() : "utf-8";
}

/** Reads the body as text, stopping at maxBytes instead of loading it all. */
async function readCapped(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - received;
    if (value.byteLength >= remaining) {
      chunks.push(value.subarray(0, remaining));
      received += remaining;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    received += value.byteLength;
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }

  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charsetFrom(res.headers.get("content-type")));
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return { text: decoder.decode(bytes), truncated };
}

/**
 * Fetches one HTML page with SSRF protections:
 * - http/https on ports 80/443 only, no embedded credentials
 * - DNS resolved and every address checked against private ranges
 * - redirects followed manually (max 3) and every hop re-checked
 * - one timeout covering the whole operation, including the body
 * - body capped at maxBytes; non-HTML responses rejected
 */
export async function safeFetchHtml(url: URL, opts: Options = {}): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const maxRedirects = opts.maxRedirects ?? 3;

  const signal = AbortSignal.timeout(timeoutMs);
  let current = new URL(url.toString());

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      assertUrlShape(current);
      await assertPublicHost(current.hostname);

      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-language": "en;q=0.9",
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location) {
          throw new AppError("HTTP_ERROR", "The website sent a redirect with no destination.");
        }
        current = new URL(location, current);
        current.hash = "";
        continue;
      }

      if (!res.ok) {
        await res.body?.cancel();
        const blockedHint =
          res.status === 403 || res.status === 429 || res.status === 503
            ? " The site may be blocking automated requests."
            : "";
        throw new AppError(
          "HTTP_ERROR",
          `The website responded with an error (HTTP ${res.status}).${blockedHint}`,
          502,
        );
      }

      const contentType = res.headers.get("content-type");
      if (!isHtml(contentType)) {
        await res.body?.cancel();
        throw new AppError("NOT_HTML", "That address doesn't return a web page (HTML).");
      }

      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > maxBytes * 5) {
        await res.body?.cancel();
        throw new AppError("TOO_LARGE", "That page is too large to analyse.");
      }

      const { text, truncated } = await readCapped(res, maxBytes);
      return { requestedUrl: url.toString(), finalUrl: current.toString(), html: text, truncated };
    }

    throw new AppError("TOO_MANY_REDIRECTS", "The website redirected too many times.");
  } catch (err) {
    if (err instanceof AppError) throw err;
    const name = (err as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new AppError("TIMEOUT", "The website took too long to respond.", 504);
    }
    throw new AppError(
      "NETWORK",
      "We couldn't connect to that website.",
      502,
      String((err as Error)?.cause ?? err),
    );
  }
}
