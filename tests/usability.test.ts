import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { unzipSync } from "fflate";
import { createApp } from "../src/server.js";

test("first-use browser journey: add redirecting website, inspect, compare, download and independently verify", async () => {
  mkdirSync(".test-data", { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "first-use-"));
  let version = 1;
  let releaseFirst: () => void = () => {};
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const fixture = createServer(async (req, res) => {
    if (req.url === "/") { res.writeHead(301, { location: "/final" }); res.end(); return; }
    if (version === 1) await first;
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<html><head><title>Research terms</title></head><body><h1>Research terms</h1><p>Unchanged introduction</p><p>${version === 1 ? "Deleted clause" : "New disclosure"}</p></body></html>`);
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const fixtureURL = `http://127.0.0.1:${(fixture.address() as any).port}/`;
  const service = await createApp({ root: join(root, "data"), testMode: true, captureOptions: {
    fixtureUrl: fixtureURL, settleMs: 10,
    fetcher: async (url) => { const r = await fetch(url, { redirect: "manual" }); return { status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) }; },
  } });
  await service.app.listen({ host: "127.0.0.1", port: 0 });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${(service.app.server.address() as any).port}/?workspace=overview`);
    await page.getByRole("button", { name: "Add a website", exact: true }).click();
    await page.getByLabel("Website URL").fill(fixtureURL);
    await page.getByLabel("Source name").fill("Research terms");
    await page.getByRole("button", { name: "Add source", exact: true }).click();
    await page.getByRole("heading", { name: "Research terms", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Sources & captures", exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Capture first version", exact: true }).click();
    await page.getByText(/Capturing the page ·/).waitFor();
    releaseFirst();
    await page.getByText("First capture saved.", { exact: true }).waitFor({ timeout: 15000 });
    await page.locator(".capture-image").waitFor();
    const source = service.store.sources()[0];
    assert.equal(service.store.history(source.id)[0].finalUrl, fixtureURL + "final");
    version = 2;
    await page.getByRole("button", { name: "Capture another version", exact: true }).click();
    await page.getByRole("button", { name: "Inline", exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Inline", exact: true }).click();
    assert.match((await page.locator("del").allTextContents()).join(" "), /Deleted clause/);
    assert.match((await page.locator("ins").allTextContents()).join(" "), /New disclosure/);
    const history = service.store.history(source.id);
    assert.equal(history.length, 2);
    assert.equal(history[1].previousHash, history[0].chainHash);
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "↓ Export evidence ZIP", exact: true }).click();
    const download = await pending;
    const zip = join(root, "download.zip"); await download.saveAs(zip);
    await page.getByRole("heading", { name: "Your receipts are ready." }).waitFor();
    const retained = await page.locator(".modal .hash").innerText();
    const { readFileSync } = await import("node:fs");
    const files = unzipSync(readFileSync(zip)), bundle = join(root, "bundle");
    for (const [name, bytes] of Object.entries(files)) { const target = join(bundle, name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); }
    const result = JSON.parse(execFileSync(process.execPath, [resolve("scripts/verify.mjs"), bundle, "--expect", retained], { encoding: "utf8" }));
    assert.equal(result.ok, true); assert.equal(result.captures, 2);
    await page.getByRole("button", { name: "Close export details" }).click();
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1440, height: 1000 });
    mkdirSync("docs/screenshots", { recursive: true });
    await page.screenshot({ path: "docs/screenshots/research-home.png" });
    await page.getByRole("button", { name: "Sources & captures", exact: true }).click();
    assert.equal(await page.getByRole("heading", { name: "Research terms", exact: true }).isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { releaseFirst(); await browser.close(); await service.app.close(); await new Promise<void>((resolve) => fixture.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test("a refused capture shows a recoverable failure on home and can be retried without losing the source", async () => {
  const root = mkdtempSync(join(resolve(".test-data"), "capture-recovery-"));
  let denied = true;
  const service = await createApp({ root, testMode: true, captureOptions: {
    fixtureUrl: "https://example.com/", settleMs: 0,
    fetcher: async () => ({ status: denied ? 403 : 200, headers: { "content-type": "text/html" }, body: Buffer.from("<html><title>Public page</title><body><h1>Public page</h1></body></html>") }),
  } });
  service.store.add({ url: "https://example.com/", name: "Retry source", description: "", collection: "Research", intervalMinutes: 0, selectors: [] });
  await service.app.listen({ host: "127.0.0.1", port: 0 });
  const browser = await chromium.launch(), page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${(service.app.server.address() as any).port}/`);
    await page.getByRole("button", { name: "Capture first version", exact: true }).click();
    await page.getByText("No new capture was saved.", { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(service.store.history(service.store.sources()[0].id).length, 0);
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    const attention = page.getByRole("region", { name: "Captures needing attention" });
    await attention.waitFor();
    denied = false;
    await attention.getByRole("button").click();
    await page.getByRole("button", { name: "Capture first version", exact: true }).click();
    await page.getByText("First capture saved.", { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(service.store.sources()[0].error, null);
    assert.equal(service.store.history(service.store.sources()[0].id).length, 1);
  } finally { await browser.close(); await service.app.close(); rmSync(root, { recursive: true, force: true }); }
});
