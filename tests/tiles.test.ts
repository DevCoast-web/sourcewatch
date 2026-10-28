import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { unzipSync } from "fflate";
import { chromium } from "playwright";
import { capture } from "../src/capture.js";
import { createApp } from "../src/server.js";
const fixtureUrl = "http://127.0.0.1:12345/";
const fixture = (height: number, width = 1365) => ({
  status: 200,
  headers: { "content-type": "text/html" },
  body: Buffer.from(
    `<!doctype html><html><head><title>Tiled research page</title></head><body style="margin:0;width:${width}px"><div style="height:${height - 100}px;background:#346251">Top of preserved page</div><footer style="height:100px;background:#ee6622">Final receipt at ${height}</footer></body></html>`,
  ),
});

test("tiled capture preserves a page beyond single-image height and area limits", async () => {
  const result = await capture(fixtureUrl, [], {
    fixtureUrl,
    fetcher: async () => fixture(210000),
    settleMs: 0,
    screenshotMode: "tiled",
    maxScreenshotHeight: 1000,
  });
  assert.equal(
    result.screenshotInfo?.complete,
    true,
    JSON.stringify(result.warnings),
  );
  assert.equal(result.screenshotInfo?.height, 210000);
  assert.equal(result.screenshotInfo?.tiles.length, 26);
  assert.match(result.text, /Final receipt at 210000/);
  let y = 0;
  for (const tile of result.screenshotInfo!.tiles) {
    assert.equal(tile.y, y);
    y += tile.height;
    const bytes = result.screenshotTiles![tile.file];
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), tile.width);
    assert.equal(bytes.readUInt32BE(20), tile.height);
  }
  assert.equal(y, 210000);
});

test("tiled browser capture, comparison, ZIP and standalone verification preserve ordered images and explicit text fallback", async () => {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "tiles-"));
  let height = 24000,
    width = 1365;
  const { app, store } = await createApp({
    root,
    testMode: true,
    captureOptions: { fixtureUrl, fetcher: async () => fixture(height, width) },
  });
  const browser = await chromium.launch();
  const headers = { host: "127.0.0.1" };
  try {
    store.setSettings(0, 1000, "tiled", true);
    const source = store.add({
      url: fixtureUrl,
      name: "Long receipt",
      description: "",
      collection: "Research",
      intervalMinutes: 0,
      selectors: [],
    });
    const first = await app.inject({
      method: "POST",
      url: `/api/sources/${source.id}/capture`,
      headers,
    });
    assert.equal(first.statusCode, 200, first.body);
    height = 26000;
    const second = await app.inject({
      method: "POST",
      url: `/api/sources/${source.id}/capture`,
      headers,
    });
    assert.equal(second.statusCode, 200, second.body);
    const records = store.history(source.id);
    assert.equal(records[1].screenshotInfo?.complete, true);
    assert(!Object.hasOwn(records[1].files, "screenshot.png"));
    assert.equal(records[1].screenshotInfo?.tiles.length, 4);
    assert.equal(
      (
        await app.inject({
          url: `/api/captures/${records[1].id}/files/screenshot-9999.png`,
          headers,
        })
      ).statusCode,
      404,
    );
    await app.listen({ host: "127.0.0.1", port: 0 });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      `http://127.0.0.1:${(app.server.address() as { port: number }).port}`,
    );
    await page
      .getByRole("button", { name: "Application settings", exact: true })
      .click();
    let settingsDialog = page.getByRole("dialog", {
      name: "Application settings",
    });
    await settingsDialog
      .getByLabel("Screenshot format", { exact: true })
      .selectOption("single");
    await settingsDialog
      .getByLabel("Preserve HTML and text if screenshots fail", { exact: true })
      .uncheck();
    await settingsDialog
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await settingsDialog.waitFor({ state: "hidden" });
    assert.equal(store.settings().screenshotMode, "single");
    assert.equal(store.settings().preserveTextOnScreenshotFailure, false);
    await page
      .getByRole("button", { name: "Application settings", exact: true })
      .click();
    settingsDialog = page.getByRole("dialog", { name: "Application settings" });
    assert.equal(
      await settingsDialog
        .getByLabel("Screenshot format", { exact: true })
        .inputValue(),
      "single",
    );
    await settingsDialog
      .getByLabel("Screenshot format", { exact: true })
      .selectOption("tiled");
    await settingsDialog
      .getByLabel("Preserve HTML and text if screenshots fail", { exact: true })
      .check();
    await settingsDialog
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await settingsDialog.waitFor({ state: "hidden" });
    assert.equal(store.settings().screenshotMode, "tiled");
    assert.equal(store.settings().preserveTextOnScreenshotFailure, true);
    await page
      .getByRole("button", { name: "Screenshots", exact: true })
      .click();
    await page
      .getByRole("slider", { name: "Earlier screenshot reveal" })
      .waitFor();
    assert.equal(await page.locator(".visual-after img").count(), 4);
    await page
      .locator(".visual-after img")
      .last()
      .evaluate(async (e) => {
        e.scrollIntoView();
        await (e as HTMLImageElement).decode();
      });
    // The final image must contain actual bottom-page orange pixels, not a repeated top tile.
    const bottom = await page
      .locator(".visual-after img")
      .last()
      .evaluate((e) => {
        const img = e as HTMLImageElement;
        const c = document.createElement("canvas");
        c.width = 1;
        c.height = 1;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 100, img.naturalHeight - 10, 1, 1, 0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data);
      });
    assert.deepEqual(bottom, [238, 102, 34, 255]);
    const out = await app.inject({
      url: `/api/sources/${source.id}/export`,
      headers,
    });
    assert.equal(out.statusCode, 200, out.body);
    const bundle = join(root, "bundle");
    mkdirSync(bundle);
    const zip = unzipSync(out.rawPayload);
    for (const [name, bytes] of Object.entries(zip)) {
      const file = join(bundle, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    }
    const run = () =>
      spawnSync(
        process.execPath,
        [
          join(bundle, "verify.mjs"),
          bundle,
          "--expect",
          String(out.headers["x-manifest-sha256"]),
        ],
        { encoding: "utf8" },
      );
    const intact = run();
    assert.equal(intact.status, 0, intact.stdout + intact.stderr);
    mkdirSync(resolve("examples"), { recursive: true });
    writeFileSync(resolve("examples/tiled-evidence.zip"), out.rawPayload);
    writeFileSync(
      resolve("examples/tiled-manifest.sha256"),
      String(out.headers["x-manifest-sha256"]) + "  manifest.json\n",
    );
    writeFileSync(resolve("examples/tiled-verification.json"), intact.stdout);
    const tileName = records[1].screenshotInfo!.tiles[3].file;
    rmSync(join(bundle, "captures", records[1].id, tileName));
    const missing = run();
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /MISSING|ARTIFACT/);
    width = 5000;
    const fallback = await app.inject({
      method: "POST",
      url: `/api/sources/${source.id}/capture`,
      headers,
    });
    assert.equal(fallback.statusCode, 200, fallback.body);
    const saved = fallback.json();
    assert.equal(saved.screenshotInfo.mode, "none");
    assert.equal(saved.screenshotInfo.complete, false);
    assert(!Object.keys(saved.files).some((n) => n.endsWith(".png")));
    assert.match(store.file(saved.id, "text.txt").toString(), /Final receipt/);
    assert.match(
      saved.warnings.join(" "),
      /HTML and readable text were preserved/,
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Inspect capture", exact: true })
      .click();
    await page
      .locator(".visual-warning")
      .filter({ hasText: "Page exceeds 4096px" })
      .waitFor();
    assert.equal(
      await page.locator(".inspect .preserved-screenshot img").count(),
      0,
    );
    assert.deepEqual(errors, []);
    store.setSettings(0, 1000, "single", false);
    const strict = await app.inject({
      method: "POST",
      url: `/api/sources/${source.id}/capture`,
      headers,
    });
    assert.equal(strict.statusCode, 400);
    assert.equal(store.history(source.id).length, 3);
  } finally {
    await browser.close();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("single-image overflow can preserve text and fallback settings reject malformed requests atomically", async () => {
  const result = await capture(fixtureUrl, [], {
    fixtureUrl,
    fetcher: async () => fixture(12000),
    settleMs: 0,
    maxScreenshotHeight: 1000,
  });
  assert.equal(result.screenshotInfo?.mode, "none");
  assert.match(result.text, /Final receipt/);
  const root = mkdtempSync(join(resolve(".test-data"), "tile-settings-"));
  const { app, store } = await createApp({ root, testMode: true });
  try {
    const before = store.settings();
    for (const payload of [
      { settleMs: 0, screenshotMode: "huge" },
      {
        settleMs: 0,
        screenshotMode: "tiled",
        preserveTextOnScreenshotFailure: "yes",
      },
    ]) {
      const r = await app.inject({
        method: "PATCH",
        url: "/api/settings",
        headers: { host: "127.0.0.1" },
        payload,
      });
      assert.equal(r.statusCode, 400);
      assert.deepEqual(store.settings(), before);
    }
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
