import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { unzipSync } from "fflate";
import { createApp } from "../src/server.js";
import { createIntelligence } from "../src/intelligence.js";
import { createVault } from "../src/vault.js";
import { saveAttachment, exportWorkspace } from "../src/workspace-routes.js";
test("integrated journey finds entity, explores network, annotates canvas, reviews evidence and restores after service restart", async () => {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "journey-"));
  let service = await createApp({ root, testMode: true });
  const browser = await chromium.launch();
  try {
    const engine = createIntelligence(service.store, service.workspace),
      a = engine.save("entity", {
        title: "Journey organization A",
        type: "organization",
      }),
      b = engine.save("entity", {
        title: "Journey organization B",
        type: "organization",
      });
    engine.save("relationship", {
      title: "Existing documented context",
      type: "association",
      fromRef: "entity:" + a.id,
      toRef: "entity:" + b.id,
      classification: "annotation",
      explanation: "Synthetic fixture, not a factual assertion",
    });
    const vault = createVault(service.workspace),
      n = vault.saveNote({
        title: "Journey note",
        body: "# Research plan\nOpen [[Journey followup]].",
        refs: ["entity:" + a.id],
      }),
      followup = vault.saveNote({
        title: "Journey followup",
        body: "Return to [[Journey note]].",
      });
    const attachment = saveAttachment(service.workspace, {
      filename: "fixture.png",
      mime: "image/png",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    });
    await service.app.listen({ host: "127.0.0.1", port: 0 });
    const page = await browser.newPage({
      viewport: { width: 1500, height: 1000 },
    });
    await page.goto(
      `http://127.0.0.1:${(service.app.server.address() as any).port}`,
    );
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await page
      .getByRole("button", { name: "Database & network", exact: true })
      .click();
    const intelligence = page.locator(".intelligence");
    await intelligence
      .getByRole("button", { name: "Journey organization A", exact: true })
      .click();
    await intelligence
      .getByRole("button", { name: "Explore neighborhood", exact: true })
      .click();
    await intelligence
      .getByRole("button", {
        name: "Journey organization B · entity",
        exact: true,
      })
      .waitFor();
    await intelligence
      .getByRole("button", { name: "Add to canvas", exact: true })
      .click();
    const canvas = page.getByRole("region", { name: "Canvas workspace" });
    await canvas
      .getByLabel("Canvas title", { exact: true })
      .fill("Integrated research journey");
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
    for (const ref of [
      "entity:" + b.id,
      "note:" + n.id,
      "attachment:" + attachment.id,
    ]) {
      await canvas
        .getByLabel("Workspace record to embed", { exact: true })
        .selectOption(ref);
      await canvas
        .getByRole("button", { name: "Embed record", exact: true })
        .click();
      await save();
    }
    const board = service.workspace.list("canvas")[0];
    assert.equal(board.data.nodes.length, 4);
    const nodeA = board.data.nodes.find(
        (x: any) => x.sourcewatchRef === "entity:" + a.id,
      ),
      nodeB = board.data.nodes.find(
        (x: any) => x.sourcewatchRef === "entity:" + b.id,
      );
    await canvas
      .getByLabel("Connection from", { exact: true })
      .selectOption(nodeA.id);
    await canvas
      .getByLabel("Connection to", { exact: true })
      .selectOption(nodeB.id);
    await canvas
      .getByLabel("Connection label", { exact: true })
      .fill("Proposed association");
    await canvas
      .getByLabel("Connection explanation", { exact: true })
      .fill("Synthetic researcher hypothesis requiring review");
    await canvas
      .getByLabel("Connection classification", { exact: true })
      .selectOption("hypothesis");
    await canvas
      .getByRole("button", { name: "Save connection", exact: true })
      .click();
    await save();
    await canvas
      .getByRole("button", { name: "Propose evidence review", exact: true })
      .click();
    await intelligence
      .getByRole("heading", { name: "Explicit review", exact: true })
      .waitFor();
    await intelligence
      .getByLabel("Evidence references (one per line)", { exact: true })
      .fill("attachment:" + attachment.id);
    await intelligence
      .getByRole("button", { name: "Save record", exact: true })
      .click();
    await intelligence
      .getByText("Record saved with a recoverable revision.", { exact: true })
      .waitFor();
    await intelligence
      .getByLabel("Reviewer", { exact: true })
      .fill("Journey reviewer");
    await intelligence
      .getByLabel("Review explanation", { exact: true })
      .fill("Checked synthetic preserved attachment; local review only");
    await intelligence
      .getByRole("button", {
        name: "Verify against cited evidence",
        exact: true,
      })
      .click();
    await intelligence
      .getByText(
        "Explicit local review recorded. This is not independent certification.",
        { exact: true },
      )
      .waitFor();
    const relation = service.workspace
      .list("relationship")
      .find((x) => x.data.title === "Proposed association")!;
    assert.equal(relation.data.classification, "verified");
    assert.equal(vault.detail(followup.id).backlinks.length, 1);
    await page.close();
    await service.app.close();
    service = await createApp({ root, testMode: true });
    await service.app.listen({ host: "127.0.0.1", port: 0 });
    const reopened = await browser.newPage();
    await reopened.goto(
      `http://127.0.0.1:${(service.app.server.address() as any).port}`,
    );
    await reopened
      .getByRole("button", { name: "Workspace", exact: true })
      .click();
    await reopened.getByRole("button", { name: "Canvas", exact: true }).click();
    await reopened.getByLabel("Canvas title", { exact: true }).waitFor();
    assert.equal(
      await reopened.getByLabel("Canvas title", { exact: true }).inputValue(),
      "Integrated research journey",
    );
    const restored = service.workspace.get(board.id)!;
    assert.equal(
      restored.data.edges[0].sourcewatch.relationshipRef,
      "relationship:" + relation.id,
    );
    assert.equal(restored.data.nodes.length, 4);
    assert(service.workspace.get(attachment.id));
    const zip = unzipSync(exportWorkspace(service.workspace).zip);
    const exported = JSON.parse(
      Buffer.from(zip["canvases/" + board.id + ".canvas"]).toString(),
    );
    assert.equal(
      exported.edges[0].sourcewatch.relationshipRef,
      "relationship:" + relation.id,
    );
    assert(zip["notes/" + n.id + ".md"]);
    assert(zip["attachments/" + attachment.id + ".bin"]);
    assert(zip["revisions.json"]);
  } finally {
    await browser.close();
    await service.app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
