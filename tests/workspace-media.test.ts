import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createApp } from "../src/server.js";
import { saveAttachment } from "../src/workspace-routes.js";
function pdf() {
  const parts = ["%PDF-1.4\n"];
  const offsets = [0];
  const stream = "BT /F1 18 Tf 40 100 Td (SourceWatch local PDF fixture) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(parts.join("")));
    parts.push(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
  }
  const start = Buffer.byteLength(parts.join(""));
  parts.push(
    `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join(
        "",
      )}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`,
  );
  return Buffer.from(parts.join(""));
}
test("local PDF attachment renders through the real bundled worker without external requests", async () => {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "pdf-ui-"));
  const { app, workspace } = await createApp({ root, testMode: true });
  const browser = await chromium.launch();
  try {
    const attachment = saveAttachment(workspace, {
      filename: "research.pdf",
      mime: "application/pdf",
      base64: pdf().toString("base64"),
    });
    workspace.put("canvas", {
      title: "PDF fixture",
      nodes: [
        {
          id: "pdf",
          type: "file",
          file: "attachments/" + attachment.id,
          sourcewatchRef: "attachment:" + attachment.id,
          x: 0,
          y: 0,
          width: 520,
          height: 550,
        },
      ],
      edges: [],
      viewport: { x: 30, y: 30, zoom: 1 },
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1000 },
    });
    const external: string[] = [];
    page.on("request", (r) => {
      if (
        !r.url().startsWith("http://127.0.0.1:") &&
        !r.url().startsWith("blob:") &&
        !r.url().startsWith("data:")
      )
        external.push(r.url());
    });
    await page.goto(`http://127.0.0.1:${(app.server.address() as any).port}`);
    await page.getByRole("button", { name: "Notes & vault", exact: true }).click();
    await page.getByRole("button", { name: "Canvas", exact: true }).click();
    await page
      .getByRole("button", { name: "Load local PDF preview", exact: true })
      .click();
    await page.getByText("Page 1 / 1", { exact: true }).waitFor();
    await page
      .getByText("SourceWatch local PDF fixture", { exact: true })
      .waitFor({ state: "attached" });
    const dimensions = await page
      .locator('canvas[aria-label="Rendered PDF page 1"]')
      .evaluate((c: any) => ({
        width: c.width,
        height: c.height,
        pixels: [
          ...c.getContext("2d").getImageData(0, 0, c.width, c.height).data,
        ].some((v: number, i: number) => i % 4 !== 3 && v < 200),
      }));
    assert.equal(dimensions.width, 600);
    assert(dimensions.pixels);
    assert.deepEqual(external, []);
    await page
      .getByRole("button", { name: "Unload PDF preview", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Load local PDF preview", exact: true })
      .waitFor();
  } finally {
    await browser.close();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("attachment failed database writes leave no files or revision records", async () => {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "attachment-rollback-"));
  const { app, store, workspace } = await createApp({ root, testMode: true });
  try {
    store.db.exec(
      "CREATE TRIGGER fail_attachment BEFORE INSERT ON workspace_objects WHEN NEW.kind='attachment' BEGIN SELECT RAISE(ABORT,'fixture rejected'); END",
    );
    assert.throws(
      () =>
        saveAttachment(workspace, {
          filename: "research.pdf",
          mime: "application/pdf",
          base64: pdf().toString("base64"),
        }),
      /fixture rejected/,
    );
    assert.deepEqual(readdirSync(join(root, "workspace", "attachments")), []);
    assert.equal(workspace.list("attachment").length, 0);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
