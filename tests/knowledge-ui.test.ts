import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createApp } from "../src/server.js";
import type { Captured } from "../src/capture.js";

test("research connections workspace edits context, links capture evidence, exports JSON and preserves capture chains", async () => {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "knowledge-ui-"));
  const { app, store } = await createApp({ root, testMode: true });
  const browser = await chromium.launch({
    downloadsPath: join(root, "downloads"),
  });
  try {
    const source = store.add({
      url: "https://example.com/policy",
      name: "Public policy source",
      description: "Connections UI fixture",
      collection: "Policy",
      intervalMinutes: 0,
      selectors: [],
    });
    // Seed preserved artifacts explicitly; this test exercises the real UI and API, not capture rendering.
    const fixture: Captured = {
      html: "<html><body><h1>Policy evidence</h1></body></html>",
      text: "Policy evidence",
      title: "Policy evidence",
      description: "",
      finalUrl: source.url,
      status: 200,
      headers: {},
      links: [],
      observedAt: "2026-01-01T00:00:00Z",
      screenshot: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        "base64",
      ),
      warnings: [],
      ignoredSelectors: [],
    };
    const first = store.save(source, fixture);
    const second = store.save(source, {
      ...fixture,
      text: "Revised policy evidence",
      observedAt: "2026-01-02T00:00:00Z",
    });
    const originalMetadata = store.file(second.id, "metadata.json");
    await app.listen({ host: "127.0.0.1", port: 0 });
    const page = await browser.newPage({
      viewport: { width: 1536, height: 1100 },
      acceptDownloads: true,
    });
    await page.goto(
      `http://127.0.0.1:${(app.server.address() as { port: number }).port}`,
    );
    await page
      .getByRole("button", { name: "Research connections", exact: true })
      .click();
    let dialog = page.getByRole("dialog", { name: "Research connections" });
    await dialog
      .getByText("Researcher connections, not verified facts.", {
        exact: false,
      })
      .waitFor();
    await dialog
      .getByRole("button", { name: "+ Add research node", exact: true })
      .click();
    await dialog.getByLabel("Title", { exact: true }).fill("Policy oversight");
    await dialog
      .getByLabel("Research kind", { exact: true })
      .selectOption("claim");
    await dialog
      .getByLabel("Research notes", { exact: true })
      .fill("Researcher interpretation of policy oversight.");
    await dialog
      .getByLabel("Tags (comma separated)", { exact: true })
      .fill("policy, oversight");
    await dialog
      .getByRole("button", { name: "Save research node", exact: true })
      .click();
    await dialog
      .getByText("Research node saved locally.", { exact: true })
      .waitFor();
    const headers = { host: "127.0.0.1" };
    const initial = (
      await app.inject({ url: "/api/knowledge", headers })
    ).json();
    assert.equal(initial.nodes.length, 1);
    const node = initial.nodes[0];
    await dialog
      .getByLabel("Search research", { exact: true })
      .fill("oversight");
    await dialog.getByLabel("Node kind", { exact: true }).selectOption("claim");
    assert.equal(
      await dialog.locator(".knowledge-node-list button").count(),
      1,
    );
    await dialog
      .getByLabel("Node kind", { exact: true })
      .selectOption("person");
    assert.equal(
      await dialog.locator(".knowledge-node-list button").count(),
      0,
    );
    await dialog.getByLabel("Node kind", { exact: true }).selectOption("all");
    await dialog.getByLabel("Search research", { exact: true }).fill("");
    await dialog
      .getByLabel("From node", { exact: true })
      .selectOption("node:" + node.id);
    await dialog
      .getByLabel("To node", { exact: true })
      .selectOption("source:" + source.id);
    await dialog
      .getByLabel("Relationship label", { exact: true })
      .fill("discusses");
    await dialog
      .getByLabel("Relationship note", { exact: true })
      .fill("Supported by the later preserved policy capture.");
    await dialog
      .getByLabel("Supporting capture (optional)", { exact: true })
      .selectOption(second.id);
    await dialog
      .getByRole("button", { name: "Save relationship", exact: true })
      .click();
    await dialog
      .getByText("Research relationship saved locally.", { exact: true })
      .waitFor();
    const graph = (await app.inject({ url: "/api/knowledge", headers })).json();
    assert.equal(graph.edges.length, 1);
    assert.equal(graph.edges[0].evidenceCaptureId, second.id);
    assert.deepEqual(graph.backlinks["source:" + source.id], [
      graph.edges[0].id,
    ]);
    await dialog
      .locator(".knowledge-node-list button")
      .filter({ hasText: source.name })
      .click();
    await dialog.getByText("Incoming · discusses", { exact: true }).waitFor();
    await dialog
      .getByRole("button", { name: "Policy oversight", exact: true })
      .click();
    await dialog.getByText("Outgoing · discusses", { exact: true }).waitFor();
    assert(
      (await dialog.boundingBox())!.width > 1000,
      "Desktop research workspace should use the available width",
    );
    await dialog.evaluate((e) => (e.scrollTop = 0));
    mkdirSync(resolve("docs/screenshots"), { recursive: true });
    await page.screenshot({
      path: "docs/screenshots/connections.png",
      fullPage: true,
    });
    const downloadPromise = page.waitForEvent("download");
    await dialog
      .getByRole("link", { name: "Export research JSON ↓", exact: true })
      .click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "sourcewatch-research.json");
    // Managed Windows cancels even a data-URL download. Validate the browser's
    // download intent and actual HTTP payload; do not claim a completed native download.
    const failure = await download.failure();
    let exported;
    if (!failure) {
      const path = await download.path();
      assert(path);
      exported = JSON.parse(readFileSync(path, "utf8"));
    } else {
      assert.equal(failure, "canceled");
      const response = await page.request.get(download.url());
      assert.equal(response.status(), 200);
      assert.match(
        response.headers()["content-disposition"],
        /attachment; filename="sourcewatch-research.json"/,
      );
      exported = await response.json();
    }
    assert.equal(exported.format, "sourcewatch-research-context");
    assert.match(exported.notice, /not verified relationships/);
    assert.equal(
      exported.nodes[0].body,
      "Researcher interpretation of policy oversight.",
    );
    assert.equal(exported.edges[0].evidenceCaptureId, second.id);
    assert(!Object.hasOwn(exported, "chainTip"));
    await dialog
      .getByRole("button", { name: "Inspect supporting capture", exact: true })
      .click();
    await page.getByText(second.chainHash, { exact: true }).waitFor();
    assert.equal(
      await page.getByText(first.chainHash, { exact: true }).count(),
      0,
    );
    await page
      .getByRole("button", { name: "Research connections", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Research connections" });
    await dialog
      .locator(".knowledge-node-list button")
      .filter({ hasText: "Policy oversight" })
      .click();
    await dialog
      .getByRole("button", { name: "Edit node", exact: true })
      .click();
    await dialog
      .getByLabel("Title", { exact: true })
      .fill("Revised oversight claim");
    await dialog
      .getByRole("button", { name: "Save research node", exact: true })
      .click();
    await dialog
      .getByRole("heading", { name: "Revised oversight claim", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "Connections workspace must not overflow mobile viewport",
    );
    await page.screenshot({
      path: "docs/screenshots/connections-mobile.png",
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Remove relationship", exact: true })
      .click();
    await dialog
      .getByText("No researcher relationships yet.", { exact: true })
      .waitFor();
    await dialog
      .getByRole("button", { name: "Delete research node", exact: true })
      .click();
    await dialog
      .getByText(
        "Research node and its relationships deleted. Captures are preserved.",
        { exact: true },
      )
      .waitFor();
    const final = (await app.inject({ url: "/api/knowledge", headers })).json();
    assert.equal(final.nodes.length, 0);
    assert.equal(final.edges.length, 0);
    assert.equal(store.history(source.id).length, 2);
    assert.deepEqual(store.file(second.id, "metadata.json"), originalMetadata);
    assert.deepEqual(store.get(second.id), second);
  } finally {
    await browser.close();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
