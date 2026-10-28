import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, firefox } from "playwright";
import { createApp } from "../src/server.js";

/** Real application/storage; routing is used only to inject response delays/errors. */
test("UI audit: capture identity remains consistent under delayed and failed requests", async (t) => {
  const name = process.env.SOURCEWATCH_AUDIT_BROWSER || "chromium";
  if (!["chromium", "firefox", "edge"].includes(name))
    throw new Error("Unsupported audit browser");
  const browserType = name === "firefox" ? firefox : chromium;
  const browser = await browserType.launch({
    timeout: 15000,
    ...(name === "edge" ? { channel: "msedge" } : {}),
  });
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "audit-ui-"));
  const app = await createApp({ root, testMode: true });
  try {
    const seedPage = await browser.newPage();
    await seedPage.setContent("<h1>Saved fixture</h1>");
    const screenshot = await seedPage.screenshot();
    await seedPage.close();
    const source = app.store.add({
      url: "https://example.com/",
      name: "Audit Alpha",
      description: "",
      collection: "Audit",
      intervalMinutes: 0,
      selectors: [],
    });
    const secondSource = app.store.add({
      url: "https://example.org/",
      name: "Audit Beta",
      description: "",
      collection: "Audit",
      intervalMinutes: 0,
      selectors: [],
    });
    const seed = (name: string) => ({
      html: `<main><p>${name}</p></main>`,
      text: name,
      title: name,
      description: "",
      finalUrl: "https://example.com/",
      status: 200,
      headers: {},
      links: [],
      observedAt: new Date().toISOString(),
      screenshot,
      warnings: [],
      ignoredSelectors: [],
    });
    const first = app.store.save(source, seed("Alpha earlier"));
    const second = app.store.save(source, seed("Alpha latest"));
    const beta = app.store.save(secondSource, seed("Beta only"));
    const headers = { host: "127.0.0.1" };
    const noteResult = await app.app.inject({
      method: "PUT",
      url: `/api/captures/${second.id}/annotation`,
      headers,
      payload: { note: "Alpha latest private note", tags: ["latest"] },
    });
    assert.equal(noteResult.statusCode, 200);
    await app.app.listen({ host: "127.0.0.1", port: 0 });
    const url = `http://127.0.0.1:${(app.app.server.address() as { port: number }).port}`;

    await t.test(
      "inspect hides prior metadata while a different capture is loading",
      async () => {
        const page = await browser.newPage();
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        try {
          await page.goto(url);
          await page
            .locator("button.source")
            .filter({ hasText: "Audit Alpha" })
            .click();
          await page
            .getByRole("button", { name: "Inspect capture", exact: true })
            .click();
          await page.getByText(second.chainHash, { exact: true }).waitFor();
          await page.route(`**/api/captures/${first.id}`, async (route) => {
            await gate;
            await route.continue();
          });
          const requested = page.waitForRequest(
            (r) => new URL(r.url()).pathname === `/api/captures/${first.id}`,
          );
          await page
            .getByLabel("Inspect capture", { exact: true })
            .selectOption(first.id);
          await requested;
          assert.equal(
            await page.getByText(second.chainHash, { exact: true }).count(),
            0,
            "Old metadata must not accompany the newly selected capture's artifact URLs",
          );
        } finally {
          release();
          await page.close();
        }
      },
    );

    await t.test(
      "annotation load failure cannot copy previous capture's note into selected capture",
      async () => {
        const page = await browser.newPage();
        try {
          await page.goto(url);
          await page
            .locator("button.source")
            .filter({ hasText: "Audit Alpha" })
            .click();
          await page
            .getByRole("button", { name: "Inspect capture", exact: true })
            .click();
          await page.waitForFunction(
            () =>
              (
                document.querySelector(
                  'textarea[aria-label="Research notes"]',
                ) as HTMLTextAreaElement | null
              )?.value === "Alpha latest private note",
          );
          await page.route(`**/api/captures/${first.id}/annotation`, (route) =>
            route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ error: "Audit annotation unavailable" }),
            }),
          );
          await page
            .getByLabel("Inspect capture", { exact: true })
            .selectOption(first.id);
          await page
            .getByText("Audit annotation unavailable", { exact: true })
            .waitFor();
          assert.equal(
            await page
              .getByRole("button", { name: "Save notes", exact: true })
              .isDisabled(),
            true,
            "Save must remain disabled until the selected capture's annotation loads",
          );
          assert.notEqual(
            await page
              .getByRole("textbox", { name: "Research notes", exact: true })
              .inputValue(),
            "Alpha latest private note",
          );
        } finally {
          await page.close();
        }
      },
    );

    await t.test(
      "text comparison failure preserves screenshot and structure review",
      async () => {
        const page = await browser.newPage();
        try {
          await page.route("**/api/compare?**", (route) =>
            route.fulfill({
              status: 400,
              contentType: "application/json",
              body: JSON.stringify({
                error: "Comparison exceeds complexity limit",
              }),
            }),
          );
          await page.goto(url);
          await page
            .locator("button.source")
            .filter({ hasText: "Audit Alpha" })
            .click();
          await page
            .getByText("Comparison exceeds complexity limit", { exact: true })
            .waitFor();
          assert.equal(
            await page
              .getByRole("button", { name: "Screenshots", exact: true })
              .count(),
            1,
            "Screenshot review must be available independently of text diff",
          );
          await page
            .getByRole("button", { name: "Screenshots", exact: true })
            .click();
          await page
            .locator(".visual-before img")
            .evaluate((image) => (image as HTMLImageElement).decode());
          await page
            .getByRole("button", { name: "HTML structure", exact: true })
            .click();
          await page
            .getByText("No structural changes detected.", { exact: true })
            .waitFor();
        } finally {
          await page.close();
        }
      },
    );

    await t.test(
      "late history response cannot replace currently selected source's history",
      async () => {
        const page = await browser.newPage();
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        try {
          await page.goto(url);
          await page
            .locator("button.source")
            .filter({ hasText: "Audit Beta" })
            .click();
          await page
            .getByRole("button", { name: "Revision history", exact: true })
            .click();
          await page.getByRole("button", { name: /Beta only/ }).waitFor();
          let intercepted = () => {};
          const requested = new Promise<void>((resolve) => {
            intercepted = resolve;
          });
          await page.route(
            `**/api/sources/${source.id}/captures`,
            async (route) => {
              const response = await route.fetch();
              intercepted();
              await gate;
              await route.fulfill({ response });
            },
          );
          await page
            .locator("button.source")
            .filter({ hasText: "Audit Alpha" })
            .click();
          await requested;
          await page
            .locator("button.source")
            .filter({ hasText: "Audit Beta" })
            .click();
          await page.getByRole("button", { name: /Beta only/ }).waitFor();
          const delivered = page.waitForResponse(
            (r) =>
              new URL(r.url()).pathname ===
              `/api/sources/${source.id}/captures`,
          );
          release();
          await (await delivered).finished();
          // Flush the fetch JSON and React update following the completed response.
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          );
          assert.equal(
            await page
              .locator(".revision")
              .filter({ hasText: "Alpha" })
              .count(),
            0,
            "A late history response must not show Alpha receipts beneath Beta",
          );
          assert.equal(
            await page
              .locator(".revision")
              .filter({ hasText: "Beta only" })
              .count(),
            1,
          );
          assert.equal(
            (await app.store.get(beta.id))?.sourceId,
            secondSource.id,
          );
        } finally {
          release();
          await page.close();
        }
      },
    );
    await t.test(
      "failed settings save presents an actionable error inside the open dialog",
      async () => {
        const page = await browser.newPage();
        try {
          await page.route("**/api/settings", (route) =>
            route.request().method() === "PATCH"
              ? route.fulfill({
                  status: 503,
                  contentType: "application/json",
                  body: JSON.stringify({
                    error: "Audit settings write failed",
                  }),
                })
              : route.continue(),
          );
          await page.goto(url);
          await page
            .getByRole("button", { name: "Application settings", exact: true })
            .click();
          const dialog = page.getByRole("dialog", {
            name: "Application settings",
            exact: true,
          });
          await dialog
            .getByRole("button", { name: "Save settings", exact: true })
            .click();
          await dialog
            .getByRole("alert")
            .filter({ hasText: "Audit settings write failed" })
            .waitFor();
          assert.equal(
            await dialog.isVisible(),
            true,
            "The failed form must remain available for correction/retry",
          );
          assert.equal(
            await dialog
              .getByRole("button", { name: "Save settings", exact: true })
              .isEnabled(),
            true,
          );
        } finally {
          await page.close();
        }
      },
    );

    await t.test(
      "global capture search opens the exact matching older capture",
      async () => {
        const page = await browser.newPage();
        try {
          await page.goto(url);
          await page
            .locator("button.source")
            .filter({ hasText: "Audit Beta" })
            .click();
          await page
            .getByRole("button", { name: "Search captures", exact: true })
            .click();
          const dialog = page.getByRole("dialog", {
            name: "Search preserved text",
            exact: true,
          });
          await dialog
            .getByLabel("Search every source", { exact: true })
            .fill("Alpha earlier");
          await dialog
            .getByRole("button", { name: "Search captures", exact: true })
            .click();
          await dialog
            .locator(".search-result")
            .filter({ hasText: "Alpha earlier" })
            .click();
          await page.getByText(first.chainHash, { exact: true }).waitFor();
          assert.equal(
            await page
              .getByLabel("Inspect capture", { exact: true })
              .inputValue(),
            first.id,
          );
          assert.equal(
            await page
              .locator(".source-detail .capture-image")
              .getAttribute("src"),
            `/api/captures/${first.id}/files/screenshot.png`,
          );
          assert.equal(
            await page.getByText(second.chainHash, { exact: true }).count(),
            0,
          );
        } finally {
          await page.close();
        }
      },
    );

    await t.test(
      "hiding a selected archived source selects an available active source",
      async () => {
        const page = await browser.newPage();
        app.store.archive(source.id, true);
        try {
          await page.goto(url);
          await page
            .getByLabel("Show archived sources", { exact: true })
            .check();
          await page
            .locator("button.source")
            .filter({ hasText: "Audit Alpha" })
            .click();
          await page
            .locator(".detail-heading h2")
            .filter({ hasText: "Audit Alpha" })
            .waitFor();
          await page
            .getByLabel("Show archived sources", { exact: true })
            .uncheck();
          await page
            .locator(".detail-heading h2")
            .filter({ hasText: "Audit Beta" })
            .waitFor();
          assert.equal(
            await page
              .locator("button.source.selected")
              .filter({ hasText: "Audit Beta" })
              .count(),
            1,
          );
          assert.equal(
            await page
              .locator("button.source")
              .filter({ hasText: "Audit Alpha" })
              .count(),
            0,
          );
          assert.equal(
            app.store.history(source.id).length,
            2,
            "Filtering must retain archived evidence",
          );
        } finally {
          app.store.archive(source.id, false);
          await page.close();
        }
      },
    );

    await t.test(
      "an old annotation save response cannot alter the newly inspected capture",
      async () => {
        const page = await browser.newPage();
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let saved = () => {};
        const saveReachedServer = new Promise<void>((resolve) => {
          saved = resolve;
        });
        try {
          await page.goto(url);
          await page
            .locator("button.source")
            .filter({ hasText: "Audit Alpha" })
            .click();
          await page
            .getByRole("button", { name: "Inspect capture", exact: true })
            .click();
          await page.waitForFunction(
            () =>
              (
                document.querySelector(
                  'input[aria-label="Research tags"]',
                ) as HTMLInputElement | null
              )?.value === "latest",
          );
          await page.route(
            `**/api/captures/${second.id}/annotation`,
            async (route) => {
              if (route.request().method() !== "PUT") return route.continue();
              const response = await route.fetch();
              saved();
              await gate;
              await route.fulfill({ response });
            },
          );
          await page
            .getByRole("textbox", { name: "Research tags", exact: true })
            .fill("pending-latest");
          await page
            .getByRole("button", { name: "Save notes", exact: true })
            .click();
          await saveReachedServer;
          await page
            .getByLabel("Inspect capture", { exact: true })
            .selectOption(first.id);
          await page.getByText(first.chainHash, { exact: true }).waitFor();
          await page.waitForFunction(() => {
            const input = document.querySelector(
              'input[aria-label="Research tags"]',
            ) as HTMLInputElement | null;
            return input && !input.disabled && input.value === "";
          });
          const delivered = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname ===
                `/api/captures/${second.id}/annotation` &&
              response.request().method() === "PUT",
          );
          release();
          await (await delivered).finished();
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          );
          assert.equal(
            await page
              .getByRole("textbox", { name: "Research tags", exact: true })
              .inputValue(),
            "",
          );
          assert.equal(
            await page
              .getByRole("textbox", { name: "Research notes", exact: true })
              .inputValue(),
            "",
          );
          assert.equal(
            await page
              .locator(".research-notes")
              .getByText("Notes saved locally.", { exact: true })
              .count(),
            0,
          );
          const annotation = (
            await app.app.inject({
              url: `/api/captures/${first.id}/annotation`,
              headers,
            })
          ).json();
          assert.equal(annotation.note, "");
          assert.deepEqual(annotation.tags, []);
        } finally {
          release();
          await page.close();
          await app.app.inject({
            method: "PUT",
            url: `/api/captures/${second.id}/annotation`,
            headers,
            payload: { note: "Alpha latest private note", tags: ["latest"] },
          });
        }
      },
    );
    await t.test(
      "an outdated running backend shows restart guidance and its actual version",
      async () => {
        const page = await browser.newPage();
        try {
          await page.route("**/api/status", (route) =>
            route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                version: "1.0.0",
                busy: false,
                unread: 0,
              }),
            }),
          );
          await page.goto(url);
          await page
            .getByText(/Restart SOURCEWATCH/)
            .first()
            .waitFor();
          await page.locator("footer").filter({ hasText: "1.0.0" }).waitFor();
          assert.equal(
            await page
              .locator("footer")
              .filter({ hasText: "1.0.0" })
              .isVisible(),
            true,
            "Version display must report the running backend rather than the newly built UI version",
          );
        } finally {
          await page.close();
        }
      },
    );

    await t.test(
      "failed global capture search shows its error inside the search dialog",
      async () => {
        const page = await browser.newPage();
        try {
          await page.route("**/api/search?**", (route) =>
            route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: "Audit preserved search unavailable",
              }),
            }),
          );
          await page.goto(url);
          await page
            .getByRole("button", { name: "Search captures", exact: true })
            .click();
          const dialog = page.getByRole("dialog", {
            name: "Search preserved text",
            exact: true,
          });
          await dialog
            .getByLabel("Search every source", { exact: true })
            .fill("Alpha earlier");
          await dialog
            .getByRole("button", { name: "Search captures", exact: true })
            .click();
          await dialog
            .getByRole("alert")
            .filter({ hasText: "Audit preserved search unavailable" })
            .waitFor();
          assert.equal(await dialog.isVisible(), true);
          assert.equal(
            await dialog
              .getByLabel("Search every source", { exact: true })
              .inputValue(),
            "Alpha earlier",
            "A failed request must preserve the query for retry",
          );
          assert.equal(
            await dialog
              .getByRole("button", { name: "Search captures", exact: true })
              .isEnabled(),
            true,
          );
        } finally {
          await page.close();
        }
      },
    );
  } finally {
    await browser.close();
    await app.app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
