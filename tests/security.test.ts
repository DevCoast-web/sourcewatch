import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { unzipSync } from "fflate";
import { Store, sha256 } from "../src/storage.js";
import { exportBundle } from "../src/export.js";
import type { Captured } from "../src/capture.js";
import { nextDue } from "../src/scheduler.js";
import type { Source } from "../src/storage.js";

const captured: Captured = {
  html: "<html><body>Preserved</body></html>",
  text: "Preserved",
  screenshot: Buffer.from("fixture screenshot"),
  title: "Evidence",
  description: "Fixture",
  finalUrl: "https://example.com/",
  status: 200,
  headers: { "content-type": "text/html" },
  links: [],
  observedAt: "2026-01-01T00:00:00.000Z",
  warnings: [],
  ignoredSelectors: [],
};
function fixture() {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "security-"));
  const store = new Store(join(root, "data"));
  const source = store.add({
    url: "https://example.com/",
    name: "Evidence",
    collection: "Research",
    description: "",
    intervalMinutes: 60,
    selectors: [],
  });
  const first = store.save(source, captured);
  const second = store.save(source, captured);
  const exported = exportBundle(store, source.id);
  const bundle = join(root, "bundle");
  mkdirSync(bundle);
  for (const [name, data] of Object.entries(unzipSync(exported.zip))) {
    const file = join(bundle, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
  return {
    root,
    store,
    source,
    first,
    second,
    bundle,
    exported,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function verify(bundle: string, expected?: string) {
  const result = spawnSync(
    process.execPath,
    [
      resolve("scripts/verify.mjs"),
      bundle,
      ...(expected ? ["--expect", expected] : []),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.error, undefined);
  return { status: result.status, result: JSON.parse(result.stdout) };
}
function alterManifest(bundle: string, change: (manifest: any) => void) {
  const path = join(bundle, "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  change(manifest);
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

test("unchanged captures remain distinct, chained, append-only, and persist after reopening SQLite", () => {
  const f = fixture();
  try {
    assert.notEqual(f.first.id, f.second.id);
    assert.deepEqual(f.first.files, f.second.files);
    assert.equal(f.second.previousHash, f.first.chainHash);
    assert.notEqual(f.first.chainHash, f.second.chainHash);
    assert.throws(
      () =>
        f.store.db
          .prepare("UPDATE captures SET metadata=? WHERE id=?")
          .run("{}", f.first.id),
      /append-only/,
    );
    assert.throws(
      () =>
        f.store.db.prepare("DELETE FROM captures WHERE id=?").run(f.first.id),
      /append-only/,
    );
    const reopened = new Store(join(f.root, "data"));
    try {
      assert.deepEqual(reopened.history(f.source.id), [f.first, f.second]);
      assert.equal(reopened.sources()[0].name, "Evidence");
      assert.equal(
        reopened.file(f.first.id, "text.txt").toString(),
        "Preserved",
      );
    } finally {
      reopened.close();
    }
    assert.equal(verify(f.bundle, f.exported.manifestSha256).result.ok, true);
  } finally {
    f.close();
  }
});

test("artifact access rejects traversal and unsupported names", () => {
  const f = fixture();
  try {
    for (const [id, name] of [
      ["../outside", "text.txt"],
      [f.first.id, "../metadata.json"],
      [f.first.id, "page.html/../../sourcewatch.sqlite"],
      [f.first.id, "sourcewatch.sqlite"],
      [f.first.id, "C:\\secret"],
    ])
      assert.throws(() => f.store.file(id, name), /Invalid artifact/);
  } finally {
    f.close();
  }
});

test("verifier rejects malicious manifest paths without reading outside the bundle", () => {
  const f = fixture();
  try {
    for (const unsafe of [
      "../outside.txt",
      "/absolute.txt",
      "C:/outside.txt",
      "captures\\outside.txt",
      "captures//outside.txt",
      "./outside.txt",
    ]) {
      alterManifest(f.bundle, (m) => {
        m.files = { ...m.files, [unsafe]: sha256("secret") };
      });
      const v = verify(f.bundle);
      assert.equal(v.status, 1);
      assert.equal(v.result.ok, false);
      assert(
        v.result.errors.some((e: string) => e.includes("Unsafe manifest path")),
      );
    }
  } finally {
    f.close();
  }
});

test("recomputed manifest does not hide a modified metadata chain", () => {
  const f = fixture();
  try {
    const name = `captures/${f.first.id}/metadata.json`;
    const path = join(f.bundle, name);
    const metadata = JSON.parse(readFileSync(path, "utf8"));
    metadata.observedAt = "2000-01-01T00:00:00.000Z";
    writeFileSync(path, JSON.stringify(metadata, null, 2));
    alterManifest(
      f.bundle,
      (m) => (m.files[name] = sha256(readFileSync(path))),
    );
    const v = verify(f.bundle);
    assert.equal(v.status, 1);
    assert(v.result.errors.some((e: string) => e.includes("CHAIN MISMATCH")));
    assert(!v.result.errors.some((e: string) => e.startsWith("MODIFIED:")));
  } finally {
    f.close();
  }
});

test("external manifest fingerprint and unexpected files are checked independently", () => {
  const f = fixture();
  try {
    const wrong = verify(f.bundle, "0".repeat(64));
    assert.equal(wrong.status, 1);
    assert(
      wrong.result.errors.some((e: string) =>
        e.includes("externally retained"),
      ),
    );
    writeFileSync(join(f.bundle, "unexpected.txt"), "extra");
    const extra = verify(f.bundle);
    assert.equal(extra.status, 1);
    assert(extra.result.errors.includes("UNEXPECTED: unexpected.txt"));
  } finally {
    f.close();
  }
});

test("verifier rejects symlinked artifacts and unexpected directory links", (t) => {
  const f = fixture();
  try {
    const path = join(f.bundle, `captures/${f.first.id}/text.txt`);
    const target = join(f.root, "outside.txt");
    writeFileSync(target, "Preserved");
    rmSync(path);
    try {
      symlinkSync(target, path, "file");
    } catch (error) {
      if (
        ["EPERM", "EACCES"].includes(
          (error as NodeJS.ErrnoException).code || "",
        )
      ) {
        t.skip(
          "Creating symlinks requires privileges on this Windows installation",
        );
        return;
      }
      throw error;
    }
    const v = verify(f.bundle);
    assert.equal(v.status, 1);
    assert(v.result.errors.some((e: string) => e.includes("Symlink rejected")));
    assert(
      v.result.errors.some((e: string) => e.includes("UNEXPECTED SYMLINK")),
    );
  } finally {
    f.close();
  }
});

test("scheduler honors intervals, paused and archived sources, and failed-attempt backoff", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");
  const source: Source = {
    id: "scheduled-source",
    url: "https://example.com/",
    name: "Scheduled",
    collection: "Research",
    description: "",
    archived: 0,
    intervalMinutes: 60,
    selectors: [],
    createdAt: "2026-01-01T11:00:00.000Z",
    lastAttempt: null,
    error: null,
    paused: 0,
  };
  assert.equal(
    nextDue([source], now),
    source,
    "Exact interval boundary is due",
  );
  assert.equal(
    nextDue([source], now - 1),
    undefined,
    "Interval must elapse completely",
  );
  assert.equal(nextDue([{ ...source, paused: 1 }], now), undefined);
  assert.equal(nextDue([{ ...source, archived: 1 }], now), undefined);
  assert.equal(
    nextDue([{ ...source, intervalMinutes: 0 }], now),
    undefined,
    "Manual-only source is not scheduled",
  );
  const failed = {
    ...source,
    lastAttempt: "2026-01-01T11:30:00.000Z",
    error: "Network timeout",
  };
  assert.equal(
    nextDue([failed], now),
    undefined,
    "Failed attempts wait a full interval before retrying",
  );
  assert.equal(nextDue([failed], now + 30 * 60000), failed);
  assert.equal(
    nextDue([{ ...source, paused: 1 }, source], now),
    source,
    "Ineligible sources do not block another due source",
  );
});
