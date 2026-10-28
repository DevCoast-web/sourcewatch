import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join, dirname, relative, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, type Browser } from "playwright";
import { unzipSync } from "fflate";
import { createApp } from "../src/server.js";
import { Store, sha256 } from "../src/storage.js";

// Accelerated fixture endurance check, not a claim of twelve hours of operation.
const started = Date.now();
const output = resolve(process.argv[2] || "work/soak-report.json");
const outputRelative = relative(process.cwd(), output);
if (
  isAbsolute(outputRelative) ||
  outputRelative === ".." ||
  outputRelative.startsWith("..\\") ||
  outputRelative.startsWith("../")
)
  throw new Error("Report destination must be inside the current workspace");
mkdirSync(resolve(".test-data"), { recursive: true });
const root = mkdtempSync(join(resolve(".test-data"), "soak-"));
const fixtureUrl = "http://127.0.0.1:12345/";
let cycle = 0,
  peakControllerRssBytes = process.memoryUsage().rss;
const report = {
  kind: "accelerated-fixture-endurance",
  startedAt: new Date(started).toISOString(),
  finishedAt: "",
  elapsedMs: 0,
  plannedCycles: 12,
  completedCycles: 0,
  captures: 0,
  failureEvents: 0,
  changeEvents: 0,
  peakControllerRssBytes: 0,
  controllerRssScope:
    "Node.js harness process only; excludes Chromium child processes",
  assertions: [] as string[],
  ok: false,
  error: undefined as string | undefined,
};
let browser: Browser | undefined;
let closed = false;
const { app, store, research, runScheduled } = await createApp({
  root,
  testMode: true,
  captureOptions: {
    fixtureUrl,
    settleMs: 0,
    fetcher: async () => ({
      status: cycle === 7 ? 403 : 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from(
        `<!doctype html><html><head><title>Endurance fixture</title></head><body style="font-family:Arial;padding:40px"><h1>Research endurance fixture</h1><p>Policy revision ${Math.floor((cycle - 1) / 2)}</p><div class="clock">Dynamic clock ${cycle}</div><a href="https://example.org/report">Report</a></body></html>`,
      ),
    }),
  },
});
const headers = { host: "127.0.0.1" };
try {
  store.setSettings(0);
  const source = store.add({
    url: fixtureUrl,
    name: "Endurance fixture",
    description: "Accelerated local fixture",
    collection: "Endurance",
    intervalMinutes: 5,
    selectors: [".clock"],
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1365, height: 1000 },
  });
  await page.goto(
    `http://127.0.0.1:${(app.server.address() as { port: number }).port}`,
  );
  let firstId = "",
    firstHash = "";
  const draft = "Unsaved research draft must survive scheduled polling.";
  for (cycle = 1; cycle <= 12; cycle++) {
    const previousCount = store.history(source.id).length;
    store.db
      .prepare("UPDATE sources SET lastAttempt=? WHERE id=?")
      .run("2000-01-01T00:00:00Z", source.id);
    await runScheduled();
    const history = store.history(source.id);
    assert.equal(history.length, previousCount + (cycle === 7 ? 0 : 1));
    if (cycle === 1) {
      firstId = history[0].id;
      firstHash = history[0].chainHash;
      // Wait for the dashboard's actual polling rather than loading an injected DOM.
      await page
        .getByRole("button", { name: "Inspect capture", exact: true })
        .first()
        .click({ timeout: 15000 });
      await page.getByText(firstHash, { exact: true }).waitFor();
      await page
        .getByRole("textbox", { name: "Research notes", exact: true })
        .fill(draft);
    }
    if (cycle === 2) {
      research.saveAnnotation(firstId, {
        note: "Persisted endurance annotation",
        tags: ["endurance"],
      });
      assert.equal(
        history[0].files["text.txt"],
        history[1].files["text.txt"],
        "Consecutive fixture versions must have identical comparison text despite the changing clock",
      );
    }
    if (cycle % 3 === 0) {
      const status = await app.inject({ url: "/api/status", headers });
      assert.equal(status.statusCode, 200);
      assert.equal(status.json().busy, false);
      const search = await app.inject({ url: "/api/search?q=Policy", headers });
      assert.equal(search.statusCode, 200);
      assert(search.json().length > 0);
      const exported = await app.inject({
        url: `/api/sources/${source.id}/export`,
        headers,
      });
      assert.equal(exported.statusCode, 200);
      assert(unzipSync(exported.rawPayload)["manifest.json"]);
    }
    peakControllerRssBytes = Math.max(
      peakControllerRssBytes,
      process.memoryUsage().rss,
    );
    report.completedCycles = cycle;
  }
  await page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/status" && r.status() === 200,
    { timeout: 15000 },
  );
  await page.getByText(firstHash, { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Research notes", exact: true })
      .inputValue(),
    draft,
  );
  report.assertions.push(
    "Historical inspector remained on the first capture after scheduled polling",
    "Unsaved notes draft survived scheduled polling",
  );
  const history = store.history(source.id);
  assert.equal(history.length, 11);
  let previous: string | null = null;
  for (const record of history) {
    const { chainHash, ...base } = record;
    assert.equal(record.previousHash, previous);
    assert.equal(sha256(JSON.stringify(base)), chainHash);
    assert(
      !store.file(record.id, "text.txt").toString().includes("Dynamic clock"),
    );
    assert(
      store.file(record.id, "page.html").toString().includes("Dynamic clock"),
    );
    previous = chainHash;
  }
  assert.equal(store.source(source.id)?.error, null);
  const events = research.listEvents();
  assert.equal(events.filter((e) => e.kind === "failure").length, 1);
  const failure = events.find((e) => e.kind === "failure");
  assert.match(failure?.summary || "", /HTTP 403/);
  report.captures = history.length;
  report.failureEvents = events.filter((e) => e.kind === "failure").length;
  report.changeEvents = events.filter((e) => e.kind === "changed").length;
  const exported = await app.inject({
    url: `/api/sources/${source.id}/export`,
    headers,
  });
  assert.equal(exported.statusCode, 200);
  const bundle = join(root, "bundle");
  mkdirSync(bundle);
  for (const [name, bytes] of Object.entries(unzipSync(exported.rawPayload))) {
    const file = join(bundle, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  const verified = JSON.parse(
    execFileSync(
      process.execPath,
      [
        join(bundle, "verify.mjs"),
        bundle,
        "--expect",
        String(exported.headers["x-manifest-sha256"]),
      ],
      { encoding: "utf8" },
    ),
  );
  assert.equal(verified.ok, true);
  assert.equal(verified.captures, 11);
  report.assertions.push(
    "Twelve scheduled cycles produced eleven captures and one HTTP 403 failure",
    "Unchanged comparison text ignored dynamic clocks while preserving original HTML",
    "Capture chain hashes and predecessor links verified",
    "Intermittent status, search, and export requests succeeded",
    "Final ZIP passed its standalone offline verifier",
    "Capture failure cleared after a later successful capture",
  );
  await browser.close();
  browser = undefined;
  await app.close();
  closed = true;
  const reopened = new Store(root);
  try {
    assert.equal(reopened.history(source.id).length, 11);
    assert.equal(reopened.settings().settleMs, 0);
  } finally {
    reopened.close();
  }
  report.assertions.push(
    "All eleven captures and settings survived shutdown and database reopen",
  );
  report.ok = true;
} catch (error) {
  report.error = (error as Error).message;
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (!closed) await app.close();
  rmSync(root, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  report.elapsedMs = Date.now() - started;
  report.peakControllerRssBytes = Math.max(
    peakControllerRssBytes,
    process.memoryUsage().rss,
  );
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
