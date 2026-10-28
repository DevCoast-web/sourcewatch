import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Captured } from "./capture.js";
export const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export type Source = {
  id: string;
  url: string;
  name: string;
  collection: string;
  description: string;
  archived: number;
  intervalMinutes: number;
  selectors: string[];
  createdAt: string;
  lastAttempt: string | null;
  error: string | null;
  paused: number;
};
export type RecordData = {
  version: 1;
  id: string;
  sourceId: string;
  sourceUrl: string;
  sourceName: string;
  sourceDescription: string;
  collection: string;
  observedAt: string;
  finalUrl: string;
  title: string;
  description: string;
  status: number;
  headers: Record<string, string>;
  links: string[];
  warnings: string[];
  ignoredSelectors: string[];
  files: Record<string, string>;
  previousHash: string | null;
  chainHash: string;
};
export class Store {
  db: DatabaseSync;
  constructor(public root: string) {
    mkdirSync(root, { recursive: true });
    mkdirSync(join(root, "captures"), { recursive: true });
    this.db = new DatabaseSync(join(root, "sourcewatch.sqlite"));
    this.db.exec(
      `PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON;CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,url TEXT NOT NULL,name TEXT NOT NULL,collection TEXT NOT NULL,intervalMinutes INTEGER NOT NULL,selectors TEXT NOT NULL,createdAt TEXT NOT NULL,lastAttempt TEXT,error TEXT,paused INTEGER NOT NULL DEFAULT 0);CREATE TABLE IF NOT EXISTS captures(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,sourceId TEXT NOT NULL REFERENCES sources(id),metadata TEXT NOT NULL);CREATE TRIGGER IF NOT EXISTS captures_no_update BEFORE UPDATE ON captures BEGIN SELECT RAISE(ABORT,'Capture history is append-only');END;CREATE TRIGGER IF NOT EXISTS captures_no_delete BEFORE DELETE ON captures BEGIN SELECT RAISE(ABORT,'Capture history is append-only');END;`,
    );
    const columns = (
      this.db.prepare("PRAGMA table_info(sources)").all() as any[]
    ).map((c) => c.name);
    if (!columns.includes("description"))
      this.db.exec(
        "ALTER TABLE sources ADD COLUMN description TEXT NOT NULL DEFAULT ''",
      );
    if (!columns.includes("archived"))
      this.db.exec(
        "ALTER TABLE sources ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
      );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
  }
  sources(includeArchived = false): Source[] {
    return (
      this.db
        .prepare("SELECT * FROM sources ORDER BY createdAt DESC")
        .all() as any[]
    )
      .map((r) => ({ ...r, selectors: JSON.parse(r.selectors) }))
      .filter((s) => includeArchived || !s.archived);
  }
  source(id: string) {
    return this.sources(true).find((s) => s.id === id);
  }
  add(
    input: Omit<
      Source,
      "id" | "createdAt" | "lastAttempt" | "error" | "paused" | "archived"
    >,
  ) {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO sources(id,url,name,collection,intervalMinutes,selectors,createdAt,description) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        input.url,
        input.name,
        input.collection,
        input.intervalMinutes,
        JSON.stringify(input.selectors),
        new Date().toISOString(),
        input.description,
      );
    return this.source(id)!;
  }
  update(
    id: string,
    b: {
      name: string;
      description: string;
      collection: string;
      intervalMinutes: number;
      selectors: string[];
    },
  ) {
    this.db
      .prepare(
        "UPDATE sources SET name=?,description=?,collection=?,intervalMinutes=?,selectors=? WHERE id=?",
      )
      .run(
        b.name,
        b.description,
        b.collection,
        b.intervalMinutes,
        JSON.stringify(b.selectors),
        id,
      );
  }
  archive(id: string, archived: boolean) {
    this.db
      .prepare("UPDATE sources SET archived=?,paused=? WHERE id=?")
      .run(archived ? 1 : 0, archived ? 1 : 0, id);
  }
  settings() {
    const r = this.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get("settleMs") as any;
    const height = this.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get("maxScreenshotHeight") as any;
    return {
      settleMs: r ? Number(r.value) : 1200,
      maxScreenshotHeight: height ? Number(height.value) : 100000,
    };
  }
  setSettings(settleMs: number, maxScreenshotHeight?: number) {
    if (maxScreenshotHeight !== undefined)
      this.db
        .prepare(
          "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run("maxScreenshotHeight", String(maxScreenshotHeight));
    this.db
      .prepare(
        "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run("settleMs", String(settleMs));
  }
  history(id: string): RecordData[] {
    return (
      this.db
        .prepare("SELECT metadata FROM captures WHERE sourceId=? ORDER BY seq")
        .all(id) as any[]
    ).map((r) => JSON.parse(r.metadata));
  }
  get(id: string): RecordData | undefined {
    const r = this.db
      .prepare("SELECT metadata FROM captures WHERE id=?")
      .get(id) as any;
    return r ? JSON.parse(r.metadata) : undefined;
  }
  file(id: string, name: string): Buffer {
    if (
      !/^[0-9a-f-]{36}$/.test(id) ||
      !["page.html", "text.txt", "screenshot.png", "metadata.json"].includes(
        name,
      )
    )
      throw new Error("Invalid artifact");
    return readFileSync(join(this.root, "captures", id, name));
  }
  attempt(id: string, error: string | null) {
    this.db
      .prepare("UPDATE sources SET lastAttempt=?,error=? WHERE id=?")
      .run(new Date().toISOString(), error, id);
  }
  pause(id: string, paused: boolean) {
    this.db
      .prepare("UPDATE sources SET paused=? WHERE id=?")
      .run(paused ? 1 : 0, id);
  }
  save(source: Source, c: Captured): RecordData {
    const id = randomUUID();
    this.db.exec("BEGIN IMMEDIATE");
    let staging: string | undefined;
    let published = false;
    try {
      const history = this.history(source.id);
      const files: Record<string, Buffer> = {
        "page.html": Buffer.from(c.html),
        "text.txt": Buffer.from(c.text),
        "screenshot.png": c.screenshot,
      };
      const base = {
        version: 1 as const,
        id,
        sourceId: source.id,
        sourceUrl: source.url,
        sourceName: source.name,
        sourceDescription: source.description,
        collection: source.collection,
        observedAt: c.observedAt,
        finalUrl: c.finalUrl,
        title: c.title,
        description: c.description,
        status: c.status,
        headers: c.headers,
        links: c.links,
        warnings: c.warnings,
        ignoredSelectors: c.ignoredSelectors,
        files: Object.fromEntries(
          Object.entries(files).map(([n, b]) => [n, sha256(b)]),
        ),
        previousHash: history.at(-1)?.chainHash || null,
      };
      const record = { ...base, chainHash: sha256(JSON.stringify(base)) };
      staging = join(this.root, "captures", `.${id}.tmp`);
      mkdirSync(staging);
      for (const [name, buffer] of Object.entries(files))
        writeFileSync(join(staging, name), buffer, { flag: "wx" });
      writeFileSync(
        join(staging, "metadata.json"),
        JSON.stringify(record, null, 2),
        { flag: "wx" },
      );
      renameSync(staging, join(this.root, "captures", id));
      published = true;
      this.db
        .prepare("INSERT INTO captures(id,sourceId,metadata) VALUES(?,?,?)")
        .run(id, source.id, JSON.stringify(record));
      this.db.exec("COMMIT");
      return record;
    } catch (e) {
      this.db.exec("ROLLBACK");
      if (staging) rmSync(staging, { recursive: true, force: true });
      if (published && !this.get(id))
        rmSync(join(this.root, "captures", id), {
          recursive: true,
          force: true,
        });
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
