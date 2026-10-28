import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import Fastify from "fastify";
import { Store } from "../src/storage.js";
import { WorkspaceStore } from "../src/workspace-store.js";
import {
  createCanvas,
  validateCanvas,
  type CanvasData,
} from "../src/canvas.js";
import { registerCanvasRoutes } from "../src/canvas-routes.js";
const document = (): CanvasData => ({
  title: "Research board",
  nodes: [
    {
      id: "a",
      type: "text",
      x: -20,
      y: 0,
      width: 300,
      height: 200,
      text: "# Hypothesis",
      vendor: { custom: true },
    },
    {
      id: "b",
      type: "group",
      x: 400,
      y: 0,
      width: 500,
      height: 300,
      label: "Region",
      color: "4",
    },
  ],
  edges: [
    {
      id: "line",
      fromNode: "a",
      toNode: "b",
      fromEnd: "arrow",
      toEnd: "arrow",
      label: "relates to",
      custom: { untouched: [1, 2] },
    },
  ],
  viewport: { x: 20, y: 30, zoom: 0.8 },
  foreign: { data: "preserved" },
});
function fixture() {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "canvas-"));
  const store = new Store(root),
    workspace = new WorkspaceStore(store);
  return {
    root,
    store,
    workspace,
    canvas: createCanvas(store, workspace),
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("JSON Canvas roundtrip preserves foreign metadata, geometry and researcher relationship classifications", () => {
  const f = fixture();
  try {
    const input = document();
    const created = f.canvas.save(input);
    assert.deepEqual(created.data.foreign, input.foreign);
    assert.deepEqual(created.data.nodes[0].vendor, input.nodes[0].vendor);
    assert.deepEqual(created.data.edges[0].custom, input.edges[0].custom);
    assert.equal(
      created.data.edges[0].sourcewatch?.classification,
      "annotation",
    );
    assert(created.data.edges[0].sourcewatch?.createdAt);
    const exported = f.canvas.export(created.id);
    const next = f.canvas.save(
      { ...exported, title: "Edited" },
      created.id,
      created.revision,
    );
    assert.equal(next.revision, 2);
    assert.deepEqual(
      next.data.edges[0].sourcewatch,
      exported.edges[0].sourcewatch,
    );
    const reopened = new Store(f.root);
    try {
      assert.deepEqual(
        createCanvas(reopened, new WorkspaceStore(reopened)).get(created.id),
        f.canvas.get(created.id),
      );
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});
test("canvas updates enforce revisions, preserve recoverable history, and never delete embedded notes", () => {
  const f = fixture();
  try {
    const note = f.workspace.put("note", {
      title: "Durable note",
      body: "Evidence interpretation",
    });
    const data = document();
    data.nodes.push({
      id: "note",
      type: "file",
      x: 0,
      y: 300,
      width: 300,
      height: 200,
      file: `notes/${note.id}.md`,
      sourcewatchRef: "note:" + note.id,
    });
    const saved = f.canvas.save(data);
    const changed = f.canvas.save(
      { ...saved.data, nodes: [], edges: [] },
      saved.id,
      saved.revision,
    );
    assert(f.workspace.get(note.id));
    assert.throws(
      () => f.canvas.save(data, saved.id, saved.revision),
      /another view/,
    );
    assert.throws(() => f.canvas.save(data, saved.id), /expectedRevision/);
    assert.throws(() => f.canvas.remove(saved.id, saved.revision), /conflict/);
    f.canvas.remove(saved.id, changed.revision);
    assert.equal(f.canvas.list().length, 0);
    assert.equal(f.workspace.history(saved.id).length, 3);
    const restored = f.workspace.restore(saved.id, 1, 3);
    assert.equal(restored.data.nodes.length, 3);
    assert(f.workspace.get(note.id));
    assert.throws(
      () =>
        f.store.db
          .prepare("DELETE FROM workspace_revisions WHERE objectId=?")
          .run(saved.id),
      /append-only/,
    );
  } finally {
    f.close();
  }
});
test("canvas validation rejects active content, host file access, invalid geometry and factual promotion", () => {
  for (const node of [
    { type: "link", url: "javascript:alert(1)" },
    { type: "link", url: "data:text/html,bad" },
    { type: "link", url: "https://user:pass@example.com/" },
    { type: "file", file: "C:/secrets.txt" },
    { type: "file", file: "../secrets.txt" },
    { type: "file", file: "/etc/passwd" },
    { type: "file", file: "attachments\\..\\secret" },
    { text: "<script>alert(1)</script>" },
    { text: "<img onerror=alert(1)>" },
    { width: Infinity },
    { height: 0 },
  ]) {
    const data = document();
    Object.assign(data.nodes[0], node);
    assert.throws(() => validateCanvas(data), JSON.stringify(node));
  }
  const factual = document();
  factual.edges[0].sourcewatch = {
    classification: "verified" as never,
    creator: "x",
    createdAt: new Date().toISOString(),
    explanation: "",
  };
  assert.throws(() => validateCanvas(factual), /never verified/);
  const duplicate = document();
  duplicate.nodes.push({ ...duplicate.nodes[0] });
  assert.throws(() => validateCanvas(duplicate), /duplicate/);
  const missing = document();
  missing.edges[0].toNode = "not-here";
  assert.throws(() => validateCanvas(missing), /endpoints/);
  assert.throws(
    () => validateCanvas(JSON.parse('{"nodes":[],"edges":[],"__proto__":{}}')),
    /Unsafe/,
  );
});
test("foreign relative file cards remain portable but unresolved, and payload resource limits apply", () => {
  const data = document();
  data.nodes.push({
    id: "foreign",
    type: "file",
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    file: "Research/ordinary-note.md",
    subpath: "#Section",
  });
  const result = validateCanvas(data);
  assert.equal(result.data.nodes[2].file, "Research/ordinary-note.md");
  assert.match(result.warnings.join(" "), /without filesystem access/);
  const huge = document();
  huge.foreign = Array(6).fill("x".repeat(800000));
  assert.throws(() => validateCanvas(huge), /4 MiB/);
  const excessive = document();
  excessive.nodes = Array.from({ length: 2001 }, (_, i) => ({
    ...excessive.nodes[0],
    id: "card" + i,
  }));
  assert.throws(() => validateCanvas(excessive), /2000 nodes/);
});
test("canvas route CRUD imports and exports independently while rejecting stale revisions", async () => {
  const f = fixture(),
    app = Fastify();
  app.setErrorHandler((error: any, _request, reply) =>
    reply.code(error.statusCode || 400).send({ error: error.message }),
  );
  registerCanvasRoutes(app, f.store, f.workspace);
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/canvases/import",
      payload: { data: document() },
    });
    assert.equal(created.statusCode, 201, created.body);
    const row = created.json();
    const exported = await app.inject({
      url: `/api/canvases/${row.id}/export`,
    });
    assert.match(String(exported.headers["content-disposition"]), /\.canvas/);
    assert.deepEqual(exported.json().foreign, { data: "preserved" });
    const updated = await app.inject({
      method: "PUT",
      url: `/api/canvases/${row.id}`,
      payload: { data: { ...row.data, title: "Updated" }, expectedRevision: 1 },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `/api/canvases/${row.id}`,
          payload: { data: row.data, expectedRevision: 1 },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/canvases/${row.id}`,
          payload: { expectedRevision: 2 },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: `/api/canvases/${row.id}` })).statusCode,
      404,
    );
  } finally {
    await app.close();
    f.close();
  }
});

test("JSON Canvas optional arrays and one-pixel geometry remain interoperable", () => {
  assert.deepEqual(validateCanvas({}).data.nodes, []);
  assert.deepEqual(validateCanvas({}).data.edges, []);
  const input = document();
  input.nodes[0].width = 1;
  assert.equal(validateCanvas(input).data.nodes[0].width, 1);
  input.nodes[0].x = 0.5;
  assert.throws(() => validateCanvas(input), /integer pixels/);
});
