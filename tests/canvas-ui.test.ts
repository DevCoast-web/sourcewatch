import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createApp } from "../src/server.js";
import type { CanvasData } from "../src/canvas.js";
import { createCanvas } from "../src/canvas.js";

test("a saved canvas stays in a loading state until its real document arrives", async () => {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "canvas-hydration-"));
  const { app, store, workspace } = await createApp({ root, testMode: true });
  const row = createCanvas(store, workspace).save({ title: "Saved research board", nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const browser = await chromium.launch(), page = await browser.newPage();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/canvases/" + row.id, async (route) => { await gate; await route.continue(); });
  try {
    await page.goto(`http://127.0.0.1:${(app.server.address() as any).port}/?workspace=canvas`);
    await page.getByText("Loading saved canvases…", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Canvas title", { exact: true }).count(), 0, "No placeholder editor is exposed during hydration");
    release();
    const title = page.getByLabel("Canvas title", { exact: true });
    await title.waitFor();
    assert.equal(await title.inputValue(), "Saved research board");
    assert.equal(workspace.list("canvas").length, 1);
  } finally { release(); await browser.close(); await app.close(); assert(root.startsWith(resolve(".test-data"))); rmSync(root, { recursive: true, force: true }); }
});

test("canvas workspace persists real interactions, references, researcher lines, exports, conflicts and mobile layout", async () => {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "canvas-ui-"));
  const { app, store, workspace } = await createApp({ root, testMode: true });
  const browser = await chromium.launch({
    downloadsPath: join(root, "downloads"),
  });
  try {
    const vault = workspace.put("vault", { title: "Canvas fixture vault" });
    const note = workspace.put("note", {
      title: "Referenced research note",
      body: "# Preserved interpretation\nThis note must survive card removal.",
      tags: [],
      aliases: [],
      properties: {},
      folder: "",
      vaultId: vault.id,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const page = await browser.newPage({
      viewport: { width: 1536, height: 1100 },
      acceptDownloads: true,
    });
    // Read the application's actual generated Blob before native download handoff.
    // The managed browser can deny disk saves; this verifies export bytes and intent independently.
    await page.addInitScript(() => {
      const state = window as any;
      state.canvasExports = [];
      const blobs = new Map<string, Blob>();
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (blob: Blob | MediaSource) {
        const url = create(blob);
        if (blob instanceof Blob) blobs.set(url, blob);
        return url;
      };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download && this.href.startsWith("blob:")) {
          const name = this.download;
          void blobs
            .get(this.href)
            ?.arrayBuffer()
            .then((buffer) =>
              state.canvasExports.push({
                name,
                bytes: Array.from(new Uint8Array(buffer)),
              }),
            );
        }
        return click.call(this);
      };
    });
    await page.goto(
      `http://127.0.0.1:${(app.server.address() as { port: number }).port}`,
    );
    await page.getByRole("button", { name: "Notes & vault", exact: true }).click();
    const shell = page.locator(".sw-shell");
    await shell.getByRole("button", { name: "Canvas", exact: true }).click();
    const canvas = shell.getByRole("region", { name: "Canvas workspace" });
    await canvas
      .getByRole("button", { name: "+ New canvas", exact: true })
      .click();
    await canvas
      .getByLabel("Canvas title", { exact: true })
      .fill("Evidence planning canvas");
    const save = async () => {
      await canvas
        .getByRole("button", { name: "Save now", exact: true })
        .click();
      await canvas
        .getByRole("status")
        .filter({ hasText: "Saved locally." })
        .waitFor();
    };
    await save();
    const id = workspace.list<CanvasData>("canvas")[0].id;
    await canvas
      .getByRole("button", { name: "+ Markdown card", exact: true })
      .click();
    await canvas
      .getByLabel("Markdown card text", { exact: true })
      .fill("# First card\n**Researcher interpretation**");
    await canvas.getByLabel("Card x", { exact: true }).fill("40");
    await canvas.getByLabel("Card y", { exact: true }).fill("40");
    await save();
    let record = workspace.get<CanvasData>(id, "canvas")!;
    const first = record.data.nodes[0].id;
    assert.equal(record.data.nodes[0].x, 40);
    const header = canvas.locator(".canvas-drag-handle").first();
    const box = await header.boundingBox();
    assert(box);
    await page.mouse.move(box.x + 40, box.y + 15);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 75, { steps: 6 });
    await page.mouse.up();
    await save();
    record = workspace.get<CanvasData>(id, "canvas")!;
    assert(record.data.nodes[0].x > 40);
    assert.equal(record.data.nodes[0].x % 20, 0);
    await canvas
      .getByRole("button", { name: "Duplicate selected", exact: true })
      .click();
    await canvas
      .getByLabel("Markdown card text", { exact: true })
      .fill("# Second card\nA distinct hypothesis.");
    await canvas.getByLabel("Card x", { exact: true }).fill("420");
    await save();
    record = workspace.get<CanvasData>(id, "canvas")!;
    const second = record.data.nodes.find((n) => n.id !== first)!.id;
    assert.equal(record.data.nodes.length, 2);
    await canvas
      .getByLabel("Selected canvas cards", { exact: true })
      .selectOption([first, second]);
    await canvas
      .getByLabel("Align selected cards", { exact: true })
      .selectOption("top");
    await save();
    record = workspace.get<CanvasData>(id, "canvas")!;
    assert.equal(record.data.nodes[0].y, record.data.nodes[1].y);
    await canvas
      .getByLabel("Connection from", { exact: true })
      .selectOption(first);
    await canvas
      .getByLabel("Connection to", { exact: true })
      .selectOption(second);
    await canvas
      .getByLabel("Start arrow", { exact: true })
      .selectOption("arrow");
    await canvas.getByLabel("End arrow", { exact: true }).selectOption("arrow");
    await canvas
      .getByLabel("Connection label", { exact: true })
      .fill("Research hypothesis");
    await canvas
      .getByLabel("Connection classification", { exact: true })
      .selectOption("hypothesis");
    await canvas
      .getByLabel("Connection explanation", { exact: true })
      .fill("This is a planning connection, not a verified relationship.");
    await canvas
      .getByRole("button", { name: "Save connection", exact: true })
      .click();
    await save();
    record = workspace.get<CanvasData>(id, "canvas")!;
    assert.equal(
      record.data.edges[0].sourcewatch?.classification,
      "hypothesis",
    );
    assert.equal(record.data.edges[0].fromEnd, "arrow");
    await canvas
      .getByLabel("Workspace record to embed", { exact: true })
      .selectOption("note:" + note.id);
    await canvas
      .getByRole("button", { name: "Embed record", exact: true })
      .click();
    await save();
    assert.equal(workspace.get<CanvasData>(id)!.data.nodes.length, 3);
    await canvas
      .getByRole("button", {
        name: "Delete selected cards / line",
        exact: true,
      })
      .click();
    await save();
    assert(
      workspace.get(note.id),
      "Deleting placement must preserve the referenced note",
    );
    assert.equal(workspace.get<CanvasData>(id)!.data.nodes.length, 2);
    await canvas.getByRole("button", { name: "Undo", exact: true }).click();
    await save();
    assert.equal(workspace.get<CanvasData>(id)!.data.nodes.length, 3);
    await canvas.getByRole("button", { name: "Redo", exact: true }).click();
    await save();
    assert.equal(workspace.get<CanvasData>(id)!.data.nodes.length, 2);
    await canvas
      .getByRole("checkbox", { name: "Read-only", exact: true })
      .check();
    assert(
      await canvas
        .getByRole("button", { name: "+ Markdown card", exact: true })
        .isDisabled(),
    );
    await canvas
      .getByRole("checkbox", { name: "Read-only", exact: true })
      .uncheck();
    await canvas
      .getByRole("button", { name: "Fit cards", exact: true })
      .click();
    await save();
    for (const [name, extension] of [
      ["Export .canvas draft", "canvas"],
      ["Export SVG view", "svg"],
      ["Export PNG view", "png"],
    ]) {
      const before = await page.evaluate(
        () => (window as any).canvasExports.length,
      );
      const pending = page.waitForEvent("download");
      await canvas.getByRole("button", { name, exact: true }).click();
      const result = await pending;
      assert(result.suggestedFilename());
      await page.waitForFunction(
        (before) => (window as any).canvasExports.length > before,
        before,
      );
      const values = await page.evaluate(
        (before) => (window as any).canvasExports[before].bytes,
        before,
      );
      const bytes = Buffer.from(values);
      if (extension === "canvas") {
        const exported = JSON.parse(bytes.toString());
        assert.equal(
          exported.edges[0].sourcewatch.classification,
          "hypothesis",
        );
      }
      if (extension === "svg") assert.match(bytes.toString(), /<svg/);
      if (extension === "png")
        assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    }
    const latest = workspace.get<CanvasData>(id)!;
    workspace.put(
      "canvas",
      { ...latest.data, title: "Changed by another view" },
      id,
      latest.revision,
    );
    await canvas
      .getByLabel("Canvas title", { exact: true })
      .fill("Unsaved conflict draft");
    await canvas.getByRole("button", { name: "Save now", exact: true }).click();
    await canvas
      .getByText("Another view changed this canvas.", { exact: true })
      .waitFor();
    assert.equal(
      await canvas.getByLabel("Canvas title", { exact: true }).inputValue(),
      "Unsaved conflict draft",
    );
    assert.equal(
      workspace.get<CanvasData>(id)!.data.title,
      "Changed by another view",
    );
    await canvas
      .getByRole("button", {
        name: "Discard draft and reload server version",
        exact: true,
      })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>('[aria-label="Canvas title"]')
          ?.value === "Changed by another view",
    );
    mkdirSync(resolve("docs/screenshots"), { recursive: true });
    await page.screenshot({
      path: "docs/screenshots/canvas.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: "docs/screenshots/canvas-mobile.png",
      fullPage: true,
    });
    assert.equal(store.sources().length, 0);
    assert(workspace.get(note.id));
  } finally {
    await browser.close();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
