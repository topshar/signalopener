import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";
import { AppError } from "./errors";
import { isBlockedIp } from "./ip";
import { assertUrlShape } from "./url";

export type FetchedPage = {
  requestedUrl: string;
  finalUrl: string;
  html: string;
  truncated: boolean;
};

export type FetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

/** Injectable for tests. Production always uses the defaults. */
export type FetchDeps = {
  resolve: (hostname: string) => Promise<string[]>;
  isBlocked: (ip: string) => boolean;
};

const defaultDeps: FetchDeps = {
  resolve: async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address),
  isBlocked: isBlockedIp,
};

const USER_AGENT =
  "Mozilla/5.0 (compatible; SignalOpener/0.2; company research for outreach drafts)";

type Pinned = { address: string; family: 4 | 6 };

/**
 * Resolves the hostname once, refuses if ANY address is private, and returns
 * the address we will connect to. The connection is then pinned to this exact
 * address (see requestOnce), so a second DNS answer can't redirect us to an
 * internal IP. That closes the DNS rebinding gap from Stage 1.
 */
async function resolvePublic(hostname: string, deps: FetchDeps): Promise<Pinned> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host);
  if (literal) {
    if (deps.isBlocked(host)) {
      throw new AppError("BLOCKED_HOST", "That address points to a private network.");
    }
    return { address: host, family: literal as 4 | 6 };
  }

  let addresses: string[];
  try {
    addresses = await deps.resolve(host);
  } catch {
    throw new AppError("DNS_FAILED", "We couldn't find that domain. Check the spelling.");
  }
  if (addresses.length === 0 || addresses.some((a) => deps.isBlocked(a))) {
    throw new AppError("BLOCKED_HOST", "That domain resolves to a private network address.");
  }
  const address = addresses[0];
  return { address, family: isIP(address) === 6 ? 6 : 4 };
}

function pinnedLookup(pinned: Pinned): LookupFunction {
  return (_hostname, options, callback) => {
    // Node may ask for all addresses (happy-eyeballs); answer with only the pinned one.
    if (typeof options === "object" && options?.all) {
      (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [
        { address: pinned.address, family: pinned.family },
      ]);
    } else {
      callback(null, pinned.address, pinned.family);
    }
  };
}

function isHtml(contentType: string | undefined): boolean {
  if (!contentType) return true; // many small sites omit it; the extractor copes
  const ct = contentType.toLowerCase();
  return ct.includes("text/html") || ct.includes("application/xhtml+xml");
}

function decoderFor(contentType: string | undefined): TextDecoder {
  const charset = contentType?.match(/charset=["']?([\w-]+)/i)?.[1]?.toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(charset);
  } catch {
    return new TextDecoder("utf-8");
  }
}

function decompress(res: http.IncomingMessage): Readable {
  const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") return res.pipe(zlib.createGunzip());
  if (enc === "deflate") return res.pipe(zlib.createInflate());
  if (enc === "br") return res.pipe(zlib.createBrotliDecompress());
  return res;
}

/** Reads at most maxBytes of DECOMPRESSED body, which also stops compression bombs. */
function readCapped(
  stream: Readable,
  maxBytes: number,
  contentType: string | undefined,
): Promise<{ text: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;
    const finish = (truncated: boolean) => {
      if (finished) return;
      finished = true;
      resolve({ text: decoderFor(contentType).decode(Buffer.concat(chunks)), truncated });
    };
    stream.on("data", (chunk: Buffer) => {
      if (finished) return;
      const remaining = maxBytes - size;
      if (chunk.length >= remaining) {
        chunks.push(chunk.subarray(0, remaining));
        size = maxBytes;
        finish(true);
        stream.destroy();
        return;
      }
      chunks.push(chunk);
      size += chunk.length;
    });
    stream.on("end", () => finish(false));
    stream.on("error", (err) => {
      if (!finished) reject(err);
    });
  });
}

type OnceResult =
  | { kind: "redirect"; location: string | undefined }
  | { kind: "page"; html: string; truncated: boolean };

function requestOnce(
  url: URL,
  pinned: Pinned,
  signal: AbortSignal,
  maxBytes: number,
): Promise<OnceResult> {
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: "GET",
        lookup: pinnedLookup(pinned),
        agent: false, // no connection reuse across hosts or redirects
        signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-language": "en;q=0.9",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;

        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ kind: "redirect", location: res.headers.location });
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          const blockedHint =
            status === 403 || status === 429 || status === 503
              ? " The site may be blocking automated requests."
              : "";
          reject(
            new AppError(
              "HTTP_ERROR",
              `The website responded with an error (HTTP ${status}).${blockedHint}`,
              502,
            ),
          );
          return;
        }

        const contentType = res.headers["content-type"];
        if (!isHtml(contentType)) {
          res.resume();
          reject(new AppError("NOT_HTML", "That address doesn't return a web page (HTML)."));
          return;
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > maxBytes * 5) {
          res.destroy();
          reject(new AppError("TOO_LARGE", "That page is too large to analyse."));
          return;
        }

        readCapped(decompress(res), maxBytes, contentType)
          .then(({ text, truncated }) => resolve({ kind: "page", html: text, truncated }))
          .catch(reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Fetches one HTML page with SSRF protections:
 * - http/https on ports 80/443 only, no embedded credentials
 * - DNS resolved once; every address checked against private ranges
 * - the TCP connection is pinned to the checked address (no DNS rebinding)
 * - redirects followed manually (max 3), each hop re-validated and re-pinned
 * - one timeout covering the whole operation, including the body
 * - decompressed body capped at maxBytes; non-HTML responses rejected
 */
export async function safeFetchHtml(
  url: URL,
  opts: FetchOptions = {},
  deps: FetchDeps = defaultDeps,
): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxBytes = opts.maxBytes ?? 1_500_000;
  const maxRedirects = opts.maxRedirects ?? 3;

  const signal = AbortSignal.timeout(timeoutMs);
  let current = new URL(url.toString());

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      assertUrlShape(current);
      const pinned = await resolvePublic(current.hostname, deps);
      const result = await requestOnce(current, pinned, signal, maxBytes);

      if (result.kind === "redirect") {
        if (!result.location) {
          throw new AppError("HTTP_ERROR", "The website sent a redirect with no destination.");
        }
        current = new URL(result.location, current);
        current.hash = "";
        continue;
      }
      return {
        requestedUrl: url.toString(),
        finalUrl: current.toString(),
        html: result.html,
        truncated: result.truncated,
      };
    }
    throw new AppError("TOO_MANY_REDIRECTS", "The website redirected too many times.");
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (signal.aborted) {
      throw new AppError("TIMEOUT", "The website took too long to respond.", 504);
    }
    const code = (err as NodeJS.ErrnoException)?.code;
    const tlsHint = code?.startsWith("ERR_TLS") || code?.includes("CERT") ? " (TLS/certificate problem)" : "";
    throw new AppError(
      "NETWORK",
      `We couldn't connect to that website${tlsHint}.`,
      502,
      String(code ?? err),
    );
  }
}
