import type { FastifyInstance } from "fastify";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  lstatSync,
  renameSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkspaceStore, workspaceId } from "./workspace-store.js";
import { sha256, type Store, type RecordData } from "./storage.js";
import { zipSync } from "fflate";
import { exportBundle } from "./export.js";
const supported = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/wav",
  "video/mp4",
  "video/webm",
]);
function attachmentDirectory(workspace: WorkspaceStore) {
  const parent = join(workspace.root, "workspace");
  const directory = join(parent, "attachments");
  for (const path of [parent, directory]) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink())
      throw new Error("Attachment directory symlinks are not permitted");
  }
  return directory;
}
export function saveAttachment(workspace: WorkspaceStore, input: any) {
  if (input && typeof input === "object")
    input = {
      ...input,
      mime: String(input.mime || "")
        .split(";")[0]
        .toLowerCase(),
    };
  if (
    !input ||
    typeof input.filename !== "string" ||
    input.filename.length > 180 ||
    /[\\/]/.test(input.filename) ||
    [...input.filename].some((c: string) => c.charCodeAt(0) < 32) ||
    !supported.has(input.mime) ||
    typeof input.base64 !== "string" ||
    input.base64.length > 11184812 ||
    input.base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)
  )
    throw new Error("Unsupported attachment or malformed content");
  const bytes = Buffer.from(input.base64, "base64");
  if (!bytes.length || bytes.length > 8 * 1024 * 1024)
    throw new Error("Attachment must contain 1 byte to 8 MiB");
  const magic = bytes.subarray(0, 16),
    text = magic.toString("latin1");
  if (
    (input.mime === "application/pdf" && !text.startsWith("%PDF-")) ||
    (input.mime === "image/png" &&
      magic.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") ||
    (input.mime === "image/jpeg" &&
      magic.subarray(0, 3).toString("hex") !== "ffd8ff") ||
    (input.mime === "image/gif" && !/^GIF8[79]a/.test(text)) ||
    (input.mime === "image/webp" &&
      !(text.startsWith("RIFF") && text.slice(8, 12) === "WEBP"))
  )
    throw new Error("Attachment content does not match its type");
  const directory = attachmentDirectory(workspace);
  mkdirSync(directory, { recursive: true });
  const total = (
    workspace.store.db
      .prepare(
        "SELECT COALESCE(SUM(json_extract(data,'$.size')),0) AS n FROM workspace_objects WHERE kind='attachment'",
      )
      .get() as any
  ).n;
  if (Number(total) + bytes.length > 512 * 1024 * 1024)
    throw new Error("Workspace attachment budget reached (512 MiB)");
  const staged = join(directory, "." + randomUUID() + ".tmp");
  let published: string | undefined;
  workspace.store.db.exec("SAVEPOINT attachment_save");
  try {
    writeFileSync(staged, bytes, { flag: "wx" });
    const record = workspace.put("attachment", {
      title: input.filename,
      filename: input.filename,
      mime: input.mime,
      size: bytes.length,
      sha256: sha256(bytes),
    });
    published = join(directory, record.id + ".bin");
    renameSync(staged, published);
    workspace.store.db.exec("RELEASE attachment_save");
    return record;
  } catch (error) {
    workspace.store.db.exec(
      "ROLLBACK TO attachment_save;RELEASE attachment_save",
    );
    if (existsSync(staged)) unlinkSync(staged);
    if (published && existsSync(published)) unlinkSync(published);
    throw error;
  }
}
export function readAttachment(
  workspace: WorkspaceStore,
  id: string,
  includeDeleted = false,
) {
  const record = workspace.get(id, "attachment", includeDeleted);
  if (!record || !workspaceId(id)) throw new Error("Attachment not found");
  const path = join(attachmentDirectory(workspace), id + ".bin");
  if (lstatSync(path).isSymbolicLink())
    throw new Error("Attachment symlinks are not permitted");
  const bytes = readFileSync(path);
  if (sha256(bytes) !== record.data.sha256)
    throw new Error("Attachment integrity check failed");
  return { record, bytes };
}
export function exportWorkspace(workspace: WorkspaceStore) {
  const historyBytes = Number(
    (
      workspace.store.db
        .prepare(
          "SELECT COALESCE(SUM(length(CAST(snapshot AS BLOB))),0) AS n FROM workspace_revisions",
        )
        .get() as any
    ).n,
  );
  const objectBytes = Number(
    (
      workspace.store.db
        .prepare(
          "SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) AS n FROM workspace_objects",
        )
        .get() as any
    ).n,
  );
  if (historyBytes + objectBytes > 100 * 1024 * 1024)
    throw new Error(
      "Workspace history exceeds the portable export budget; back up the stopped service data directory instead",
    );
  const objects = workspace.list(undefined, { includeDeleted: true });
  const files: Record<string, Uint8Array> = {};
  files["workspace.json"] = Buffer.from(
    JSON.stringify(
      {
        format: "sourcewatch-workspace-v1",
        notice:
          "Mutable researcher context. Reviewed status records local researcher review, not independent truth certification.",
        objects,
        audit: workspace.auditEvents(10000),
      },
      null,
      2,
    ),
  );
  for (const item of objects) {
    if (item.kind === "note" && !item.deletedAt)
      files["notes/" + item.id + ".md"] = Buffer.from(
        "---\nsourcewatch_id: " +
          item.id +
          "\ntitle: " +
          JSON.stringify(item.data.title) +
          "\n---\n" +
          item.data.body,
      );
    if (item.kind === "canvas" && !item.deletedAt)
      files["canvases/" + item.id + ".canvas"] = Buffer.from(
        JSON.stringify(item.data, null, 2),
      );
    if (item.kind === "attachment") {
      const { bytes } = readAttachment(workspace, item.id, true);
      files["attachments/" + item.id + ".bin"] = bytes;
    }
  }
  files["revisions.json"] = Buffer.from(
    JSON.stringify(
      (
        workspace.store.db
          .prepare("SELECT snapshot FROM workspace_revisions ORDER BY seq")
          .all() as any[]
      ).map((row) => JSON.parse(row.snapshot)),
    ),
  );
  let size = Object.values(files).reduce((n, b) => n + b.length, 0);
  if (size > 128 * 1024 * 1024)
    throw new Error("Workspace bundle exceeds 128 MiB");
  const sourceIds = new Set<string>();
  const addRef = (ref: string) => {
    const r = workspace.resolveReference(ref);
    if (r?.sourceId) sourceIds.add(r.sourceId);
  };
  for (const object of objects) {
    const serialized = JSON.stringify(object.data);
    for (const match of serialized.matchAll(
      /(?:source|capture):[0-9a-f-]{36}/g,
    ))
      addRef(match[0]);
  }
  for (const sourceId of sourceIds) {
    if (!workspace.store.history(sourceId).length) continue;
    const bundle = exportBundle(workspace.store, sourceId);
    size += bundle.zip.length;
    if (size > 128 * 1024 * 1024)
      throw new Error("Workspace bundle with evidence exceeds 128 MiB");
    files["evidence/" + sourceId + ".zip"] = bundle.zip;
    files["evidence/" + sourceId + ".manifest-sha256.txt"] = Buffer.from(
      bundle.manifestSha256,
    );
  }
  files["verify-workspace.mjs"] = readFileSync(
    new URL("../scripts/verify-workspace.mjs", import.meta.url),
  );
  files["README.txt"] = Buffer.from(
    "SourceWatch workspace bundle. Extract then run: node verify-workspace.mjs .\nEvidence ZIPs carry their own standalone verifiers. Researcher notes, layouts and annotations are mutable local context; verification checks integrity, not truth, publication time or third-party certification. Local backups do not establish cross-device synchronization. Review personal information before sharing.\n",
  );
  const manifest = {
    format: "sourcewatch-workspace-v1",
    exportedAt: new Date().toISOString(),
    files: Object.fromEntries(
      Object.entries(files).map(([n, b]) => [n, sha256(b)]),
    ),
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
  files["manifest.json"] = manifestBytes;
  return {
    zip: Buffer.from(zipSync(files, { level: 6 })),
    manifestSha256: sha256(manifestBytes),
  };
}
export function recordWorkspaceChange(
  workspace: WorkspaceStore,
  previous: RecordData | undefined,
  current: RecordData,
) {
  if (
    !previous ||
    (previous.files["text.txt"] === current.files["text.txt"] &&
      previous.title === current.title &&
      JSON.stringify(previous.links) === JSON.stringify(current.links))
  )
    return;
  const refs = ["source:" + current.sourceId, "capture:" + previous.id];
  const affected = workspace
    .list()
    .filter(
      (o) =>
        !["review-event", "preference"].includes(o.kind) &&
        refs.some((ref) => JSON.stringify(o.data).includes(ref)),
    )
    .map((o) => o.kind + ":" + o.id);
  if (affected.length)
    workspace.put("review-event", {
      title: "Source changed: " + current.sourceName,
      sourceRef: refs[0],
      beforeRef: "capture:" + previous.id,
      afterRef: "capture:" + current.id,
      affectedRefs: affected,
      status: "pending",
      notice: "Review required. No established relationship has been changed.",
    });
}
export function registerWorkspaceRoutes(
  app: FastifyInstance,
  store: Store,
  workspace: WorkspaceStore,
) {
  app.get("/api/workspace/catalog", async () => workspace.catalog());
  app.get<{ Querystring: { ref: string } }>(
    "/api/workspace/resolve",
    async (req) => {
      const r = workspace.resolveReference(req.query.ref);
      if (!r)
        throw Object.assign(new Error("Reference not found"), {
          statusCode: 404,
        });
      const id = req.query.ref.split(":")[1];
      const item = workspace.get(id);
      return {
        ...r,
        ...(item ? { data: item.data, revision: item.revision } : {}),
      };
    },
  );
  app.get("/api/workspace/audit", async () => workspace.auditEvents());
  app.get("/api/workspace/events", async () => workspace.list("review-event"));
  app.put<{ Params: { id: string } }>(
    "/api/workspace/events/:id",
    async (req) => {
      const r = workspace.get(req.params.id, "review-event");
      if (!r) throw new Error("Review event not found");
      const b = req.body as any;
      if (
        !["reviewed", "dismissed"].includes(b?.status) ||
        typeof b.explanation !== "string" ||
        !b.explanation.trim()
      )
        throw new Error("Review status and explanation required");
      return workspace.put(
        "review-event",
        {
          ...r.data,
          status: b.status,
          reviewer: "local-researcher",
          explanation: b.explanation,
          reviewedAt: new Date().toISOString(),
        },
        r.id,
        r.revision,
      );
    },
  );
  app.post(
    "/api/workspace/attachments",
    { bodyLimit: 12 * 1024 * 1024 },
    async (req) => saveAttachment(workspace, req.body),
  );
  app.get<{ Params: { id: string } }>(
    "/api/workspace/attachments/:id/file",
    async (req, reply) => {
      const { record, bytes } = readAttachment(workspace, req.params.id);
      return reply
        .type(record.data.mime)
        .header(
          "Content-Disposition",
          `inline; filename="${record.data.filename.replace(/["\r\n]/g, "_")}"`,
        )
        .send(bytes);
    },
  );
  app.get("/api/workspace/export", async (_req, reply) => {
    const bundle = exportWorkspace(workspace);
    return reply
      .type("application/zip")
      .header(
        "Content-Disposition",
        'attachment; filename="sourcewatch-workspace.zip"',
      )
      .header("X-Manifest-SHA256", bundle.manifestSha256)
      .send(bundle.zip);
  });
  app.get<{ Querystring: { q?: string } }>(
    "/api/workspace/search",
    async (req) => {
      const q = String(req.query.q || "")
        .trim()
        .toLowerCase()
        .slice(0, 200);
      if (!q) return [];
      const rows = workspace.store.db
        .prepare(
          "SELECT id,kind,substr(COALESCE(json_extract(data,'$.body'),json_extract(data,'$.explanation'),json_extract(data,'$.title'),''),1,180) AS snippet FROM workspace_objects WHERE deletedAt IS NULL AND instr(lower(data),?) > 0 ORDER BY updatedAt DESC LIMIT 100",
        )
        .all(q) as any[];
      return rows.map((o) => ({
        ...workspace.resolveReference(o.kind + ":" + o.id),
        snippet: o.snippet,
      }));
    },
  );
  app.get("/api/workspace/layouts", async () => workspace.list("layout"));
  app.post("/api/workspace/layouts", async (req) => {
    const b = req.body as any;
    if (
      typeof b?.title !== "string" ||
      !b.title.trim() ||
      b.title.length > 120 ||
      ![
        "overview",
        "monitor",
        "graph",
        "vault",
        "canvas",
        "intelligence",
        "bases",
        "tools",
      ].includes(b.view)
    )
      throw new Error("Invalid workspace layout");
    return workspace.put("layout", {
      title: b.title,
      view: b.view,
      ref: typeof b.ref === "string" ? b.ref : "",
    });
  });
  void store;
}
