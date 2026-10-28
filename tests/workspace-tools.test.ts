import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { createApp } from "../src/server.js";
import { createVault } from "../src/vault.js";
test("property views, declarative extensions, clipping and CLI execute against the local service", async () => {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "extras-"));
  const { app, workspace } = await createApp({ root, testMode: true });
  try {
    const n = createVault(workspace).saveNote({
      title: "Fixture budget",
      body: "Two words",
      properties: { budget: 12 },
      tags: [],
    });
    for (const [file, url] of [
      ["notes-import.json", "/api/vault/import"],
      ["network-import.json", "/api/intelligence/imports"],
    ]) {
      const imported = await app.inject({
        method: "POST",
        url,
        payload: JSON.parse(
          readFileSync(join("examples", "knowledge-workspace", file), "utf8"),
        ),
      });
      assert.equal(imported.statusCode, 200, imported.body);
      assert.equal(
        imported.json().rejected?.length || imported.json().errors?.length || 0,
        0,
      );
    }
    const query = await app.inject({
      method: "POST",
      url: "/api/workspace/bases/query",
      payload: { kind: "note", query: "Fixture budget", formula: "budget * 2" },
    });
    assert.equal(query.statusCode, 200);
    assert.equal(query.json()[0].computed, 24);
    const saved = await app.inject({
      method: "POST",
      url: "/api/workspace/bases",
      payload: {
        title: "Budget view",
        view: "table",
        kind: "note",
        query: "Fixture budget",
        formula: "budget * 2",
      },
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(workspace.get(saved.json().id)?.data.formula, "budget * 2");
    const bad = await app.inject({
      method: "POST",
      url: "/api/workspace/extensions",
      payload: {
        apiVersion: 1,
        id: "unsafe",
        name: "Unsafe",
        permissions: ["filesystem"],
        commands: [],
      },
    });
    assert(bad.statusCode >= 400);
    const extension = await app.inject({
      method: "POST",
      url: "/api/workspace/extensions",
      payload: {
        apiVersion: 1,
        id: "review-tools",
        name: "Review tools",
        permissions: [],
        commands: [{ title: "Open notes", action: "vault" }],
      },
    });
    assert.equal(extension.statusCode, 200);
    const clip = await app.inject({
      method: "POST",
      url: "/api/workspace/clip",
      payload: {
        url: "https://example.com/research",
        title: "Clipped fixture",
        text: "Selected public text",
      },
    });
    assert.equal(clip.statusCode, 200);
    assert.match(
      workspace.get(clip.json().id)!.data.body,
      /not an archived observation/,
    );
    const privateClip = await app.inject({
      method: "POST",
      url: "/api/workspace/clip",
      payload: { url: "http://127.0.0.1/", title: "No", text: "No" },
    });
    assert(privateClip.statusCode >= 400);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = (app.server.address() as any).port;
    const output = await new Promise<string>((res, rej) => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/sourcewatch-cli.ts",
          "notes",
          "Fixture budget",
        ],
        { env: { ...process.env, PORT: String(port) } },
      );
      let out = "",
        err = "";
      child.stdout.on("data", (b) => (out += b));
      child.stderr.on("data", (b) => (err += b));
      child.on("error", rej);
      child.on("exit", (code) => (code === 0 ? res(out) : rej(Error(err))));
    });
    assert.equal(JSON.parse(output)[0].id, n.id);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("browser audio recorder saves actual MediaRecorder bytes using a synthetic microphone", async () => {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "audio-ui-"));
  const { app, workspace } = await createApp({ root, testMode: true });
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${(app.server.address() as any).port}`);
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await page
      .getByRole("button", { name: "Tools & exports", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Record audio", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Stop recording", exact: true })
      .waitFor();
    await page.waitForFunction(() => {
      const e = document.querySelector("button:not([disabled])");
      return !!e;
    });
    // Wait for a genuine recorder chunk, rather than mocking the recorder or its output.
    await new Promise((r) => setTimeout(r, 1300));
    await page
      .getByRole("button", { name: "Stop recording", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save recording locally", exact: true })
      .click();
    await page.getByText(/^Audio saved:/).waitFor();
    const a = workspace.list("attachment")[0];
    assert(a.data.size > 100);
    assert.equal(a.data.mime, "audio/webm");
    assert.match(a.data.sha256, /^[a-f0-9]{64}$/);
  } finally {
    await browser.close();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
