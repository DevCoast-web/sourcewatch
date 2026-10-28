import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { Store } from "../src/storage.js";
import { createKnowledge } from "../src/knowledge.js";

function fixture() {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "knowledge-"));
  const store = new Store(root);
  const source = store.add({
    url: "https://example.com/",
    name: "Reference source",
    collection: "Test",
    description: "",
    intervalMinutes: 0,
    selectors: [],
  });
  const capture = store.save(source, {
    html: "<p>Preserved</p>",
    text: "Preserved",
    title: "Reference capture",
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
  const knowledge = createKnowledge(store);
  return {
    root,
    store,
    source,
    capture,
    knowledge,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("research nodes, source/capture connections, backlinks and independent context persist without changing evidence", () => {
  const f = fixture();
  try {
    const emptyGraph = f.knowledge.list();
    assert.equal(
      emptyGraph.references.some((ref) => ref.kind === "capture"),
      false,
      "Unlinked captures do not clutter the graph",
    );
    assert.equal(
      emptyGraph.captureChoices[0].captureId,
      f.capture.id,
      "Existing unlinked captures are available for a first evidence attachment",
    );
    assert.equal(emptyGraph.capturesTruncated, false);
    const metadata = f.store.file(f.capture.id, "metadata.json");
    const original = f.store.get(f.capture.id);
    const first = f.knowledge.saveNode({
      title: "  Accountability  ",
      kind: "topic",
      body: "Researcher interpretation",
      tags: ["policy", "policy", " reviewed "],
    });
    assert.equal(first.title, "Accountability");
    assert.deepEqual(first.tags, ["policy", "reviewed"]);
    const second = f.knowledge.saveNode(undefined, {
      title: "An organization",
      kind: "organization",
    });
    const third = f.knowledge.saveNode({ title: "A person", kind: "person" });
    const updated = f.knowledge.saveNode(first.id, {
      title: "Commitment",
      kind: "claim",
      body: "Unverified working claim",
      tags: [],
    });
    assert.equal(updated.id, first.id);
    assert.equal(updated.createdAt, first.createdAt);
    assert.equal(updated.kind, "claim");
    const edge = f.knowledge.addEdge({
      fromId: `node:${first.id}`,
      toId: `source:${f.source.id}`,
      label: " discusses ",
      note: "Context only",
      evidenceCaptureId: f.capture.id,
    });
    assert.equal(edge.label, "discusses");
    const captureEdge = f.knowledge.addEdge({
      fromId: `source:${f.source.id}`,
      toId: `capture:${f.capture.id}`,
      label: "preserved as",
    });
    const nodeEdge = f.knowledge.addEdge({
      fromId: `node:${second.id}`,
      toId: `node:${third.id}`,
      label: "research association",
    });
    f.store.archive(f.source.id, true);
    const graph = f.knowledge.list();
    assert.equal(graph.nodes.length, 3);
    assert.equal(
      graph.references.find((ref) => ref.id === `source:${f.source.id}`)
        ?.archived,
      true,
    );
    assert.equal(
      graph.references.find((ref) => ref.id === `capture:${f.capture.id}`)
        ?.captureId,
      f.capture.id,
    );
    assert.deepEqual(graph.backlinks[`source:${f.source.id}`], [edge.id]);
    assert.deepEqual(graph.backlinks[`capture:${f.capture.id}`], [
      captureEdge.id,
    ]);
    assert.deepEqual(graph.backlinks[`node:${third.id}`], [nodeEdge.id]);
    const exported = f.knowledge.export();
    assert.equal(exported.format, "sourcewatch-research-context");
    assert(
      !Object.hasOwn(exported, "captureChoices"),
      "Export excludes unrelated capture picker choices",
    );
    assert.match(exported.notice, /Editable researcher context/);
    assert.match(
      exported.notice,
      /does not certify authenticity or timestamps/,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(exported)).edges, graph.edges);
    const reopened = new Store(f.root);
    try {
      assert.deepEqual(createKnowledge(reopened).list(), graph);
    } finally {
      reopened.close();
    }
    f.knowledge.deleteNode(second.id);
    assert.equal(
      f.knowledge.list().edges.some((item) => item.id === nodeEdge.id),
      false,
    );
    f.knowledge.deleteEdge(edge.id);
    assert.equal(f.knowledge.list().edges.length, 1);
    assert.throws(() => f.knowledge.deleteEdge(edge.id), /not found/);
    assert.throws(() => f.knowledge.deleteNode(second.id), /not found/);
    assert.deepEqual(f.store.get(f.capture.id), original);
    assert.deepEqual(f.store.file(f.capture.id, "metadata.json"), metadata);
    assert.equal(f.store.history(f.source.id).length, 1);
  } finally {
    f.close();
  }
});

test("research input validation rejects malformed, oversized, inherited and unexpected fields", () => {
  const f = fixture();
  try {
    for (const input of [
      null,
      [],
      "text",
      { title: "", kind: "topic" },
      { title: "x".repeat(121), kind: "topic" },
      { title: "x", kind: "secret" },
      { title: "x", kind: "topic", body: "x".repeat(10001) },
      { title: "x", kind: "topic", body: null },
      { title: "x", kind: "topic", tags: null },
      { title: "x", kind: "topic", tags: Array(21).fill("a") },
      { title: "x", kind: "topic", tags: ["x".repeat(41)] },
      { title: "x", kind: "topic", tags: [5] },
      { title: "x", kind: "topic", id: randomUUID() },
      Object.create({ title: "x", kind: "topic" }),
      {
        get title() {
          throw new Error("Getter executed");
        },
        kind: "topic",
      },
    ]) {
      assert.throws(() => f.knowledge.saveNode(input as never), /Invalid/);
    }
    assert.throws(
      () =>
        f.knowledge.saveNode(randomUUID(), { title: "missing", kind: "topic" }),
      /not found/,
    );
    assert.throws(() => f.knowledge.deleteNode("../bad"), /Invalid/);
    const node = f.knowledge.saveNode({ title: "Valid", kind: "topic" });
    const base = {
      fromId: `node:${node.id}`,
      toId: `source:${f.source.id}`,
      label: "relates",
    };
    for (const input of [
      null,
      { ...base, extra: true },
      { ...base, label: " " },
      { ...base, label: "x".repeat(81) },
      { ...base, note: "x".repeat(2001) },
      { ...base, note: null },
      { ...base, evidenceCaptureId: 5 },
      { ...base, fromId: node.id },
      { ...base, toId: "capture:../../etc" },
      { ...base, toId: `source:${randomUUID()}` },
      { ...base, toId: `node:${randomUUID()}` },
      { ...base, toId: `capture:${randomUUID()}` },
      { ...base, evidenceCaptureId: randomUUID() },
    ]) {
      assert.throws(
        () => f.knowledge.addEdge(input as never),
        /Invalid|not found/,
      );
    }
    assert.throws(
      () => f.knowledge.addEdge({ ...base, toId: base.fromId }),
      /Self links/,
    );
    f.knowledge.addEdge(base);
    assert.throws(
      () => f.knowledge.addEdge({ ...base, label: " relates " }),
      /Duplicate/,
    );
    // Direction and independently labeled interpretations are distinct.
    f.knowledge.addEdge({ ...base, fromId: base.toId, toId: base.fromId });
    f.knowledge.addEdge({ ...base, label: "questions" });
    assert.equal(f.knowledge.list().edges.length, 3);
    assert.throws(() => f.knowledge.deleteEdge("invalid"), /Invalid/);
    assert.throws(() => f.knowledge.deleteEdge(randomUUID()), /not found/);
  } finally {
    f.close();
  }
});

test("node capacity is enforced, editable at capacity, and freed by deletion", () => {
  const f = fixture();
  try {
    const first = f.knowledge.saveNode({ title: "First", kind: "topic" });
    const insert = f.store.db.prepare(
      "INSERT INTO research_nodes VALUES(?,?,'topic','','[]',?,?)",
    );
    const now = new Date().toISOString();
    f.store.db.exec("BEGIN");
    for (let i = 1; i < 1000; i++)
      insert.run(randomUUID(), `Node ${i}`, now, now);
    f.store.db.exec("COMMIT");
    assert.throws(
      () => f.knowledge.saveNode({ title: "Overflow", kind: "topic" }),
      /limit reached/,
    );
    assert.equal(
      f.knowledge.saveNode({ title: "Edited", kind: "topic" }, first.id).title,
      "Edited",
    );
    f.knowledge.deleteNode(first.id);
    f.knowledge.saveNode({ title: "Replacement", kind: "topic" });
    assert.equal(f.knowledge.list().nodes.length, 1000);
  } finally {
    f.close();
  }
});

test("edge capacity is enforced and node deletion removes incoming and outgoing links", () => {
  const f = fixture();
  try {
    const node = f.knowledge.saveNode({ title: "Topic", kind: "topic" });
    const fromId = `node:${node.id}`;
    const toId = `source:${f.source.id}`;
    const insert = f.store.db.prepare(
      "INSERT INTO research_edges VALUES(?,?,?,?,?,NULL,?)",
    );
    const now = new Date().toISOString();
    f.store.db.exec("BEGIN");
    for (let i = 0; i < 5000; i++)
      insert.run(randomUUID(), fromId, toId, `link ${i}`, "", now);
    f.store.db.exec("COMMIT");
    assert.throws(
      () => f.knowledge.addEdge({ fromId, toId, label: "Overflow" }),
      /limit reached/,
    );
    const edge = f.knowledge.list().edges[0];
    f.knowledge.deleteEdge(edge.id);
    f.knowledge.addEdge({ fromId: toId, toId: fromId, label: "Incoming" });
    assert.equal(f.knowledge.list().edges.length, 5000);
    f.knowledge.deleteNode(node.id);
    assert.equal(f.knowledge.list().edges.length, 0);
    assert.equal(f.store.history(f.source.id).length, 1);
  } finally {
    f.close();
  }
});
