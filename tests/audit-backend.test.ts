import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readdirSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { unzipSync } from "fflate";
import { createApp } from "../src/server.js";
import { Store, sha256 } from "../src/storage.js";
import type { Captured } from "../src/capture.js";
const headers = { host: "127.0.0.1" };
const captured: Captured = {
  html: "<p>Audit receipt</p>",
  text: "Audit receipt",
  title: "Audit",
  description: "",
  finalUrl: "https://example.com/",
  status: 200,
  headers: {},
  links: [],
  observedAt: "2026-01-01T00:00:00Z",
  screenshot: Buffer.from("screenshot"),
  warnings: [],
  ignoredSelectors: [],
};
function folder() {
  mkdirSync(resolve(".test-data"), { recursive: true });
  return mkdtempSync(join(resolve(".test-data"), "audit-backend-"));
}
const input = {
  url: "https://example.com/",
  name: "Audit",
  description: "",
  collection: "Audit",
  intervalMinutes: 0,
  selectors: [],
};

test("rejected source PATCH requests are atomic", async () => {
  const root = folder();
  const { app, store } = await createApp({ root, testMode: true });
  try {
    for (const payload of [
      { paused: true, name: "" },
      { archived: true, selectors: [5] },
      { paused: true, archived: "invalid" },
    ]) {
      const source = store.add(input);
      const result = await app.inject({
        method: "PATCH",
        url: `/api/sources/${source.id}`,
        headers,
        payload,
      });
      assert.equal(result.statusCode, 400);
      assert.deepEqual(
        store.source(source.id),
        source,
        "Rejected PATCH must not mutate source state",
      );
    }
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("settings reject malformed input without changing persisted values; SQL-looking notes remain plain data", async () => {
  const root = folder();
  const { app, store } = await createApp({ root, testMode: true });
  try {
    const before = store.settings();
    for (const payload of [
      { settleMs: -1 },
      { settleMs: 5001 },
      { settleMs: "1" },
      { settleMs: 1.5 },
      { settleMs: 0, maxScreenshotHeight: 999 },
      { settleMs: 0, maxScreenshotHeight: 200001 },
      { settleMs: 0, maxScreenshotHeight: "50000" },
      [],
    ]) {
      const result = await app.inject({
        method: "PATCH",
        url: "/api/settings",
        headers,
        payload,
      });
      assert.equal(result.statusCode, 400, JSON.stringify(payload));
      assert.deepEqual(store.settings(), before);
    }
    const source = store.add(input),
      record = store.save(source, captured);
    const note = "'); DROP TABLE captures; -- <script>alert(1)</script>";
    const saved = await app.inject({
      method: "PUT",
      url: `/api/captures/${record.id}/annotation`,
      headers,
      payload: { note, tags: ["policy"] },
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().note, note);
    assert.equal(store.history(source.id).length, 1);
    assert.equal(
      (
        await app.inject({
          url: "/api/sources",
          headers: { host: "evil.example" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/settings",
          headers: { ...headers, origin: "https://evil.example" },
          payload: { settleMs: 0 },
        })
      ).statusCode,
      403,
    );
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("selected exports include exactly the required chain prefix and its annotations", async () => {
  const root = folder();
  const { app, store, research } = await createApp({
    root: join(root, "data"),
    testMode: true,
  });
  try {
    const source = store.add(input);
    const records = [1, 2, 3].map((n) =>
      store.save(source, { ...captured, text: `Revision ${n}` }),
    );
    for (const r of records)
      research.saveAnnotation(r.id, { note: `Note ${r.id}`, tags: [] });
    const response = await app.inject({
      url: `/api/sources/${source.id}/export?ids=${records[1].id}`,
      headers,
    });
    assert.equal(response.statusCode, 200);
    const files = unzipSync(response.rawPayload);
    const manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
    assert.deepEqual(
      manifest.captures,
      records.slice(0, 2).map((r) => r.id),
    );
    const notes = JSON.parse(
      Buffer.from(files["research-notes.json"]).toString(),
    );
    assert.deepEqual(
      notes.annotations.map((n: { captureId: string }) => n.captureId),
      records.slice(0, 2).map((r) => r.id),
    );
    assert(!Object.keys(files).some((k) => k.includes(records[2].id)));
    const bundle = join(root, "bundle");
    mkdirSync(bundle);
    for (const [name, bytes] of Object.entries(files)) {
      const path = join(bundle, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    }
    const verification = spawnSync(
      process.execPath,
      [
        join(bundle, "verify.mjs"),
        bundle,
        "--expect",
        String(response.headers["x-manifest-sha256"]),
      ],
      { encoding: "utf8" },
    );
    assert.equal(
      verification.status,
      0,
      verification.stdout + verification.stderr,
    );
    const other = store.add({ ...input, name: "Other source" });
    const foreign = store.save(other, captured);
    assert.equal(
      (
        await app.inject({
          url: `/api/sources/${source.id}/export?ids=${foreign.id}`,
          headers,
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy schema migration preserves capture bytes and hash chain while adding research and settings", () => {
  const root = folder();
  try {
    const sourceId = randomUUID(),
      id = randomUUID();
    const files = {
      "page.html": Buffer.from(captured.html),
      "text.txt": Buffer.from(captured.text),
      "screenshot.png": captured.screenshot,
    };
    const base = {
      version: 1,
      id,
      sourceId,
      sourceUrl: input.url,
      observedAt: captured.observedAt,
      finalUrl: captured.finalUrl,
      title: captured.title,
      description: "",
      status: 200,
      headers: {},
      links: [],
      warnings: [],
      ignoredSelectors: [],
      files: Object.fromEntries(
        Object.entries(files).map(([k, b]) => [k, sha256(b)]),
      ),
      previousHash: null,
    };
    const legacy = { ...base, chainHash: sha256(JSON.stringify(base)) };
    const db = new DatabaseSync(join(root, "sourcewatch.sqlite"));
    db.exec(
      "CREATE TABLE sources(id TEXT PRIMARY KEY,url TEXT NOT NULL,name TEXT NOT NULL,collection TEXT NOT NULL,intervalMinutes INTEGER NOT NULL,selectors TEXT NOT NULL,createdAt TEXT NOT NULL,lastAttempt TEXT,error TEXT,paused INTEGER NOT NULL DEFAULT 0);CREATE TABLE captures(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,sourceId TEXT NOT NULL REFERENCES sources(id),metadata TEXT NOT NULL)",
    );
    db.prepare(
      "INSERT INTO sources(id,url,name,collection,intervalMinutes,selectors,createdAt) VALUES(?,?,?,?,?,?,?)",
    ).run(sourceId, input.url, "Legacy", "Audit", 0, "[]", captured.observedAt);
    db.prepare("INSERT INTO captures(id,sourceId,metadata) VALUES(?,?,?)").run(
      id,
      sourceId,
      JSON.stringify(legacy),
    );
    db.close();
    const path = join(root, "captures", id);
    mkdirSync(path, { recursive: true });
    for (const [name, bytes] of Object.entries(files))
      writeFileSync(join(path, name), bytes);
    const bytes = Buffer.from(JSON.stringify(legacy, null, 2));
    writeFileSync(join(path, "metadata.json"), bytes);
    const store = new Store(root);
    try {
      assert.deepEqual(store.get(id), legacy);
      assert.deepEqual(store.file(id, "metadata.json"), bytes);
      assert.equal(store.source(sourceId)?.description, "");
      assert.equal(store.source(sourceId)?.archived, 0);
      assert.equal(
        store.save(store.source(sourceId)!, captured).previousHash,
        legacy.chainHash,
      );
      assert.throws(
        () => store.db.prepare("DELETE FROM captures WHERE id=?").run(id),
        /append-only/,
      );
    } finally {
      store.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shutdown waits for active scheduled capture before closing the database", async () => {
  const root = folder();
  const fixtureUrl = "http://127.0.0.1:12345/";
  let reached!: () => void;
  const entered = new Promise<void>((r) => (reached = r));
  const { app, store, runScheduled } = await createApp({
    root,
    testMode: true,
    captureOptions: {
      fixtureUrl,
      settleMs: 0,
      fetcher: async () => {
        reached();
        await new Promise((r) => setTimeout(r, 150));
        return {
          status: 200,
          headers: { "content-type": "text/html" },
          body: Buffer.from("<html><body>Shutdown receipt</body></html>"),
        };
      },
    },
  });
  try {
    const source = store.add({ ...input, url: fixtureUrl, intervalMinutes: 5 });
    store.db
      .prepare("UPDATE sources SET createdAt=? WHERE id=?")
      .run("2000-01-01T00:00:00Z", source.id);
    await app.ready();
    const scheduled = runScheduled();
    let entryTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        entered,
        new Promise<never>((_, reject) => {
          entryTimer = setTimeout(
            () =>
              reject(
                new Error(
                  "Fixture transport was not reached within 10 seconds",
                ),
              ),
            10000,
          );
        }),
      ]);
    } finally {
      if (entryTimer) clearTimeout(entryTimer);
    }
    await app.close();
    await scheduled;
    const reopened = new Store(root);
    try {
      assert.equal(
        reopened.history(source.id).length,
        1,
        "Active scheduled capture must finish before database is closed",
      );
      assert.equal(reopened.source(source.id)?.error, null);
    } finally {
      reopened.close();
    }
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed capture database commits leave no orphaned artifact directories", () => {
  const root = folder();
  const store = new Store(root);
  try {
    const source = store.add(input);
    store.db.exec(
      "CREATE TRIGGER audit_reject_capture BEFORE INSERT ON captures BEGIN SELECT RAISE(ABORT,'audit simulated commit failure');END",
    );
    assert.throws(
      () => store.save(source, captured),
      /audit simulated commit failure/,
    );
    assert.equal(store.history(source.id).length, 0);
    assert.deepEqual(
      readdirSync(join(root, "captures")),
      [],
      "Failed save must clean staging and final directories",
    );
    store.db.exec("DROP TRIGGER audit_reject_capture");
    assert(store.save(source, captured));
    assert.equal(store.history(source.id).length, 1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("offline verifier rejects directory junctions even when referenced artifacts are unchanged", async (t) => {
  const root = folder();
  const { app, store } = await createApp({
    root: join(root, "data"),
    testMode: true,
  });
  let junction: string | undefined;
  try {
    const source = store.add(input);
    store.save(source, captured);
    const response = await app.inject({
      url: `/api/sources/${source.id}/export`,
      headers,
    });
    assert.equal(response.statusCode, 200);
    const files = unzipSync(response.rawPayload);
    const bundle = join(root, "bundle");
    mkdirSync(bundle);
    for (const [name, bytes] of Object.entries(files)) {
      const path = join(bundle, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    }
    const captures = join(bundle, "captures");
    const outside = join(root, "external-captures");
    renameSync(captures, outside);
    try {
      symlinkSync(
        outside,
        captures,
        process.platform === "win32" ? "junction" : "dir",
      );
      junction = captures;
    } catch (error) {
      if (
        ["EPERM", "EACCES"].includes(
          (error as NodeJS.ErrnoException).code || "",
        )
      ) {
        t.skip("Directory links are not permitted by this environment");
        return;
      }
      throw error;
    }
    const result = spawnSync(
      process.execPath,
      [join(bundle, "verify.mjs"), bundle],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /Symlink rejected/);
    assert.match(result.stdout, /UNEXPECTED SYMLINK: captures/);
  } finally {
    if (junction) unlinkSync(junction);
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
