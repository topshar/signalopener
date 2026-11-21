// Exercises safe-fetch against a real local HTTP server. The fetcher normally
// refuses 127.0.0.1, so these tests inject a resolver and a blocklist that only
// blocks 10.0.0.0/8; the production defaults are covered in offline.test.ts.
// The server must listen on port 80 because the fetcher only allows 80/443.
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import zlib from "node:zlib";
import { AppError } from "../lib/errors";
import { safeFetchHtml, type FetchDeps } from "../lib/safe-fetch";

const PAGE = "<html><head><title>Local</title></head><body><p>Hello from the test server.</p></body></html>";
const resolved: string[] = [];

const deps: FetchDeps = {
  resolve: async (host) => {
    resolved.push(host);
    if (host === "site.test" || host === "other.test") return ["127.0.0.1"];
    if (host === "evil.test") return ["10.0.0.7"];
    throw new Error("ENOTFOUND");
  },
  isBlocked: (ip) => ip.startsWith("10."),
};

const server = http.createServer((req, res) => {
  switch (req.url) {
    case "/ok":
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE);
      return;
    case "/gzip":
      res
        .writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" })
        .end(zlib.gzipSync(PAGE));
      return;
    case "/redirect":
      res.writeHead(301, { location: "http://other.test/ok" }).end();
      return;
    case "/redirect-private":
      res.writeHead(302, { location: "http://evil.test/" }).end();
      return;
    case "/redirect-ip":
      res.writeHead(302, { location: "http://10.1.2.3/" }).end();
      return;
    case "/redirect-port":
      res.writeHead(302, { location: "http://site.test:8080/" }).end();
      return;
    case "/loop":
      res.writeHead(302, { location: "/loop" }).end();
      return;
    case "/json":
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
      return;
    case "/big":
      res.writeHead(200, { "content-type": "text/html" }).end("<p>" + "a".repeat(3_000_000) + "</p>");
      return;
    case "/bomb": {
      // 20MB of zeros compresses to ~20KB; the cap must apply after decompression.
      res
        .writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" })
        .end(zlib.gzipSync(Buffer.alloc(20_000_000, 48)));
      return;
    }
    case "/slow":
      return; // never responds
    default:
      res.writeHead(404).end();
  }
});

let listening = false;
before(async () => {
  await new Promise<void>((resolve) => {
    server.once("error", () => resolve());
    server.listen(80, "127.0.0.1", () => {
      listening = true;
      resolve();
    });
  });
});
after(() => {
  server.closeAllConnections();
  server.close();
});

const get = (path: string, host = "site.test", opts = {}) =>
  safeFetchHtml(new URL(`http://${host}${path}`), opts, deps);

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof AppError ? e.code : `RAW:${(e as Error).message}`;
  }
}

// Skip (rather than fail) every test if port 80 was taken or needs admin rights.
const itl = (name: string, fn: () => Promise<void>) =>
  it(name, async (t) => {
    if (!listening) {
      t.skip("port 80 unavailable on this machine");
      return;
    }
    await fn();
  });

describe("safeFetchHtml against a local server", () => {

  itl("fetches HTML", async () => {
    const r = await get("/ok");
    assert.match(r.html, /Hello from the test server/);
    assert.equal(r.truncated, false);
  });

  itl("decompresses gzip", async () => {
    assert.match((await get("/gzip")).html, /Hello from the test server/);
  });

  itl("follows a redirect and re-resolves the new host", async () => {
    resolved.length = 0;
    const r = await get("/redirect");
    assert.equal(r.finalUrl, "http://other.test/ok");
    assert.deepEqual(resolved, ["site.test", "other.test"]);
  });

  itl("blocks a redirect to a host that resolves privately", async () => {
    assert.equal(await code(get("/redirect-private")), "BLOCKED_HOST");
  });

  itl("blocks a redirect to a private IP literal", async () => {
    assert.equal(await code(get("/redirect-ip")), "BLOCKED_HOST");
  });

  itl("blocks a redirect to a non-standard port", async () => {
    assert.equal(await code(get("/redirect-port")), "BLOCKED_HOST");
  });

  itl("stops redirect loops", async () => {
    assert.equal(await code(get("/loop")), "TOO_MANY_REDIRECTS");
  });

  itl("rejects non-HTML", async () => {
    assert.equal(await code(get("/json")), "NOT_HTML");
  });

  itl("reports HTTP errors", async () => {
    assert.equal(await code(get("/missing")), "HTTP_ERROR");
  });

  itl("truncates large pages at maxBytes", async () => {
    const r = await get("/big", "site.test", { maxBytes: 100_000 });
    assert.equal(r.truncated, true);
    assert.equal(r.html.length, 100_000);
  });

  itl("caps decompressed size (compression bomb)", async () => {
    const r = await get("/bomb", "site.test", { maxBytes: 200_000 });
    assert.equal(r.truncated, true);
    assert.equal(r.html.length, 200_000);
  });

  itl("times out on a silent server", async () => {
    const started = Date.now();
    assert.equal(await code(get("/slow", "site.test", { timeoutMs: 500 })), "TIMEOUT");
    assert.ok(Date.now() - started < 2000);
  });

  itl("reports unknown domains as DNS_FAILED", async () => {
    assert.equal(await code(get("/ok", "nowhere.test")), "DNS_FAILED");
  });
});
