import test from "node:test";
import assert from "node:assert/strict";
import { capture, type CaptureOptions } from "../src/capture.js";
import type { FetchResult } from "../src/network.js";
const fixtureUrl = "http://127.0.0.1:12345/";
const html = (body: string, status = 200): FetchResult => ({
  status,
  headers: {
    "content-type": "text/html",
    "set-cookie": "private=value",
    etag: "fixture-etag",
  },
  body: Buffer.from(
    `<!doctype html><html><head><title>Capture fixture</title></head><body>${body}</body></html>`,
  ),
});
const options = (result: FetchResult): CaptureOptions => ({
  fixtureUrl,
  fetcher: async () => result,
  settleMs: 0,
  preserveTextOnScreenshotFailure: false,
});

test("real Chromium capture extracts rendered text, excludes hidden regions, and preserves DOM and screenshot", async () => {
  const result = await capture(
    fixtureUrl,
    [".dynamic"],
    options(
      html(
        '<h1>Visible heading</h1><div hidden>Hidden secret</div><p style="display:none">Display secret</p><span style="visibility:hidden">Invisible secret</span><div aria-hidden="true">ARIA secret</div><p class="dynamic">Ignored clock</p><a href="https://example.org/report">Report</a><script>document.body.insertAdjacentHTML("beforeend","<p>JavaScript rendered receipt</p>")</script>',
      ),
    ),
  );
  assert.match(result.text, /Visible heading/);
  assert.match(result.text, /JavaScript rendered receipt/);
  for (const text of [
    "Hidden secret",
    "Display secret",
    "Invisible secret",
    "ARIA secret",
    "Ignored clock",
    "insertAdjacentHTML",
  ])
    assert(!result.text.includes(text), text);
  assert.match(result.html, /Hidden secret/);
  assert.match(result.html, /Ignored clock/);
  assert.equal(result.title, "Capture fixture");
  assert.deepEqual(result.links, ["https://example.org/report"]);
  assert.equal(
    result.screenshot.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
  );
  assert.equal(result.headers.etag, "fixture-etag");
  assert.equal(result.headers["set-cookie"], undefined);
});

test("HTTP 403 access controls are rejected without a retry or bypass", async () => {
  let requests = 0;
  await assert.rejects(
    capture(fixtureUrl, [], {
      ...options(html("Forbidden", 403)),
      fetcher: async () => {
        requests++;
        return html("Forbidden", 403);
      },
    }),
    /HTTP 403; access controls are not bypassed/,
  );
  assert.equal(requests, 1);
});

test("non-HTML documents are rejected", async () => {
  await assert.rejects(
    capture(
      fixtureUrl,
      [],
      options({
        status: 200,
        headers: { "content-type": "text/plain" },
        body: Buffer.from("Plain text document"),
      }),
    ),
    /Only HTML pages can be captured/,
  );
});

test("transport failures reject capture and retain the underlying diagnostic", async () => {
  await assert.rejects(
    capture(fixtureUrl, [], {
      fixtureUrl,
      settleMs: 0,
      fetcher: async () => {
        throw new Error("Fixture network refused");
      },
    }),
    /Navigation failed:.*Fixture network refused/,
  );
});

test("aggregate response size limit rejects an oversized document", async () => {
  await assert.rejects(
    capture(
      fixtureUrl,
      [],
      options({
        status: 200,
        headers: { "content-type": "text/html" },
        body: Buffer.alloc(32 * 1024 * 1024 + 1, 32),
      }),
    ),
    /32 MiB total response limit reached/,
  );
});

test("over-height pages are rejected before allocating a full-page screenshot", async () => {
  await assert.rejects(
    capture(
      fixtureUrl,
      [],
      options(html('<div style="height:200001px">Tall fixture</div>')),
    ),
    /screenshot height limit/,
  );
});

test("navigation deadline rejects a delayed document", async () => {
  await assert.rejects(
    capture(fixtureUrl, [], {
      fixtureUrl,
      settleMs: 0,
      navigationTimeoutMs: 100,
      totalTimeoutMs: 1000,
      fetcher: async () => {
        await new Promise((r) => setTimeout(r, 300));
        return html("Delayed fixture");
      },
    }),
    /Navigation failed:.*Timeout 100ms exceeded/,
  );
});

test("total capture deadline closes Chromium before a delayed transport completes", async () => {
  const started = Date.now();
  let transportStarted = false;
  await assert.rejects(
    capture(fixtureUrl, [], {
      fixtureUrl,
      settleMs: 0,
      totalTimeoutMs: 2000,
      navigationTimeoutMs: 10000,
      fetcher: async () => {
        transportStarted = true;
        await new Promise((r) => setTimeout(r, 5000));
        return html("Late document");
      },
    }),
    /closed|Target|Navigation failed/i,
  );
  assert(transportStarted, "Deadline interrupts an active transport");
  assert(
    Date.now() - started < 7000,
    "Total deadline must return promptly, including browser cleanup",
  );
});

test("subresource capture limits active transports to six and stops transport at 150 requests", async () => {
  let active = 0,
    peak = 0,
    calls = 0;
  const document = html(
    "<h1>Resource limit fixture</h1>" +
      Array.from(
        { length: 180 },
        (_, i) => `<img src="/pixel-${i}.png" width="1" height="1">`,
      ).join(""),
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  const result = await capture(fixtureUrl, [], {
    fixtureUrl,
    settleMs: 1500,
    fetcher: async (url) => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise((r) => setTimeout(r, 20));
        return url === fixtureUrl
          ? document
          : {
              status: 200,
              headers: { "content-type": "image/png" },
              body: png,
            };
      } finally {
        active--;
      }
    },
  });
  assert(peak <= 6, `Peak transports was ${peak}`);
  assert(peak > 1, "Fixture exercised concurrent transports");
  assert.equal(calls, 150);
  assert(result.warnings.some((w) => w.includes("150-request limit reached")));
  assert.match(result.text, /Resource limit fixture/);
});

test("full-page screenshots preserve pages taller than the former 18000px limit", async () => {
  const result = await capture(
    fixtureUrl,
    [],
    options(html('<div style="height:25000px">Long research document</div>')),
  );
  assert.equal(
    result.screenshot.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
  );
  assert.equal(result.screenshot.toString("ascii", 12, 16), "IHDR");
  assert(
    result.screenshot.readUInt32BE(20) >= 25000,
    "Saved PNG must contain the complete tall page",
  );
  assert.match(result.text, /Long research document/);
});

test("configured screenshot height limit rejects larger pages", async () => {
  await assert.rejects(
    capture(fixtureUrl, [], {
      ...options(
        html('<div style="height:5000px">Configured limit fixture</div>'),
      ),
      maxScreenshotHeight: 4000,
    }),
    /screenshot height limit/,
  );
});
