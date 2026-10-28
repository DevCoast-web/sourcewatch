import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Store } from "../src/storage.js";
import { WorkspaceStore } from "../src/workspace-store.js";
import { indexEcosystem } from "../src/ecosystem.js";
import { prepareForce, forceStep } from "../ui/ecosystem-force.js";
mkdirSync(".test-data", { recursive: true });
const root = mkdtempSync(join(resolve(".test-data"), "global-benchmark-"));
const store = new Store(root);
const workspace = new WorkspaceStore(store);
const ids: string[] = [];
try {
  const start = performance.now();
  store.db.exec("BEGIN");
  for (let i = 0; i < 10000; i++)
    ids.push(
      workspace.put("note", {
        title: "Synthetic indexed note " + i,
        body: "",
        tags: ["benchmark"],
        aliases: [],
        properties: {},
        refs: [],
        vaultId: "benchmark",
      }).id,
    );
  for (let i = 0; i < 10000; i++)
    workspace.put(
      "note",
      {
        title: "Synthetic indexed note " + i,
        body:
          "[[note:" +
          ids[(i + 1) % 10000] +
          "]]" +
          (i < 2000 ? " [[note:" + ids[(i + 17) % 10000] + "]]" : ""),
        tags: ["benchmark"],
        aliases: [],
        properties: {},
        refs: [],
        vaultId: "benchmark",
      },
      ids[i],
      1,
    );
  store.db.exec("COMMIT");
  const seeded = performance.now();
  const graph = indexEcosystem(store.db);
  const indexed = performance.now();
  const force = prepareForce(graph.nodes, graph.edges);
  const prepared = performance.now();
  for (let i = 0; i < 20; i++)
    forceStep(force.points, force.links, force.centers);
  const simulated = performance.now();
  const report = {
    synthetic: true,
    storedNodes: 10000,
    storedLinks: 12000,
    indexedNodes: graph.nodes.length,
    indexedLinks: graph.edges.length,
    clusters: graph.stats.clusters,
    seedMs: Math.round(seeded - start),
    indexMs: Math.round(indexed - seeded),
    forcePreparationMs: Math.round(prepared - indexed),
    twentyForceStepsMs: Math.round(simulated - prepared),
    rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    productionWrites: 0,
  };
  if (graph.nodes.length !== 10000 || graph.edges.length !== 12000)
    throw Error("Incomplete benchmark index");
  writeFileSync(
    "docs/global-graph-index-benchmark.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  store.close();
  rmSync(root, { recursive: true, force: true });
}
