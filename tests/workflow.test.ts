import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { unzipSync } from "fflate";
import {
  publicAddress,
  parsePublicUrl,
  resolvePublic,
  safeFetch,
} from "../src/network.js";
import { compare } from "../src/compare.js";
import { createApp } from "../src/server.js";
import { capture } from "../src/capture.js";

test("network policy rejects private, reserved, mapped, obfuscated addresses and unsafe URLs", async () => {
  for (const address of [
    "127.0.0.1",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.0.2.1",
    "198.51.100.4",
    "203.0.113.2",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])
    assert.equal(publicAddress(address), false, address);
  for (const url of [
    "http://127.1",
    "http://2130706433",
    "http://0x7f000001",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "file:///etc/passwd",
    "ftp://example.com",
    "http://localhost",
    "http://host.local",
    "http://metadata.internal",
    "http://example.com:8080",
    "https://a:b@example.com",
  ])
    assert.throws(() => parsePublicUrl(url), url);
  assert(publicAddress("8.8.8.8"));
  assert(publicAddress("2606:4700:4700::1111"));
  await assert.rejects(
    resolvePublic(new URL("https://example.com"), (async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]) as any),
    /private/,
  );
  assert.equal(
    await resolvePublic(new URL("https://example.com"), (async () => [
      { address: "8.8.8.8", family: 4 },
    ]) as any),
    "8.8.8.8",
  );
  await assert.rejects(
    safeFetch("http://169.254.169.254/latest/meta-data"),
    /blocked/,
  );
});
test("comparison preserves deletions, replacements, additions and outbound link changes", () => {
  const d = compare(
    {
      text: "Policy\nOld commitment\nRemoved section\n",
      links: ["https://old.example/"],
    },
    {
      text: "Policy\nNew commitment\nAdded note\n",
      links: ["https://new.example/"],
    },
  );
  assert(d.changed);
  assert.equal(d.removed, 2);
  assert.equal(d.added, 2);
  assert(d.parts.some((p) => p.removed && p.value.includes("Removed section")));
  assert.deepEqual(d.linksRemoved, ["https://old.example/"]);
  assert.deepEqual(d.linksAdded, ["https://new.example/"]);
  assert.equal(
    compare({ text: "a", links: [] }, { text: "a", links: [] }).changed,
    false,
  );
});
test("complete browser workflow: real changing fixture → captures → compare → ZIP → offline verification", async () => {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "sourcewatch-test-"));
  let version = 1;
  let internalHits = 0;
  const forbidden = createServer((_req, res) => {
    internalHits++;
    res.end("secret");
  });
  await new Promise<void>((r) => forbidden.listen(0, "127.0.0.1", r));
  const forbiddenUrl = `http://127.0.0.1:${(forbidden.address() as any).port}`;
  const fixture = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: forbiddenUrl });
      res.end();
      return;
    }
    if (version === 3) {
      res.writeHead(403);
      res.end("Access denied");
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Set-Cookie", "secret=never-export");
    res.setHeader("Authorization", "Bearer never-export");
    res.end(
      `<!doctype html><html><head><title>Research bulletin</title><meta name="description" content="Integration fixture"></head><body style="font-family:Arial;padding:60px;background:#f5f4ec;color:#234637"><h1>Research bulletin</h1><p>Publication policy</p><p>${version === 1 ? "We retain reports for 90 days." : "We retain reports for 30 days."}</p>${version === 1 ? "<section>Independent oversight is required.</section>" : "<section>Annual review introduced.</section>"}<div class="clock">Clock ${version}</div><a href="https://${version === 1 ? "old" : "new"}.example.org/report">Read the report</a><script>document.body.insertAdjacentHTML('beforeend','<p>Rendered by JavaScript</p>');fetch('${forbiddenUrl}/secret').catch(()=>{});</script></body></html>`,
    );
  });
  await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
  const fixtureUrl = `http://127.0.0.1:${(fixture.address() as any).port}/`;
  // Explicit test-only transport injection. Production entry point never configures this capability.
  const fetcher = async (url: string) => {
    const r = await fetch(url, { redirect: "manual" });
    return {
      status: r.status,
      headers: Object.fromEntries(r.headers.entries()),
      body: Buffer.from(await r.arrayBuffer()),
    };
  };
  const { app, store, runCapture, runScheduled } = await createApp({
    root: join(root, "data"),
    testMode: true,
    captureOptions: { fixtureUrl, fetcher },
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const appUrl = `http://127.0.0.1:${(app.server.address() as any).port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1536, height: 1100 },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/sources",
      headers: { host: "127.0.0.1", origin: "https://evil.example" },
      payload: { url: fixtureUrl },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(
      (
        await app.inject({
          url: "/api/sources",
          headers: { host: "evil.example" },
        })
      ).statusCode,
      403,
    );
    await page.goto(appUrl);
    await page
      .getByRole("button", { name: "+ Add source", exact: true })
      .click();
    await page.getByLabel("Website URL").fill(fixtureUrl);
    await page.getByLabel("Source name").fill("Research bulletin");
    await page
      .getByLabel("Collection", { exact: true })
      .fill("Policy research");
    await page
      .getByLabel("Ignore dynamic regions", { exact: false })
      .fill(".clock");
    await page.getByRole("button", { name: "Add source", exact: true }).click();
    await page
      .getByRole("heading", { name: "Research bulletin", exact: true })
      .waitFor();
    const source = store.sources()[0];
    assert.equal(source.collection, "Policy research");
    await page
      .getByRole("button", { name: "Capture first version", exact: true })
      .click();
    await page
      .getByText("First capture saved.", { exact: true })
      .waitFor({ timeout: 60000 });
    version = 2;
    await page
      .getByRole("button", { name: "Capture another version", exact: true })
      .click();
    await page
      .getByText("−2 lines", { exact: true })
      .waitFor({ timeout: 60000 });
    const h = store.history(source.id);
    assert.equal(h.length, 2);
    assert.equal(h[1].previousHash, h[0].chainHash);
    assert.equal(internalHits, 0, "Private subresource was never requested");
    const first = store.file(h[0].id, "text.txt").toString(),
      second = store.file(h[1].id, "text.txt").toString();
    assert(first.includes("Rendered by JavaScript"));
    assert(!first.includes("Clock 1"));
    assert(second.includes("30 days"));
    assert(store.file(h[0].id, "page.html").toString().includes("Clock 1"));
    assert.equal(
      store.file(h[0].id, "screenshot.png").subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
    );
    assert.equal(h[1].headers["cache-control"], "no-store");
    assert.equal(h[1].headers["set-cookie"], undefined);
    assert.equal(h[1].headers.authorization, undefined);
    assert(h[1].warnings.some((w) => w.includes("Fixture origin blocked")));
    const comparison = (
      await app.inject({
        url: `/api/compare?before=${h[0].id}&after=${h[1].id}`,
        headers: { host: "127.0.0.1" },
      })
    ).json();
    assert(
      comparison.parts.some(
        (p: any) => p.removed && p.value.includes("Independent oversight"),
      ),
    );
    assert.deepEqual(comparison.linksRemoved, [
      "https://old.example.org/report",
    ]);
    await page.getByRole("button", { name: "Inline", exact: true }).click();
    assert((await page.locator("del").count()) > 0);
    await page
      .getByRole("button", { name: "Side by side", exact: true })
      .click();
    mkdirSync(resolve("docs/screenshots"), { recursive: true });
    await page.screenshot({
      path: "docs/screenshots/comparison.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Revision history", exact: true })
      .click();
    await page.getByLabel("Search capture text").fill("Independent oversight");
    await page.getByLabel("Search capture text").press("Enter");
    await page.waitForTimeout(300);
    assert.equal(await page.locator(".revision").count(), 1);
    await page.getByRole("button", { name: "Reset search" }).click();
    await page.waitForTimeout(200);
    await page
      .getByRole("button", { name: "Inspect capture", exact: true })
      .click();
    await page.locator(".capture-image").waitFor();
    await page.screenshot({
      path: "docs/screenshots/capture.png",
      fullPage: true,
    });
    const html = await app.inject({
      url: `/api/captures/${h[0].id}/files/page.html`,
      headers: { host: "127.0.0.1" },
    });
    assert.match(String(html.headers["content-disposition"]), /attachment/);
    assert.match(String(html.headers["content-type"]), /text\/plain/);
    await page
      .getByRole("button", { name: "↓ Export evidence ZIP", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Your receipts are ready." })
      .waitFor();
    const exported = await app.inject({
      url: `/api/sources/${source.id}/export`,
      headers: { host: "127.0.0.1" },
    });
    assert.equal(exported.statusCode, 200);
    const files = unzipSync(exported.rawPayload);
    const folder = join(root, "bundle");
    mkdirSync(folder);
    for (const [name, data] of Object.entries(files)) {
      const file = join(folder, name);
      mkdirSync(resolve(file, ".."), { recursive: true });
      writeFileSync(file, data);
    }
    const verifier = join(folder, "verify.mjs");
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          verifier,
          folder,
          "--expect",
          String(exported.headers["x-manifest-sha256"]),
        ],
        { encoding: "utf8" },
      ),
    );
    assert(result.ok);
    assert.equal(result.captures, 2);
    mkdirSync("examples", { recursive: true });
    writeFileSync("examples/fixture-evidence.zip", exported.rawPayload);
    writeFileSync(
      "examples/fixture-verification.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    writeFileSync(
      "examples/fixture-manifest.sha256",
      String(exported.headers["x-manifest-sha256"]) + "\n",
    );
    const selectedExport = await app.inject({
      url: `/api/sources/${source.id}/export?ids=${h[0].id}`,
      headers: { host: "127.0.0.1" },
    });
    const selectedManifest = JSON.parse(
      Buffer.from(
        unzipSync(selectedExport.rawPayload)["manifest.json"],
      ).toString(),
    );
    assert.equal(selectedManifest.captures.length, 1);
    assert.deepEqual(selectedManifest.requestedCaptures, [h[0].id]);
    await page.getByRole("button", { name: "Close export details" }).click();
    await page
      .getByRole("button", { name: "Application settings", exact: true })
      .click();
    await page.getByLabel("Render settle delay (milliseconds)").fill("100");
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    assert.equal(store.settings().settleMs, 100);
    await page
      .getByRole("button", { name: "Edit source", exact: true })
      .click();
    await page.getByLabel("Source name").fill("Research bulletin revised");
    await page
      .getByLabel("Description", { exact: true })
      .fill("Research source notes");
    await page.getByLabel("Monitoring interval").selectOption("5");
    await page
      .getByRole("button", { name: "Save source", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Research bulletin revised", exact: true })
      .waitFor();
    assert.equal(store.source(source.id)!.description, "Research source notes");
    assert.deepEqual(store.source(source.id)!.selectors, [".clock"]);
    store.pause(source.id, true);
    store.db
      .prepare("UPDATE sources SET lastAttempt=? WHERE id=?")
      .run("2000-01-01T00:00:00.000Z", source.id);
    await runScheduled();
    assert.equal(store.history(source.id).length, 2);
    store.pause(source.id, false);
    const scheduled = runScheduled();
    await assert.rejects(runCapture(source.id), /Another capture/);
    await scheduled;
    const scheduledHistory = store.history(source.id);
    assert.equal(scheduledHistory.length, 3);
    assert.equal(scheduledHistory[2].sourceName, "Research bulletin revised");
    assert.equal(
      scheduledHistory[2].sourceDescription,
      "Research source notes",
    );
    assert.equal(
      scheduledHistory[2].files["text.txt"],
      scheduledHistory[1].files["text.txt"],
    );
    version = 3;
    const failed = await app.inject({
      method: "POST",
      url: `/api/sources/${source.id}/capture`,
      headers: { host: "127.0.0.1" },
    });
    assert.equal(failed.statusCode, 400);
    assert.match(failed.json().error, /403/);
    assert.equal(store.history(source.id).length, 3);
    assert.match(store.source(source.id)!.error!, /403/);
    version = 2;
    await page
      .getByRole("button", { name: "Search captures", exact: true })
      .click();
    await page.getByLabel("Search every source").fill("Independent oversight");
    await page
      .getByRole("button", { name: "Search captures", exact: true })
      .last()
      .click();
    await page.locator(".search-result").waitFor();
    assert.equal(await page.locator(".search-result").count(), 1);
    await page.getByRole("button", { name: "Close search" }).click();
    await page
      .getByRole("button", { name: "Edit source", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Remove source from monitoring (archive)" })
      .click();
    assert.equal(store.sources().length, 0);
    assert.equal(store.history(source.id).length, 3);
    await page.getByLabel("Show archived sources").check();
    await page
      .getByRole("button", { name: "Edit source", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Edit source", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Restore source", exact: true })
      .click();
    assert.equal(store.sources().length, 1);
    const artifact = join(folder, `captures/${h[0].id}/text.txt`);
    writeFileSync(artifact, "tampered");
    const bad = spawnSync(process.execPath, [verifier, folder], {
      encoding: "utf8",
    });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /MODIFIED/);
    writeFileSync(artifact, files[`captures/${h[0].id}/text.txt`]);
    rmSync(join(folder, `captures/${h[0].id}/screenshot.png`));
    const missing = spawnSync(process.execPath, [verifier, folder], {
      encoding: "utf8",
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /MISSING/);
    assert.throws(
      () => store.db.prepare("DELETE FROM captures WHERE id=?").run(h[0].id),
      /append-only/,
    );
    assert.throws(
      () =>
        store.db
          .prepare("UPDATE captures SET metadata='{}' WHERE id=?")
          .run(h[0].id),
      /append-only/,
    );
    writeFileSync(
      join(root, "data", "captures", h[0].id, "text.txt"),
      "modified storage",
    );
    const corrupt = await app.inject({
      url: `/api/sources/${source.id}/export`,
      headers: { host: "127.0.0.1" },
    });
    assert.equal(corrupt.statusCode, 400);
    assert.match(corrupt.json().error, /modified/);
    store.attempt(source.id, null);
    await page.reload();
    await page
      .getByRole("heading", { name: "Research bulletin revised", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "docs/screenshots/mobile.png",
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "No mobile overflow",
    );
    await assert.rejects(
      capture(fixtureUrl + "redirect", [], { fixtureUrl, fetcher }),
    );
    assert.equal(internalHits, 0, "Private redirect was never requested");
  } finally {
    await browser.close();
    await app.close();
    await new Promise<void>((r) => fixture.close(() => r()));
    await new Promise<void>((r) => forbidden.close(() => r()));
    rmSync(root, { recursive: true, force: true });
  }
});
