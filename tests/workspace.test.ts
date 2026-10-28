import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { unzipSync } from "fflate";
import { Store } from "../src/storage.js";
import { WorkspaceStore } from "../src/workspace-store.js";
import {
  saveAttachment,
  readAttachment,
  exportWorkspace,
  recordWorkspaceChange,
} from "../src/workspace-routes.js";
import { formulaValue, buildPublication } from "../src/workspace-extras.js";
function fixture() {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "workspace-"));
  const store = new Store(root),
    workspace = new WorkspaceStore(store);
  return {
    root,
    store,
    workspace,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
test("workspace revisions and soft deletion are independent, conflict checked, recoverable and append-only", () => {
  const f = fixture();
  try {
    const a = f.workspace.put("note", { title: "Alpha", body: "First" });
    const b = f.workspace.put(
      "note",
      { title: "Beta", body: "Second" },
      a.id,
      a.revision,
    );
    assert.throws(
      () => f.workspace.put("note", { title: "Lost" }, a.id, a.revision),
      /changed|conflict/,
    );
    const removed = f.workspace.remove(a.id, b.revision);
    assert.equal(f.workspace.get(a.id), undefined);
    assert.equal(f.workspace.history(a.id).length, 3);
    const restored = f.workspace.restore(a.id, 1, removed.revision);
    assert.equal(restored.data.body, "First");
    assert.equal(restored.revision, 4);
    assert.throws(
      () => f.store.db.exec("UPDATE workspace_revisions SET snapshot='{}'"),
      /append-only/,
    );
    assert.throws(
      () => f.store.db.exec("DELETE FROM workspace_audit"),
      /append-only/,
    );
    const second = new Store(f.root);
    try {
      assert.equal(new WorkspaceStore(second).get(a.id)?.data.body, "First");
    } finally {
      second.close();
    }
  } finally {
    f.close();
  }
});
test("attachments reject active content, malformed types and oversized inputs; tampering is detected", () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        saveAttachment(f.workspace, {
          filename: "bad.svg",
          mime: "image/svg+xml",
          base64: Buffer.from("<svg/>").toString("base64"),
        }),
      /Unsupported/,
    );
    assert.throws(
      () =>
        saveAttachment(f.workspace, {
          filename: "../bad.png",
          mime: "image/png",
          base64: png,
        }),
      /Unsupported/,
    );
    assert.throws(
      () =>
        saveAttachment(f.workspace, {
          filename: "bad.png",
          mime: "image/png",
          base64: Buffer.from("<script>bad</script>").toString("base64"),
        }),
      /does not match/,
    );
    const a = saveAttachment(f.workspace, {
      filename: "receipt.png",
      mime: "image/png",
      base64: png,
    });
    assert.equal(
      readAttachment(f.workspace, a.id).bytes.toString("base64"),
      png,
    );
    writeFileSync(
      join(f.root, "workspace", "attachments", a.id + ".bin"),
      "modified",
    );
    assert.throws(() => readAttachment(f.workspace, a.id), /integrity/);
  } finally {
    f.close();
  }
});
test("portable workspace bundles are independently verifiable and include referenced original evidence", () => {
  const f = fixture();
  try {
    const source = f.store.add({
      url: "https://example.com/",
      name: "Fixture",
      description: "",
      collection: "Test",
      intervalMinutes: 0,
      selectors: [],
    });
    const capture = f.store.save(source, {
      html: "<p>Original</p>",
      text: "Original",
      title: "Original",
      description: "",
      finalUrl: source.url,
      status: 200,
      headers: {},
      links: [],
      observedAt: "2026-01-01T00:00:00Z",
      warnings: [],
      ignoredSelectors: [],
      screenshot: Buffer.from(png, "base64"),
    });
    f.workspace.put("note", {
      title: "Cited note",
      body: "Receipt",
      refs: ["capture:" + capture.id],
    });
    saveAttachment(f.workspace, {
      filename: "receipt.png",
      mime: "image/png",
      base64: png,
    });
    const out = exportWorkspace(f.workspace),
      zip = unzipSync(out.zip);
    assert(zip["evidence/" + source.id + ".zip"]);
    const root = join(f.root, "bundle");
    for (const [name, bytes] of Object.entries(zip)) {
      const p = join(root, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, bytes);
    }
    const run = () =>
      spawnSync(
        process.execPath,
        [
          join(root, "verify-workspace.mjs"),
          root,
          "--expect",
          out.manifestSha256,
        ],
        { encoding: "utf8" },
      );
    assert.equal(run().status, 0);
    writeFileSync(join(root, "workspace.json"), "modified");
    assert.equal(run().status, 1);
    rmSync(join(root, "workspace.json"));
    assert.match(run().stdout, /MISSING/);
    writeFileSync(join(root, "workspace.json"), zip["workspace.json"]);
    writeFileSync(join(root, "unexpected.txt"), "unlisted");
    assert.match(run().stdout, /UNEXPECTED/);
    rmSync(join(root, "unexpected.txt"));
    assert.equal(run().status, 0);
    assert(zip["revisions.json"]);
    assert.equal(f.store.get(capture.id)?.chainHash, capture.chainHash);
  } finally {
    f.close();
  }
});
test("publication exports require explicit selection, exclude private/unselected notes, and escape active HTML", () => {
  const f = fixture();
  try {
    const a = f.workspace.put("note", {
      title: "Public <script>",
      body: "<script>bad()</script>",
      properties: {},
    });
    const hidden = f.workspace.put("note", {
      title: "Secret",
      body: "Private body",
      properties: { private: true },
    });
    assert.throws(
      () => buildPublication(f.workspace, { noteIds: [] }),
      /Select/,
    );
    assert.throws(
      () => buildPublication(f.workspace, { noteIds: [hidden.id] }),
      /Private/,
    );
    const z = unzipSync(
      buildPublication(f.workspace, { noteIds: [a.id], title: "Research" }),
    );
    const html = Buffer.from(z["index.html"]).toString();
    assert(!html.includes("Private body"));
    assert(!html.includes("<script>bad()"));
    assert(html.includes("&lt;script&gt;"));
    assert.equal(JSON.parse(Buffer.from(z["notes.json"]).toString()).length, 1);
  } finally {
    f.close();
  }
});
test("property formulas use a bounded grammar and preserve missing numeric values", () => {
  assert.equal(formulaValue({ body: "Two words" }, "wordCount"), 2);
  assert.equal(formulaValue({ properties: { cost: null } }, "cost * 2"), null);
  assert.equal(formulaValue({ properties: { cost: 4 } }, "cost * 2"), 8);
  assert.equal(formulaValue({ properties: { cost: 4 } }, "cost / 0"), null);
  assert.throws(() => formulaValue({}, "process.exit()"), /Formula/);
});
test("source changes create review events without rewriting established relationships or captures", () => {
  const f = fixture();
  try {
    const source = f.store.add({
      url: "https://example.com/",
      name: "Fixture",
      description: "",
      collection: "Test",
      intervalMinutes: 0,
      selectors: [],
    });
    const input = {
      html: "<p>Original</p>",
      text: "Original",
      title: "Original",
      description: "",
      finalUrl: source.url,
      status: 200,
      headers: {},
      links: [],
      observedAt: "2026-01-01T00:00:00Z",
      warnings: [],
      ignoredSelectors: [],
      screenshot: Buffer.from(png, "base64"),
    };
    const a = f.store.save(source, input),
      r = f.workspace.put("entity", {
        title: "Referenced entity",
        citations: ["source:" + source.id],
      });
    const b = f.store.save(source, { ...input, text: "Amended" });
    recordWorkspaceChange(f.workspace, a, b);
    const events = f.workspace.list("review-event");
    assert.equal(events.length, 1);
    assert(events[0].data.affectedRefs.includes("entity:" + r.id));
    assert.equal(events[0].data.status, "pending");
    assert.equal(f.workspace.get(r.id)?.revision, 1);
    assert.equal(f.store.get(a.id)?.chainHash, a.chainHash);
  } finally {
    f.close();
  }
});

test("canvas proposals stay hypotheses until explicit review of intact evidence and keep review history", async () => {
  const { createApp } = await import("../src/server.js");
  const { createCanvas } = await import("../src/canvas.js");
  const { createIntelligence } = await import("../src/intelligence.js");
  const f = fixture();
  const { app } = await createApp({ root: f.root, testMode: true });
  try {
    const a = f.workspace.put("note", { title: "A", body: "Research" }),
      b = f.workspace.put("note", { title: "B", body: "Context" });
    const controller = createCanvas(f.store, f.workspace);
    const canvas = controller.save({
      title: "Review board",
      nodes: [
        {
          id: "a",
          type: "file",
          file: "notes/" + a.id + ".md",
          sourcewatchRef: "note:" + a.id,
          x: 0,
          y: 0,
          width: 240,
          height: 160,
        },
        {
          id: "b",
          type: "file",
          file: "notes/" + b.id + ".md",
          sourcewatchRef: "note:" + b.id,
          x: 300,
          y: 0,
          width: 240,
          height: 160,
        },
      ],
      edges: [
        {
          id: "edge",
          fromNode: "a",
          toNode: "b",
          label: "supports",
          sourcewatch: {
            classification: "hypothesis",
            creator: "Researcher",
            createdAt: new Date().toISOString(),
            explanation: "Planning",
          },
        },
      ],
    });
    const proposal = await app.inject({
      method: "POST",
      url: "/api/workspace/canvas/" + canvas.id + "/propose/edge",
      headers: { host: "127.0.0.1" },
      payload: {
        expectedRevision: canvas.revision,
        creator: "Researcher",
        explanation: "Needs evidence review",
      },
    });
    assert.equal(proposal.statusCode, 200, proposal.body);
    const id = proposal.json().relationshipRef.split(":")[1],
      engine = createIntelligence(f.store, f.workspace);
    assert.equal(f.workspace.get(id)?.data.classification, "hypothesis");
    assert.throws(
      () =>
        engine.review(id, {
          reviewer: "Reviewer",
          explanation: "Checked",
          status: "verified",
        }),
      /preserved capture/,
    );
    const attachment = saveAttachment(f.workspace, {
      filename: "evidence.png",
      mime: "image/png",
      base64: png,
    });
    const reviewed = engine.review(id, {
      reviewer: "Reviewer",
      explanation: "Checked preserved image bytes",
      status: "verified",
      evidenceRefs: ["attachment:" + attachment.id],
    });
    assert.equal(reviewed.data.classification, "verified");
    assert.equal(reviewed.data.reviews.length, 1);
    writeFileSync(
      join(f.root, "workspace", "attachments", attachment.id + ".bin"),
      "altered",
    );
    assert.throws(
      () =>
        engine.review(id, {
          reviewer: "Reviewer",
          explanation: "Tampered evidence",
          status: "verified",
          evidenceRefs: ["attachment:" + attachment.id],
        }),
      /integrity/,
    );
    assert(f.workspace.get(a.id));
    assert.equal(
      f.workspace.get(canvas.id)?.data.edges[0].sourcewatch.relationshipRef,
      "relationship:" + id,
    );
  } finally {
    await app.close();
    f.close();
  }
});
