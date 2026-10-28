import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Store } from "../src/storage.js";
import { WorkspaceStore } from "../src/workspace-store.js";
import { createIntelligence } from "../src/intelligence.js";
mkdirSync(".test-data", { recursive: true });
const root = mkdtempSync(resolve(".test-data/network-benchmark-"));
const store = new Store(root),
  workspace = new WorkspaceStore(store),
  engine = createIntelligence(store, workspace);
const start = performance.now();
try {
  const ids: string[] = [];
  store.db.exec("BEGIN IMMEDIATE");
  for (let i = 0; i < 10000; i++)
    ids.push(
      engine.save("entity", {
        title: "Synthetic entity " + i,
        type: i % 2 ? "corporation" : "agency",
        tags: ["benchmark"],
        jurisdiction: "SYNTHETIC",
      }).id,
    );
  for (let i = 0; i < 12000; i++)
    engine.save("relationship", {
      title: "Synthetic association " + i,
      type: "documented association",
      fromRef: "entity:" + ids[i % 10000],
      toRef: "entity:" + ids[(i + 1) % 10000],
      classification: "annotation",
      explanation: "Synthetic benchmark only; not a factual claim",
    });
  store.db.exec("COMMIT");
  const seeded = performance.now();
  const table = engine.list("entity", { q: "Synthetic entity 99", limit: 50 });
  const searched = performance.now();
  const graph = engine.graph({ center: "entity:" + ids[100], hops: 2 });
  const graphed = performance.now();
  const path = engine.path("entity:" + ids[100], "entity:" + ids[105]);
  const ended = performance.now();
  console.log(
    JSON.stringify(
      {
        synthetic: true,
        entities: 10000,
        relationships: 12000,
        seedMs: Math.round(seeded - start),
        searchMs: Math.round(searched - seeded),
        localGraphMs: Math.round(graphed - searched),
        pathMs: Math.round(ended - graphed),
        searchMatches: table.total,
        displayedNodes: graph.nodes.length,
        displayedEdges: graph.edges.length,
        pathFound: path.found,
        memoryMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
  rmSync(root, { recursive: true, force: true });
}
