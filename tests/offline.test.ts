// Offline tests: no network, no API key. Run with `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../lib/errors";
import { assessContent, extractPage } from "../lib/extract";
import { isBlockedIp } from "../lib/ip";
import { parseModelOutput } from "../lib/parse";
import { buildUserPrompt } from "../lib/prompt";
import { safeFetchHtml } from "../lib/safe-fetch";
import { normalizeUrl } from "../lib/url";
import { INJECTION_PAGE, SAAS_HOMEPAGE, SPA_SHELL, THIN_PAGE } from "./fixtures";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : "NOT_APP_ERROR";
  }
  return undefined;
}

describe("normalizeUrl", () => {
  it("adds https to bare domains and drops the hash", () => {
    assert.equal(normalizeUrl(" acme.com/pricing#top ").toString(), "https://acme.com/pricing");
  });
  it("keeps explicit http", () => {
    assert.equal(normalizeUrl("http://acme.com").protocol, "http:");
  });
  for (const [input, code] of [
    ["", "INVALID_URL"],
    ["ftp://acme.com", "INVALID_URL"],
    ["file:///etc/passwd", "INVALID_URL"],
    ["javascript:alert(1)", "INVALID_URL"],
    ["https://user:pass@acme.com", "INVALID_URL"],
    ["https://acme.com:8080", "BLOCKED_HOST"],
    ["http://localhost", "BLOCKED_HOST"],
    ["http://api.localhost", "BLOCKED_HOST"],
    ["http://printer.local", "BLOCKED_HOST"],
    ["http://intranet", "INVALID_URL"],
    ["not a url at all", "INVALID_URL"],
  ] as const) {
    it(`rejects ${JSON.stringify(input)} with ${code}`, () => {
      assert.equal(codeOf(() => normalizeUrl(input)), code);
    });
  }
});

describe("isBlockedIp", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.5",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "[::1]",
    "not-an-ip",
  ]) {
    it(`blocks ${ip}`, () => assert.equal(isBlockedIp(ip), true));
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    it(`allows ${ip}`, () => assert.equal(isBlockedIp(ip), false));
  }
});

describe("safeFetchHtml refuses private targets before connecting", () => {
  for (const target of [
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://10.0.0.1/",
  ]) {
    it(`blocks ${target}`, async () => {
      await assert.rejects(safeFetchHtml(new URL(target)), (e: unknown) => {
        return e instanceof AppError && e.code === "BLOCKED_HOST";
      });
    });
  }
});

describe("extractPage", () => {
  const page = extractPage(SAAS_HOMEPAGE, "https://ledgerly.example/");

  it("reads title, description, site name and JSON-LD", () => {
    assert.equal(page.title, "Ledgerly - Bookkeeping for Shopify stores");
    assert.match(page.description, /reconciles Shopify payouts/);
    assert.equal(page.siteName, "Ledgerly");
    assert.match(page.structuredData[0], /SoftwareApplication: Ledgerly/);
  });
  it("collects headings", () => {
    assert.ok(page.headings.includes("New in October: multi-currency payouts"));
  });
  it("removes nav, footer, scripts and cookie banners", () => {
    assert.doesNotMatch(page.text, /cookies/i);
    assert.doesNotMatch(page.text, /Ledgerly Pty Ltd/);
    assert.doesNotMatch(page.text, /window\.analytics/);
  });
  it("keeps adjacent blocks as separate lines, drops menu labels and repeated text", () => {
    assert.doesNotMatch(page.text, /FeaturesPricing/);
    assert.doesNotMatch(page.text, /^Features$/m); // 1-2 word lines are button/menu labels
    const repeats = page.text.split("\n").filter((l) => l.startsWith("Every plan includes"));
    assert.equal(repeats.length, 1);
  });
  it("collects same-site links only, including nav links", () => {
    assert.ok(page.internalLinks.includes("https://ledgerly.example/changelog"));
    assert.ok(!page.internalLinks.some((l) => l.includes("twitter.com")));
  });
  it("judges a real homepage as sufficient", () => {
    assert.deepEqual(assessContent(page), { ok: true });
  });
  it("flags a JavaScript shell as js_rendered", () => {
    const r = assessContent(extractPage(SPA_SHELL, "https://app.example/"));
    assert.equal(r.ok ? "ok" : r.reason, "js_rendered");
  });
  it("flags a near-empty page as thin_content", () => {
    const r = assessContent(extractPage(THIN_PAGE, "https://soon.example/"));
    assert.equal(r.ok ? "ok" : r.reason, "thin_content");
  });
});

describe("buildUserPrompt", () => {
  it("strips delimiter tags that page text uses to escape the data block", () => {
    const page = extractPage(INJECTION_PAGE, "https://acme.example/");
    const prompt = buildUserPrompt([page], "");
    assert.equal(prompt.match(/<\/website_content>/g)?.length, 1);
    assert.match(prompt, /IGNORE ALL PREVIOUS INSTRUCTIONS/); // still present, but inside the data block
  });
  it("caps sender context at 300 characters", () => {
    const page = extractPage(SAAS_HOMEPAGE, "https://ledgerly.example/");
    const prompt = buildUserPrompt([page], "x".repeat(1000));
    assert.ok(!prompt.includes("x".repeat(301)));
  });
});

describe("parseModelOutput", () => {
  const good = {
    insufficient_evidence: false,
    insufficient_reason: "",
    company_summary: "Ledgerly reconciles Shopify payouts.",
    observation: "They just shipped multi-currency payouts.",
    supporting_quote: "Stores selling in AUD, NZD and USD can now reconcile payouts",
    source_url: "https://ledgerly.example/",
    interpretation: "Suggests a push into cross-border merchants.",
    opener_lines: ["Line one.", "Line two.", "Line three?"],
  };

  it("parses a valid response", () => {
    const r = parseModelOutput(JSON.stringify(good));
    assert.equal(r.kind, "ok");
    if (r.kind === "ok") assert.deepEqual(r.lines, ["Line one.", "Line two.", "Line three?"]);
  });
  it("tolerates markdown fences", () => {
    assert.equal(parseModelOutput("```json\n" + JSON.stringify(good) + "\n```").kind, "ok");
  });
  it("strips list markers from lines", () => {
    const r = parseModelOutput(
      JSON.stringify({ ...good, opener_lines: ["1. First.", "- Second.", "Line 3: Third?"] }),
    );
    if (r.kind === "ok") assert.deepEqual(r.lines, ["First.", "Second.", "Third?"]);
  });
  it("splits one string containing three lines", () => {
    const r = parseModelOutput(JSON.stringify({ ...good, opener_lines: ["A.\nB.\nC?"] }));
    assert.equal(r.kind, "ok");
  });
  it("rejects two lines", () => {
    assert.equal(
      codeOf(() => parseModelOutput(JSON.stringify({ ...good, opener_lines: ["A.", "B."] }))),
      "AI_BAD_RESPONSE",
    );
  });
  it("rejects four lines", () => {
    assert.equal(
      codeOf(() =>
        parseModelOutput(JSON.stringify({ ...good, opener_lines: ["A.", "B.", "C.", "D."] })),
      ),
      "AI_BAD_RESPONSE",
    );
  });
  it("rejects non-JSON", () => {
    assert.equal(codeOf(() => parseModelOutput("Sure! Here is your opener...")), "AI_BAD_RESPONSE");
  });
  it("returns insufficient when the model says so", () => {
    const r = parseModelOutput(
      JSON.stringify({ ...good, insufficient_evidence: true, insufficient_reason: "Too generic." }),
    );
    assert.deepEqual(r, { kind: "insufficient", reason: "Too generic." });
  });
});
