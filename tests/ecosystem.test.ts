import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";
import { createApp } from "../src/server.js";
import { indexEcosystem, demoEcosystem } from "../src/ecosystem.js";
import { createVault } from "../src/vault.js";
import { createIntelligence } from "../src/intelligence.js";
import { prepareForce, forceStep } from "../ui/ecosystem-force.js";
async function fixture() {
  mkdirSync(".test-data", { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "ecosystem-"));
  const service = await createApp({ root, testMode: true });
  return {
    root,
    ...service,
    async close() {
      await service.app.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
async function seed(f: Awaited<ReturnType<typeof fixture>>) {
  const vault = createVault(f.workspace),
    a = vault.saveNote({
      title: "Hub research note",
      body: "[[Satellite note]]",
    }),
    b = vault.saveNote({
      title: "Satellite note",
      body: "Research interpretation",
    }),
    orphan = vault.saveNote({
      title: "Isolated record",
      body: "No references",
    });
  const engine = createIntelligence(f.store, f.workspace),
    entity = engine.save("entity", {
      title: "Documented organization",
      type: "organization",
    });
  const relation = engine.save("relationship", {
    title: "Research association",
    type: "research context",
    fromRef: "note:" + a.id,
    toRef: "entity:" + entity.id,
    classification: "hypothesis",
    explanation: "Synthetic fixture",
  });
  const investigation = engine.save("investigation", {
    title: "Saved investigation",
    refs: ["note:" + a.id, "entity:" + entity.id],
  });
  return { vault, a, b, orphan, entity, relation, investigation };
}
test("ecosystem indexes stored records and typed links, counts exclusions/orphans and automatically invalidates after edits", async () => {
  const f = await fixture();
  try {
    const data = await seed(f);
    const graph = indexEcosystem(f.store.db);
    assert.equal(graph.stats.indexed, 6);
    assert.equal(graph.stats.entities, 1);
    assert.equal(graph.stats.orphans, 1);
    assert.equal(graph.stats.excluded, 1);
    assert(
      graph.edges.some(
        (e) =>
          e.kind === "hyperlink" &&
          e.from === "note:" + data.a.id &&
          e.to === "note:" + data.b.id,
      ),
    );
    assert(
      graph.edges.some(
        (e) =>
          e.kind === "annotation" &&
          e.recordRef === "relationship:" + data.relation.id,
      ),
    );
    assert(!graph.edges.some((e) => e.kind === "verified"));
    const first = (await f.app.inject("/api/ecosystem")).json();
    assert(
      (
        await f.app.inject(
          "/api/ecosystem?since=" + encodeURIComponent(first.revision),
        )
      ).json().unchanged,
    );
    data.vault.saveNote(
      { ...data.b.data, title: "Renamed satellite" },
      data.b.id,
      data.b.revision,
    );
    const changed = (
      await f.app.inject(
        "/api/ecosystem?since=" + encodeURIComponent(first.revision),
      )
    ).json();
    assert.notEqual(changed.revision, first.revision);
    assert(changed.nodes.some((n: any) => n.title === "Renamed satellite"));
    assert(changed.edges.some((e: any) => e.kind === "hyperlink"));
    f.workspace.remove(data.entity.id, data.entity.revision);
    const removed = indexEcosystem(f.store.db);
    assert.equal(removed.stats.entities, 0);
    assert(removed.stats.unresolvedReferences > 0);
    assert.equal(removed.stats.excludedByReason.deleted, 1);
  } finally {
    await f.close();
  }
});
test("saved investigation layouts enforce revision checks and reuse an editable evidence-aware canvas", async () => {
  const f = await fixture();
  try {
    const { a, investigation } = await seed(f);
    const url = "/api/ecosystem/layout/" + investigation.id;
    const payload = {
      positions: { ["note:" + a.id]: { x: 125, y: 270 } },
      view: { x: 3, y: 4, z: 1 },
      expectedRevision: 0,
    };
    const saved = await f.app.inject({ method: "PUT", url, payload });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(
      (await f.app.inject({ method: "PUT", url, payload })).statusCode,
      409,
    );
    assert.equal(
      (await f.app.inject(url)).json().data.positions["note:" + a.id].x,
      125,
    );
    const canvas = await f.app.inject({
      method: "POST",
      url: "/api/ecosystem/investigation-canvas/" + investigation.id,
    });
    assert.equal(canvas.statusCode, 200, canvas.body);
    const record = canvas.json();
    assert(
      record.data.nodes.some((n: any) => n.sourcewatchRef === "note:" + a.id),
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/ecosystem/investigation-canvas/" + investigation.id,
        })
      ).json().id,
      record.id,
    );
    assert.equal(
      (await f.app.inject("/api/ecosystem/record?ref=note:" + a.id)).json().data
        .body,
      "[[Satellite note]]",
    );
  } finally {
    await f.close();
  }
});
test("10k/12k graph uses bounded force work and preserves every demonstration record without database writes", () => {
  const graph = demoEcosystem(),
    start = performance.now(),
    state = prepareForce(graph.nodes, graph.edges);
  for (let i = 0; i < 20; i++)
    forceStep(state.points, state.links, state.centers);
  assert.equal(state.points.length, 10000);
  assert.equal(state.links.length, 12000);
  assert(
    state.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
  );
  assert(performance.now() - start < 10000);
});
test("real browser Global Graph is discoverable, live, clustered, navigable and renders 10k/12k with useful filtering", async () => {
  const f = await fixture(),
    browser = await chromium.launch();
  try {
    const data = await seed(f);
    await f.app.listen({ host: "127.0.0.1", port: 0 });
    const page = await browser.newPage({
      viewport: { width: 1500, height: 1100 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:" + (f.app.server.address() as any).port);
    await page
      .getByRole("button", { name: "Global Graph", exact: true })
      .click();
    const graph = page.getByRole("region", { name: "Global Graph workspace" });
    await graph.getByText("Hub research note · note", { exact: true }).click();
    await graph
      .getByRole("heading", { name: "Hub research note", exact: true })
      .waitFor();
    await graph.getByText(/hyperlink: Satellite note/).waitFor();
    const canvas = graph.locator("canvas");
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector(".ecosystem-stage")
            ?.getAttribute("data-nodes"),
        ) === 6,
    );
    await graph
      .getByRole("button", { name: "Explore local network", exact: true })
      .click();
    assert.equal(
      await graph.getByLabel("Graph perspective", { exact: true }).inputValue(),
      "local",
    );
    await graph
      .getByLabel("Graph perspective", { exact: true })
      .selectOption("global");
    await graph
      .getByRole("button", { name: "Collapse clusters", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector(".ecosystem-stage")
            ?.getAttribute("data-nodes"),
        ) < 6,
    );
    await graph
      .getByRole("button", { name: "Focus selected cluster", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector(".ecosystem-stage")
            ?.getAttribute("data-nodes"),
        ) === 6,
    );
    await graph
      .getByRole("button", { name: "Expand all clusters", exact: true })
      .click();
    data.vault.saveNote({
      title: "Added while graph is open",
      body: "[[Hub research note]]",
    });
    await graph
      .getByText("Added while graph is open · note", { exact: true })
      .waitFor({ timeout: 10000 });
    await graph
      .getByRole("button", { name: "Open full record", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Global Graph", exact: true })
      .last()
      .click();
    await graph
      .getByRole("heading", { name: "Hub research note", exact: true })
      .waitFor();
    const before = f.workspace.list().length;
    await graph
      .getByRole("checkbox", { name: /Demonstration dataset/ })
      .check();
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector(".ecosystem-stage")
            ?.getAttribute("data-nodes"),
        ) === 10000,
      {},
      { timeout: 20000 },
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector(".ecosystem-toolbar")
          ?.textContent?.includes("force tick 180"),
      {},
      { timeout: 20000 },
    );
    assert.equal(await canvas.getAttribute("data-edges"), "12000");
    const started = performance.now();
    await graph
      .getByLabel("Search graph", { exact: true })
      .fill("DEMO entity 9996");
    await graph
      .getByRole("button", { name: "DEMO entity 9996 · entity", exact: true })
      .waitFor();
    const searchMs = Math.round(performance.now() - started);
    await graph.getByLabel("Search graph", { exact: true }).fill("");
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector(".ecosystem-stage")
            ?.getAttribute("data-nodes"),
        ) === 10000,
    );
    await graph
      .getByRole("button", { name: "Fit ecosystem", exact: true })
      .click();
    const drawMs = Number(await canvas.getAttribute("data-draw-ms"));
    assert(searchMs < 5000);
    assert(drawMs < 2000);
    assert.equal(f.workspace.list().length, before);
    assert.deepEqual(errors, []);
    mkdirSync("docs/screenshots", { recursive: true });
    await page.screenshot({
      path: "docs/screenshots/global-graph-demo.png",
      fullPage: true,
    });
    writeFileSync(
      "docs/global-graph-browser-benchmark.json",
      JSON.stringify(
        {
          synthetic: true,
          nodes: 10000,
          edges: 12000,
          renderer: "Canvas 2D; spatial-grid force worker",
          searchMs,
          lastDrawMs: drawMs,
          databaseWrites: 0,
          allNodesRendered: true,
          fullBrowserWorkflowPassed: true,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await browser.close();
    await f.close();
  }
});
