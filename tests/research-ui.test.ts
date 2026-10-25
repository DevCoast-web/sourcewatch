import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { unzipSync } from "fflate";
import { createApp } from "../src/server.js";
import { sha256 } from "../src/storage.js";

test("research workspace: real captures, inbox, visual structure review, notes, verified exports and persistent settings", async () => {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "research-ui-"));
  const fixtureUrl = "http://127.0.0.1:12345/";
  let version = 1;
  const fetcher = async () => ({
    status: 200,
    headers: { "content-type": "text/html" },
    body: Buffer.from(
      `<!doctype html><html><head><title>${version === 1 ? "Original" : "Revised"} policy</title></head><body style="padding:40px;font-family:Arial;min-height:${version === 1 ? 1600 : 900}px"><h1>Research policy</h1>${version === 1 ? "<p>Original commitment retained.</p>" : "<section><h2>Updated policy</h2><p>Revised commitment introduced.</p></section>"}<a href="https://${version === 1 ? "old" : "new"}.example.org/">Report</a></body></html>`,
    ),
  });
  const options = {
    root: join(root, "data"),
    testMode: true,
    captureOptions: { fixtureUrl, fetcher, settleMs: 0 },
  };
  const first = await createApp(options);
  let active = first;
  let appClosed = false;
  const browser = await chromium.launch();
  try {
    const source = first.store.add({
      url: fixtureUrl,
      name: "Research policy",
      description: "Policy revision study",
      collection: "Public accountability",
      intervalMinutes: 0,
      selectors: [],
    });
    const headers = { host: "127.0.0.1" };
    for (const v of [1, 2]) {
      version = v;
      const result = await first.app.inject({
        method: "POST",
        url: `/api/sources/${source.id}/capture`,
        headers,
      });
      assert.equal(result.statusCode, 200, result.body);
    }
    const history = first.store.history(source.id);
    assert.equal(history.length, 2);
    const metadata = first.store.file(history[1].id, "metadata.json");
    await first.app.listen({ host: "127.0.0.1", port: 0 });
    const page = await browser.newPage({
      viewport: { width: 1536, height: 1100 },
    });
    await page.goto(
      `http://127.0.0.1:${(first.app.server.address() as { port: number }).port}`,
    );
    await page.getByRole("button", { name: /^Change inbox/ }).click();
    await page
      .getByRole("button", { name: "Open comparison", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Screenshots", exact: true })
      .click();
    const range = page.getByRole("slider", {
      name: "Earlier screenshot reveal",
    });
    await range.press("Home");
    await range.press("ArrowRight");
    assert.equal(await range.inputValue(), "1");
    assert.notEqual(
      await page
        .locator(".visual-before")
        .evaluate((e) => getComputedStyle(e).clipPath),
      "none",
    );
    await page
      .locator(".visual-before img")
      .evaluate((image) => (image as HTMLImageElement).decode());
    assert(
      await page
        .locator(".visual-stack")
        .evaluate((e) => e.scrollHeight > e.clientHeight),
      "Taller earlier screenshot remains scrollable instead of being cropped to later image height",
    );
    mkdirSync(resolve("docs/screenshots"), { recursive: true });
    await page.screenshot({
      path: "docs/screenshots/research-workspace.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "HTML structure", exact: true })
      .click();
    await page.locator(".structure-comparison .added").first().waitFor();
    assert((await page.locator(".structure-comparison .removed").count()) > 0);
    await page
      .getByRole("button", { name: "Inspect capture", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Research notes", exact: true })
      .fill("Reviewed the revised commitment.");
    await page
      .getByRole("textbox", { name: "Research tags", exact: true })
      .fill("policy, reviewed");
    await page.getByRole("button", { name: "Save notes", exact: true }).click();
    await page.getByText("Notes saved locally.", { exact: true }).waitFor();
    const annotation = (
      await first.app.inject({
        url: `/api/captures/${history[1].id}/annotation`,
        headers,
      })
    ).json();
    assert.equal(annotation.note, "Reviewed the revised commitment.");
    assert.deepEqual(annotation.tags, ["policy", "reviewed"]);
    const noteSearch = (
      await first.app.inject({ url: "/api/search?q=reviewed", headers })
    ).json();
    assert.equal(noteSearch.length, 1);
    assert.match(noteSearch[0].snippet, /Research notes:/);
    const earlierExport = await first.app.inject({
      url: `/api/sources/${source.id}/export?ids=${history[0].id}`,
      headers,
    });
    assert.equal(
      unzipSync(earlierExport.rawPayload)["research-notes.json"],
      undefined,
      "Later notes are excluded from earlier selected export",
    );
    assert.deepEqual(
      first.store.file(history[1].id, "metadata.json"),
      metadata,
    );
    assert.deepEqual(first.store.get(history[1].id), history[1]);
    const events = (
      await first.app.inject({ url: "/api/research/events", headers })
    ).json();
    assert.equal(events.length, 1);
    assert(events[0].readAt);
    const exported = await first.app.inject({
      url: `/api/sources/${source.id}/export`,
      headers,
    });
    assert.equal(exported.statusCode, 200);
    const files = unzipSync(exported.rawPayload);
    assert(files["research-notes.json"]);
    const manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
    assert.equal(
      manifest.files["research-notes.json"],
      sha256(files["research-notes.json"]),
    );
    assert(
      Buffer.from(files["research-notes.json"])
        .toString()
        .includes(annotation.note),
    );
    const bundle = join(root, "bundle");
    mkdirSync(bundle);
    for (const [name, data] of Object.entries(files)) {
      const file = join(bundle, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, data);
    }
    const verifier = join(bundle, "verify.mjs");
    const verified = JSON.parse(
      execFileSync(
        process.execPath,
        [
          verifier,
          bundle,
          "--expect",
          String(exported.headers["x-manifest-sha256"]),
        ],
        { encoding: "utf8" },
      ),
    );
    assert(verified.ok);
    mkdirSync("examples", { recursive: true });
    writeFileSync("examples/research-evidence.zip", exported.rawPayload);
    writeFileSync(
      "examples/research-manifest.sha256",
      String(exported.headers["x-manifest-sha256"]) + "\n",
    );
    writeFileSync(
      "examples/research-verification.json",
      JSON.stringify(verified, null, 2) + "\n",
    );
    writeFileSync(join(bundle, "research-notes.json"), "modified");
    const bad = spawnSync(process.execPath, [verifier, bundle], {
      encoding: "utf8",
    });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /MODIFIED: research-notes.json/);
    await page
      .getByRole("button", { name: "Application settings", exact: true })
      .click();
    await page
      .getByLabel("Maximum screenshot height (pixels)", { exact: true })
      .fill("50000");
    const savedSettings = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/settings") && r.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    const settingsResponse = await savedSettings;
    assert.equal(settingsResponse.status(), 200, await settingsResponse.text());
    await page
      .getByRole("dialog", { name: "Application settings" })
      .waitFor({ state: "hidden" });
    assert.equal(first.store.settings().maxScreenshotHeight, 50000);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: "docs/screenshots/research-mobile.png",
      fullPage: true,
    });
    await first.app.close();
    appClosed = true;
    active = await createApp(options);
    appClosed = false;
    assert.equal(
      (await active.app.inject({ url: "/api/settings", headers })).json()
        .maxScreenshotHeight,
      50000,
    );
    assert.equal(
      (
        await active.app.inject({
          url: `/api/captures/${history[1].id}/annotation`,
          headers,
        })
      ).json().note,
      annotation.note,
    );
  } finally {
    await browser.close();
    if (!appClosed) await active.app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
