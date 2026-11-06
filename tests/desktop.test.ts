import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { createApp } from "../src/server.js";
test("desktop session authentication protects API and static assets while retaining origin checks", async () => {
  mkdirSync(".test-data", { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "desktop-auth-")),
    token = "a".repeat(64);
  const { app } = await createApp({
    root,
    testMode: true,
    desktopToken: token,
  });
  try {
    assert.equal((await app.inject("/api/status")).statusCode, 403);
    assert.equal(
      (
        await app.inject({
          url: "/api/status",
          headers: { "x-sourcewatch-desktop-token": "b".repeat(64) },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: "/",
          headers: { "x-sourcewatch-desktop-token": token },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/status",
          headers: { "x-sourcewatch-desktop-token": token },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/status",
          headers: {
            "x-sourcewatch-desktop-token": token,
            origin: "https://example.com",
          },
        })
      ).statusCode,
      403,
    );
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
import { chromium } from "playwright";
import { saveAttachment } from "../src/workspace-routes.js";
test("research directory searches real records, previews documents and navigates records in the connected shell", async () => {
  mkdirSync(".test-data", { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "directory-ui-"));
  const { app, workspace } = await createApp({ root, testMode: true });
  const browser = await chromium.launch();
  try {
    const entity = workspace.put("entity", {
      title: "Demo Atlas Research",
      type: "organization",
      tags: ["synthetic"],
      classification: "annotation",
    });
    saveAttachment(workspace, {
      filename: "demo-evidence.png",
      mime: "image/png",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await page.goto(
      "http://127.0.0.1:" +
        (app.server.address() as any).port +
        "/?workspace=overview",
    );
    const overview = page.getByRole("region", { name: "Research overview" });
    await overview
      .getByRole("button", { name: "demo-evidence.png", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Record details", exact: true })
      .getByRole("img", { name: "demo-evidence.png", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Close record details", exact: true })
      .click();
    await overview
      .getByLabel("Search research directory", { exact: true })
      .fill("Atlas");
    assert.equal(await overview.locator("tbody tr").count(), 1);
    await overview
      .getByRole("button", { name: "Demo Atlas Research", exact: true })
      .click();
    const titleField = page.getByLabel("Record title", { exact: true });
    for (let i = 0; i < 50; i++) {
      if ((await titleField.inputValue()) === "Demo Atlas Research") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(await titleField.inputValue(), "Demo Atlas Research");
    assert.equal(workspace.get(entity.id)?.data.title, "Demo Atlas Research");
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page
      .getByRole("button", { name: "Switch dark theme", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  } finally {
    await browser.close();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
