import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { unzipSync } from "fflate";
import { Store } from "../src/storage.js";
import { WorkspaceStore } from "../src/workspace-store.js";
import { createIntelligence, parseCSV } from "../src/intelligence.js";
function setup() {
  mkdirSync(".test-data", { recursive: true });
  const root = mkdtempSync(resolve(".test-data/intel-"));
  const store = new Store(root),
    workspace = new WorkspaceStore(store),
    engine = createIntelligence(store, workspace);
  const source = store.add({
    url: "https://example.com",
    name: "Synthetic filing",
    description: "",
    collection: "Synthetic",
    intervalMinutes: 0,
    selectors: [],
  });
  const capture = store.save(source, {
    html: "<h1>Synthetic filing</h1>",
    text: "Synthetic record",
    title: "Synthetic filing",
    description: "",
    finalUrl: source.url,
    status: 200,
    headers: {},
    links: [],
    observedAt: new Date().toISOString(),
    screenshot: Buffer.from("fixture"),
    warnings: [],
    ignoredSelectors: [],
  });
  return {
    root,
    store,
    workspace,
    engine,
    capture,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("intelligence CRUD persists evidence reviews, original currency/null amount, revisions and explicit identity", () => {
  const f = setup();
  try {
    const a = f.engine.save("entity", {
        title: "Example Ltd",
        type: "corporation",
        aliases: ["Example"],
        identifiers: { registry: "SYN-1" },
        citations: [{ ref: "capture:" + f.capture.id, section: "Page 1" }],
      }),
      b = f.engine.save("entity", {
        title: "Example Ltd",
        type: "corporation",
      });
    assert.notEqual(a.id, b.id);
    const edge = f.engine.save("relationship", {
      title: "Synthetic payment",
      fromRef: "entity:" + a.id,
      toRef: "entity:" + b.id,
      type: "pays",
      financial: { amount: null, currency: "USD", category: "payment" },
      evidenceRefs: ["capture:" + f.capture.id],
    });
    assert.equal(edge.data.classification, "annotation");
    assert.equal(edge.data.financial.amount, null);
    assert.throws(
      () =>
        f.engine.save("relationship", {
          ...edge.data,
          classification: "verified",
        }),
      /explicit evidence review/,
    );
    assert.throws(
      () =>
        f.engine.review(edge.id, {
          reviewer: "",
          explanation: "check",
          status: "verified",
        }),
      /Invalid/,
    );
    assert.throws(
      () =>
        f.engine.review(edge.id, {
          reviewer: "A",
          explanation: "check",
          status: "verified",
          evidenceRefs: ["entity:" + a.id],
        }),
      /preserved/,
    );
    const verified = f.engine.review(edge.id, {
      reviewer: "Synthetic reviewer",
      explanation: "Compared page 1 of retained filing",
      status: "verified",
    });
    assert.equal(verified.data.classification, "verified");
    assert.equal(verified.data.reviews.length, 1);
    assert.equal(f.engine.history(edge.id).length, 2);
    assert.equal(
      f.engine.list("relationship", {
        classification: "verified",
        currency: "USD",
      }).total,
      1,
    );
    assert.equal(f.store.get(f.capture.id)?.chainHash, f.capture.chainHash);
    assert.throws(
      () => f.engine.save("entity", { title: "X" }, a.id, 0),
      /changed/,
    );
    f.engine.remove(b.id);
    assert.equal(f.workspace.get(b.id), undefined);
    assert(f.workspace.history(b.id).length >= 2);
  } finally {
    f.close();
  }
});
test("validated CSV/JSON imports isolate malformed rows, report duplicate names and roll back accepted writes on failure", () => {
  const f = setup();
  try {
    assert.deepEqual(parseCSV('title,type\n"A, Ltd",corporation\n'), [
      { title: "A, Ltd", type: "corporation" },
    ]);
    assert.throws(() => parseCSV('title\n"oops'), /Unclosed/);
    const input = {
      kind: "entity",
      format: "json",
      content: JSON.stringify([
        { title: "Same", type: "corporation" },
        { title: "Same", type: "person" },
        { title: "" },
      ]),
    };
    assert.equal(
      f.engine.importRecords({ ...input, dryRun: true }).accepted,
      2,
    );
    assert.equal(f.engine.list("entity").total, 0);
    const result = f.engine.importRecords(input);
    assert.equal(result.accepted, 2);
    assert.equal(result.rejected, 1);
    assert.equal(result.warnings.length, 1);
    assert.equal(f.engine.list("entity").total, 2);
    const original = f.workspace.put.bind(f.workspace);
    let writes = 0;
    f.workspace.put = ((...args: any[]) => {
      if (++writes === 2) throw new Error("Simulated write failure");
      return (original as any)(...args);
    }) as any;
    assert.throws(
      () =>
        f.engine.importRecords({
          ...input,
          content: JSON.stringify([
            { title: "Atomic A" },
            { title: "Atomic B" },
          ]),
        }),
      /Simulated/,
    );
    assert.equal(f.engine.list("entity").total, 2);
  } finally {
    f.close();
  }
});
test("indexed graph, bounded paths, saved boards, investigations and corrections remain researcher context", () => {
  const f = setup();
  try {
    const entities = ["A", "B", "C"].map((title) =>
      f.engine.save("entity", { title }),
    );
    const refs = entities.map((e) => "entity:" + e.id);
    for (let i = 0; i < 2; i++)
      f.engine.save("relationship", {
        title: "Related",
        type: "documented association",
        fromRef: refs[i],
        toRef: refs[i + 1],
      });
    const graph = f.engine.graph({ center: refs[0], hops: 2 });
    assert.equal(graph.nodes.length, 3);
    assert.equal(graph.edges.length, 2);
    assert(f.engine.path(refs[0], refs[2]).found);
    assert.equal(f.engine.path(refs[0], refs[2]).relationships.length, 2);
    const board = f.engine.save("board", {
      title: "Synthetic board",
      filters: { center: refs[0], hops: 2 },
    });
    assert.equal(board.data.filters.hops, 2);
    const investigation = f.engine.save("investigation", {
      title: "Synthetic case",
      refs: [refs[0], "capture:" + f.capture.id],
      timeline: [{ date: "2026-01-01", body: "Synthetic event" }],
    });
    const correction = f.engine.save("correction", {
      title: "Clarify record",
      targetRef: refs[0],
      evidenceRefs: ["capture:" + f.capture.id],
    });
    assert.equal(
      f.engine.review(correction.id, {
        reviewer: "A",
        explanation: "Reviewed source",
        status: "accepted",
      }).data.status,
      "accepted",
    );
    assert.equal(f.engine.get(investigation.id)?.kind, "investigation");
    assert(f.engine.audit().length > 0);
    assert.throws(
      () => f.store.db.exec("DELETE FROM workspace_audit"),
      /append-only/,
    );
  } finally {
    f.close();
  }
});
test("portable research ZIP verifies offline and rejects changed research context", () => {
  const f = setup();
  try {
    f.engine.save("entity", { title: "Synthetic export" });
    const exported = f.engine.exportRecords("zip");
    const files = unzipSync(exported.bytes),
      folder = join(f.root, "export");
    mkdirSync(folder);
    for (const [n, b] of Object.entries(files))
      writeFileSync(join(folder, n), b);
    assert.match(
      execFileSync(process.execPath, [join(folder, "verify.mjs"), folder], {
        encoding: "utf8",
      }),
      /OK/,
    );
    writeFileSync(join(folder, "research.json"), "tampered");
    const bad = spawnSync(
      process.execPath,
      [join(folder, "verify.mjs"), folder],
      { encoding: "utf8" },
    );
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /MODIFIED/);
    assert.match(
      Buffer.from(files["research.json"]).toString(),
      /Mutable researcher context/,
    );
  } finally {
    f.close();
  }
});

import { chromium } from "playwright";
import { createApp } from "../src/server.js";
test("real intelligence UI creates entities and evidence-reviewed relationship, opens network and exports", async () => {
  mkdirSync(".test-data", { recursive: true });
  const root = mkdtempSync(resolve(".test-data/intel-ui-"));
  const app = await createApp({ root, testMode: true });
  const s = app.store.add({
    url: "https://example.com",
    name: "Synthetic filing",
    description: "",
    collection: "Test",
    intervalMinutes: 0,
    selectors: [],
  });
  const capture = app.store.save(s, {
    html: "<p>Synthetic evidence</p>",
    text: "Synthetic evidence",
    title: "Synthetic evidence",
    description: "",
    finalUrl: s.url,
    status: 200,
    headers: {},
    links: [],
    observedAt: new Date().toISOString(),
    screenshot: Buffer.from("fixture"),
    warnings: [],
    ignoredSelectors: [],
  });
  await app.app.listen({ host: "127.0.0.1", port: 0 });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  try {
    await page.goto(
      "http://127.0.0.1:" + (app.app.server.address() as any).port,
    );
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await page
      .getByRole("button", { name: "Database & network", exact: true })
      .click();
    const ui = page.locator(".intelligence");
    await ui
      .getByLabel("Record title", { exact: true })
      .fill("Synthetic payer");
    await ui.getByRole("button", { name: "Save record", exact: true }).click();
    await ui.getByText("Record saved with a recoverable revision.").waitFor();
    await ui.getByRole("button", { name: "New entity", exact: true }).click();
    await ui
      .getByLabel("Record title", { exact: true })
      .fill("Synthetic recipient");
    await ui.getByRole("button", { name: "Save record", exact: true }).click();
    await page.waitForTimeout(200);
    const entities = app.workspace.list("entity");
    assert.equal(entities.length, 2);
    await ui
      .getByLabel("Record category", { exact: true })
      .selectOption("relationship");
    await ui
      .getByLabel("Record title", { exact: true })
      .fill("Synthetic payment");
    await ui
      .getByLabel("From reference", { exact: true })
      .fill("entity:" + entities[0].id);
    await ui
      .getByLabel("To reference", { exact: true })
      .fill("entity:" + entities[1].id);
    await ui
      .getByLabel("Evidence references (one per line)", { exact: true })
      .fill("capture:" + capture.id);
    await ui.getByRole("button", { name: "Save record", exact: true }).click();
    await ui
      .getByRole("heading", { name: "Explicit review", exact: true })
      .waitFor();
    await ui.getByLabel("Reviewer", { exact: true }).fill("Synthetic reviewer");
    await ui
      .getByLabel("Review explanation", { exact: true })
      .fill("Compared this explicit synthetic filing.");
    await ui
      .getByRole("button", {
        name: "Verify against cited evidence",
        exact: true,
      })
      .click();
    await ui
      .getByText(
        "Explicit local review recorded. This is not independent certification.",
      )
      .waitFor();
    assert.equal(
      app.workspace.list("relationship")[0].data.classification,
      "verified",
    );
    await ui.getByRole("button", { name: "Network", exact: true }).click();
    await ui.locator(".intel-network circle").first().waitFor();
    assert.equal(await ui.locator(".intel-network circle").count(), 2);
    await ui.getByRole("button", { name: "Zoom in", exact: true }).click();
    assert.match(
      (await ui.locator(".intel-network > g").getAttribute("transform")) || "",
      /scale\(1.2\)/,
    );
    await ui.getByRole("button", { name: "Fit graph", exact: true }).click();
    mkdirSync("docs/screenshots", { recursive: true });
    await page.screenshot({
      path: "docs/screenshots/intelligence-network.png",
      fullPage: true,
    });
    await ui
      .getByRole("button", { name: "Imports/Audit", exact: true })
      .click();
    const download = page.waitForEvent("download");
    await ui.getByRole("link", { name: "Download zip", exact: true }).click();
    assert.equal((await download).suggestedFilename(), "research.zip");
    await ui.getByRole("button", { name: "Database", exact: true }).click();
    await ui
      .getByLabel("Record category", { exact: true })
      .selectOption("entity");
    await ui.getByRole("button", { name: "New entity", exact: true }).click();
    await ui
      .getByLabel("Record title", { exact: true })
      .fill("Recoverable unsaved entity");
    await page
      .getByRole("button", { name: "Close research workspace", exact: true })
      .click();
    await page
      .getByText(
        "Wait for autosave, or recover/export the unsaved draft before closing the workspace.",
        { exact: true },
      )
      .waitFor();
    assert(
      await page
        .getByRole("dialog", { name: "Research workspace", exact: true })
        .isVisible(),
    );
    await ui
      .getByRole("button", { name: "Discard intelligence draft", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Close research workspace", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Research workspace", exact: true })
      .waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  } finally {
    await browser.close();
    await app.app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
