import { AppError } from "./errors";

const MAX_URL_LENGTH = 2048;
const ALLOWED_PORTS = new Set(["", "80", "443"]);
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

/**
 * Turns user input like "acme.com" or "https://acme.com/pricing" into a URL,
 * or throws a user-friendly AppError. This is a syntax check only; the
 * IP-level check happens in safe-fetch, after DNS resolution.
 */
export function normalizeUrl(input: string): URL {
  const raw = input.trim();
  if (!raw) throw new AppError("INVALID_URL", "Enter a company website address.");
  if (raw.length > MAX_URL_LENGTH) throw new AppError("INVALID_URL", "That URL is too long.");

  // Allow "acme.com" without a scheme.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new AppError("INVALID_URL", "That doesn't look like a valid website address.");
  }

  assertUrlShape(url);
  url.hash = "";
  return url;
}

/** Checks applied to the first URL and to every redirect target. */
export function assertUrlShape(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("INVALID_URL", "Only http and https websites are supported.");
  }
  if (url.username || url.password) {
    throw new AppError("INVALID_URL", "URLs with embedded credentials aren't allowed.");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new AppError("BLOCKED_HOST", "Only standard web ports (80 and 443) are allowed.");
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new AppError("BLOCKED_HOST", "That address points to a private network.");
  }
  // Bare hostnames like "intranet" are almost always internal.
  const isIpLiteral = host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (!isIpLiteral && !host.includes(".")) {
    throw new AppError("INVALID_URL", "Enter a full domain, for example acme.com.");
  }
}
