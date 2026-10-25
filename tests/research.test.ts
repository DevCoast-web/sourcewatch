import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { Store } from "../src/storage.js";
import { createResearch } from "../src/research.js";
import type { Captured } from "../src/capture.js";
const base: Captured = {
  html: "<p>Original</p>",
  text: "Original",
  title: "Original",
  description: "",
  finalUrl: "https://example.com/",
  status: 200,
  headers: {},
  links: [],
  observedAt: new Date().toISOString(),
  screenshot: Buffer.from("png"),
  warnings: [],
  ignoredSelectors: [],
};
function fixture() {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "research-"));
  const store = new Store(root);
  const source = store.add({
    url: base.finalUrl,
    name: "Research",
    collection: "",
    description: "",
    intervalMinutes: 0,
    selectors: [],
  });
  return {
    root,
    store,
    source,
    research: createResearch(store),
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("events track material changes, skip initial and unchanged captures, deduplicate and preserve read state", () => {
  const f = fixture();
  try {
    const first = f.store.save(f.source, base);
    f.research.recordSuccess(undefined, first);
    const same = f.store.save(f.source, base);
    f.research.recordSuccess(first, same);
    assert.equal(f.research.unreadCount(), 0);
    const changed = f.store.save(f.source, {
      ...base,
      text: "Revised",
      title: "Revised",
      links: ["https://example.org/"],
    });
    f.research.recordSuccess(same, changed);
    f.research.recordSuccess(same, changed);
    assert.equal(f.research.unreadCount(), 1);
    const event = f.research.listEvents()[0];
    assert.equal(event.captureId, changed.id);
    assert.equal(event.beforeId, same.id);
    assert.match(event.summary, /Title changed/);
    assert.match(event.summary, /Links: \+1/);
    f.research.markRead(event.id);
    assert.equal(f.research.unreadCount(), 0);
    assert.equal(f.research.listEvents(true).length, 0);
    assert(f.research.listEvents()[0].readAt);
    assert.throws(() => f.research.markRead("missing"), /not found/);
    assert.throws(
      () => f.research.recordSuccess(first, changed),
      /consecutive/,
    );
  } finally {
    f.close();
  }
});
test("annotations remain editable and persist independently from immutable capture evidence", () => {
  const f = fixture();
  try {
    const capture = f.store.save(f.source, base);
    const metadata = f.store.file(capture.id, "metadata.json");
    assert.deepEqual(f.research.annotation(capture.id), {
      captureId: capture.id,
      note: "",
      tags: [],
      updatedAt: null,
    });
    f.research.saveAnnotation(capture.id, {
      note: "Working note",
      tags: ["policy", "policy", "  research  "],
    });
    const saved = f.research.saveAnnotation(capture.id, {
      note: "Updated note",
      tags: ["reviewed"],
    });
    assert(saved.updatedAt);
    assert.deepEqual(f.store.get(capture.id), capture);
    assert.deepEqual(f.store.file(capture.id, "metadata.json"), metadata);
    const reopened = new Store(f.root);
    try {
      assert.deepEqual(createResearch(reopened).annotation(capture.id), saved);
    } finally {
      reopened.close();
    }
    for (const input of [
      { note: "x".repeat(10001), tags: [] },
      { note: "", tags: Array(21).fill("tag") },
      { note: "", tags: ["x".repeat(41)] },
      { note: 2, tags: [] },
      { note: "", tags: [5] },
    ])
      assert.throws(
        () => f.research.saveAnnotation(capture.id, input as never),
        /Invalid annotation/,
      );
    assert.throws(() => f.research.annotation("missing"), /not found/);
    assert.throws(
      () => f.research.saveAnnotation("missing", { note: "", tags: [] }),
      /not found/,
    );
    assert.throws(
      () =>
        f.store.db
          .prepare("INSERT INTO research_annotations VALUES(?,?,?,?)")
          .run("missing", "", "[]", "now"),
      /FOREIGN KEY/,
    );
  } finally {
    f.close();
  }
});
test("failures are local events with bounded messages and source foreign keys", () => {
  const f = fixture();
  try {
    const id = f.research.recordFailure(f.source.id, "x".repeat(1200));
    const event = f.research.listEvents()[0];
    assert.equal(event.id, id);
    assert.equal(event.kind, "failure");
    assert.equal(event.captureId, null);
    assert.equal(event.summary.length, 1000);
    assert.equal(f.research.unreadCount(), 1);
    assert.throws(
      () => f.research.recordFailure("missing", "error"),
      /Source not found/,
    );
    assert.throws(
      () =>
        f.store.db
          .prepare(
            "INSERT INTO research_events(id,sourceId,kind,summary,createdAt) VALUES('bad','missing','failure','','now')",
          )
          .run(),
      /FOREIGN KEY/,
    );
    const reopened = new Store(f.root);
    try {
      assert.equal(createResearch(reopened).unreadCount(), 1);
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});
