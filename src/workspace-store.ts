import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Store } from "./storage.js";
export type WorkspaceObject<T = any> = {
  id: string;
  kind: string;
  data: T;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
export type WorkspaceReference = {
  ref: string;
  title: string;
  kind: string;
  sourceId?: string;
  captureId?: string;
  url?: string;
  [key: string]: any;
};
export const workspaceId = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const kinds = new Set([
  "vault",
  "note",
  "attachment",
  "template",
  "bookmark",
  "base",
  "layout",
  "entity",
  "relationship",
  "investigation",
  "canvas",
  "board",
  "correction",
  "preference",
  "clip",
  "extension",
  "review-event",
]);
export class WorkspaceStore {
  root: string;
  constructor(public store: Store) {
    this.root = store.root;
    mkdirSync(join(this.root, "workspace"), { recursive: true });
    store.db
      .exec(`CREATE TABLE IF NOT EXISTS workspace_objects(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,deletedAt TEXT);
      CREATE INDEX IF NOT EXISTS workspace_kind ON workspace_objects(kind,deletedAt,updatedAt);
      CREATE TABLE IF NOT EXISTS workspace_revisions(seq INTEGER PRIMARY KEY AUTOINCREMENT,objectId TEXT NOT NULL REFERENCES workspace_objects(id),revision INTEGER NOT NULL,snapshot TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(objectId,revision));
      CREATE TABLE IF NOT EXISTS workspace_audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,targetId TEXT NOT NULL,detail TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS workspace_revisions_no_update BEFORE UPDATE ON workspace_revisions BEGIN SELECT RAISE(ABORT,'Revisions are append-only');END;
      CREATE TRIGGER IF NOT EXISTS workspace_revisions_no_delete BEFORE DELETE ON workspace_revisions BEGIN SELECT RAISE(ABORT,'Revisions are append-only');END;
      CREATE TRIGGER IF NOT EXISTS workspace_audit_no_update BEFORE UPDATE ON workspace_audit BEGIN SELECT RAISE(ABORT,'Audit is append-only');END;
      CREATE TRIGGER IF NOT EXISTS workspace_audit_no_delete BEFORE DELETE ON workspace_audit BEGIN SELECT RAISE(ABORT,'Audit is append-only');END;`);
  }
  get<T = any>(
    id: string,
    kind?: string,
    includeDeleted = false,
  ): WorkspaceObject<T> | undefined {
    if (!workspaceId(id)) return undefined;
    const row = this.store.db
      .prepare("SELECT * FROM workspace_objects WHERE id=?")
      .get(id) as any;
    if (
      !row ||
      (kind && row.kind !== kind) ||
      (!includeDeleted && row.deletedAt)
    )
      return undefined;
    return { ...row, data: JSON.parse(row.data) };
  }
  list<T = any>(
    kind?: string,
    options: { includeDeleted?: boolean } | boolean = {},
  ): WorkspaceObject<T>[] {
    const includeDeleted =
      typeof options === "boolean" ? options : options.includeDeleted;
    const rows = this.store.db
      .prepare(
        `SELECT * FROM workspace_objects WHERE (? IS NULL OR kind=?) ${includeDeleted ? "" : "AND deletedAt IS NULL"} ORDER BY updatedAt DESC,id`,
      )
      .all(kind || null, kind || null) as any[];
    return rows.map((row) => ({ ...row, data: JSON.parse(row.data) }));
  }
  put<T = any>(
    kind: string,
    data: T,
    id?: string,
    expectedRevision?: number,
  ): WorkspaceObject<T> {
    if (
      !kinds.has(kind) ||
      !data ||
      typeof data !== "object" ||
      Array.isArray(data)
    )
      throw new Error("Invalid workspace object");
    if (id !== undefined && !workspaceId(id))
      throw new Error("Invalid workspace identifier");
    const json = JSON.stringify(data);
    if (Buffer.byteLength(json) > 4 * 1024 * 1024)
      throw new Error("Workspace object exceeds 4 MiB");
    const previous = id ? this.get(id, undefined, true) : undefined;
    if (id && !previous) throw new Error("Workspace object not found");
    if (previous && previous.kind !== kind)
      throw new Error("Workspace kind cannot change");
    if (
      expectedRevision !== undefined &&
      (!Number.isInteger(expectedRevision) ||
        expectedRevision !== (previous?.revision || 0))
    )
      throw Object.assign(
        new Error(
          "Workspace changed in another view. Reload or recover your draft before saving.",
        ),
        { statusCode: 409 },
      );
    const now = new Date().toISOString();
    const row: WorkspaceObject<T> = {
      id: id || randomUUID(),
      kind,
      data,
      revision: (previous?.revision || 0) + 1,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      deletedAt: null,
    };
    this.store.db.exec("SAVEPOINT workspace_write");
    try {
      if (
        !previous &&
        Number(
          (
            this.store.db
              .prepare("SELECT COUNT(*) AS n FROM workspace_objects")
              .get() as any
          ).n,
        ) >= 100000
      )
        throw new Error("Workspace object limit reached (100000)");
      const written = this.store.db
        .prepare(
          "INSERT INTO workspace_objects VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=excluded.revision,updatedAt=excluded.updatedAt,deletedAt=NULL WHERE workspace_objects.revision=?",
        )
        .run(
          row.id,
          kind,
          json,
          row.revision,
          row.createdAt,
          now,
          null,
          previous?.revision || 0,
        );
      if (!written.changes)
        throw Object.assign(new Error("Workspace revision conflict"), {
          statusCode: 409,
        });
      this.store.db
        .prepare(
          "INSERT INTO workspace_revisions(objectId,revision,snapshot,createdAt) VALUES(?,?,?,?)",
        )
        .run(row.id, row.revision, JSON.stringify(row), now);
      this.audit("save:" + kind, row.id, { revision: row.revision });
      this.store.db.exec("RELEASE workspace_write");
      return row;
    } catch (e) {
      this.store.db.exec("ROLLBACK TO workspace_write;RELEASE workspace_write");
      throw e;
    }
  }
  remove(id: string, expectedRevision?: number) {
    const previous = this.get(id);
    if (!previous) throw new Error("Workspace object not found");
    if (
      expectedRevision !== undefined &&
      previous.revision !== expectedRevision
    )
      throw Object.assign(new Error("Workspace revision conflict"), {
        statusCode: 409,
      });
    const now = new Date().toISOString(),
      row = {
        ...previous,
        revision: previous.revision + 1,
        updatedAt: now,
        deletedAt: now,
      };
    this.store.db.exec("SAVEPOINT workspace_remove");
    try {
      const written = this.store.db
        .prepare(
          "UPDATE workspace_objects SET deletedAt=?,updatedAt=?,revision=? WHERE id=? AND revision=?",
        )
        .run(now, now, row.revision, id, previous.revision);
      if (!written.changes)
        throw Object.assign(new Error("Workspace revision conflict"), {
          statusCode: 409,
        });
      this.store.db
        .prepare(
          "INSERT INTO workspace_revisions(objectId,revision,snapshot,createdAt) VALUES(?,?,?,?)",
        )
        .run(id, row.revision, JSON.stringify(row), now);
      this.audit("delete:" + previous.kind, id, { revision: row.revision });
      this.store.db.exec("RELEASE workspace_remove");
      return row;
    } catch (e) {
      this.store.db.exec(
        "ROLLBACK TO workspace_remove;RELEASE workspace_remove",
      );
      throw e;
    }
  }
  history(id: string): WorkspaceObject[] {
    if (!workspaceId(id)) throw new Error("Invalid workspace identifier");
    return (
      this.store.db
        .prepare(
          "SELECT snapshot FROM workspace_revisions WHERE objectId=? ORDER BY revision DESC",
        )
        .all(id) as any[]
    ).map((row) => JSON.parse(row.snapshot));
  }
  restore(id: string, revision: number, expectedRevision?: number) {
    const snapshot = this.history(id).find((row) => row.revision === revision);
    if (!snapshot) throw new Error("Revision not found");
    return this.put(snapshot.kind, snapshot.data, id, expectedRevision);
  }
  audit(kind: string, targetId: string, detail: any = {}) {
    const id = randomUUID(),
      createdAt = new Date().toISOString();
    this.store.db
      .prepare(
        "INSERT INTO workspace_audit(id,kind,targetId,detail,createdAt) VALUES(?,?,?,?,?)",
      )
      .run(id, kind, targetId, JSON.stringify(detail), createdAt);
    return { id, kind, targetId, detail, createdAt };
  }
  auditEvents(limit = 200) {
    return (
      this.store.db
        .prepare("SELECT * FROM workspace_audit ORDER BY seq DESC LIMIT ?")
        .all(Math.min(10000, Math.max(1, limit))) as any[]
    ).map((row) => ({ ...row, detail: JSON.parse(row.detail) }));
  }
  resolveReference(ref: string): WorkspaceReference | undefined {
    if (typeof ref !== "string") return undefined;
    const [kind, id, ...rest] = ref.split(":");
    if (rest.length || !workspaceId(id)) return undefined;
    if (kind === "source") {
      const row = this.store.db
        .prepare("SELECT id,name,url FROM sources WHERE id=?")
        .get(id) as any;
      return row
        ? { ref, kind, title: row.name, url: row.url, sourceId: id }
        : undefined;
    }
    if (kind === "capture") {
      const r = this.store.get(id);
      return r
        ? {
            ref,
            kind,
            title: r.title || r.sourceName,
            url: r.finalUrl,
            sourceId: r.sourceId,
            captureId: id,
            observedAt: r.observedAt,
            chainHash: r.chainHash,
          }
        : undefined;
    }
    if (kind === "node") {
      if (
        !this.store.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='research_nodes'",
          )
          .get()
      )
        return undefined;
      const r = this.store.db
        .prepare("SELECT id,title,kind,tags FROM research_nodes WHERE id=?")
        .get(id) as any;
      return r
        ? {
            ref,
            title: r.title,
            kind: "research-" + r.kind,
            tags: JSON.parse(r.tags),
          }
        : undefined;
    }
    const r = this.get(id, kind);
    return r
      ? {
          ref,
          kind,
          title: r.data.title || r.data.name || kind,
          tags: r.data.tags || [],
          classification: r.data.classification,
          updatedAt: r.updatedAt,
          ...(kind === "attachment"
            ? {
                mime: r.data.mime,
                url: "/api/workspace/attachments/" + id + "/file",
              }
            : {}),
        }
      : undefined;
  }
  catalog(limit = 5000) {
    const refs: WorkspaceReference[] = [];
    const rows = this.store.db
      .prepare(
        "SELECT id,kind,json_extract(data,'$.title') AS title,json_extract(data,'$.name') AS name,json_extract(data,'$.tags') AS tags,json_extract(data,'$.classification') AS classification,updatedAt FROM workspace_objects WHERE deletedAt IS NULL ORDER BY updatedAt DESC LIMIT ?",
      )
      .all(limit) as any[];
    for (const row of rows) {
      const d = {
        title: row.title,
        name: row.name,
        tags: row.tags ? JSON.parse(row.tags) : [],
        classification: row.classification,
      };
      refs.push({
        ref: row.kind + ":" + row.id,
        kind: row.kind,
        title: d.title || d.name || row.kind,
        tags: d.tags || [],
        classification: d.classification,
        updatedAt: row.updatedAt,
      });
    }
    for (const s of this.store.sources(true))
      refs.push({
        ref: "source:" + s.id,
        kind: "source",
        title: s.name,
        sourceId: s.id,
        url: s.url,
      });
    const captures = this.store.db
      .prepare("SELECT id,metadata FROM captures ORDER BY seq DESC LIMIT 1000")
      .all() as any[];
    for (const r of captures) {
      const c = JSON.parse(r.metadata);
      refs.push({
        ref: "capture:" + c.id,
        kind: "capture",
        title: c.title || c.sourceName,
        sourceId: c.sourceId,
        captureId: c.id,
        updatedAt: c.observedAt,
      });
    }
    return {
      items: refs,
      truncated: rows.length === limit,
      captureLimit: 1000,
    };
  }
}
