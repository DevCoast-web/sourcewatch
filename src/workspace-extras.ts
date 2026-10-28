import type { FastifyInstance } from "fastify";
import { WorkspaceStore } from "./workspace-store.js";
import { parsePublicUrl } from "./network.js";
import { createVault } from "./vault.js";
import { zipSync } from "fflate";
import { sha256 } from "./storage.js";
export function formulaValue(data: any, formula: string): unknown {
  if (!formula) return "";
  if (formula === "wordCount")
    return String(data.body || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  if (formula === "characterCount") return String(data.body || "").length;
  const m = /^([A-Za-z][\w.-]{0,79})\s*([+*/-])\s*(-?\d+(?:\.\d+)?)$/.exec(
    formula,
  );
  if (!m)
    throw new Error(
      "Formula supports wordCount, characterCount or property + - * / number",
    );
  const value = data.properties?.[m[1]];
  if (value === null || value === undefined || value === "") return null;
  const a = Number(value),
    b = Number(m[3]);
  if (!Number.isFinite(a)) return null;
  const result =
    m[2] === "+"
      ? a + b
      : m[2] === "-"
        ? a - b
        : m[2] === "*"
          ? a * b
          : b === 0
            ? null
            : a / b;
  return result !== null && Number.isFinite(result) ? result : null;
}
export function baseRows(workspace: WorkspaceStore, input: any) {
  const q = String(input?.query || "")
      .toLowerCase()
      .slice(0, 200),
    kind = ["note", "entity"].includes(input?.kind) ? input.kind : "note";
  const rows = workspace
    .list(kind)
    .filter((o) => JSON.stringify(o.data).toLowerCase().includes(q))
    .map((o) => ({
      ...o,
      computed: formulaValue(o.data, String(input?.formula || "")),
    }));
  const sort = String(input?.sort || "title");
  rows.sort((a, b) =>
    String(a.data[sort] ?? a.data.properties?.[sort] ?? "").localeCompare(
      String(b.data[sort] ?? b.data.properties?.[sort] ?? ""),
      undefined,
      { numeric: true },
    ),
  );
  return rows.slice(0, 1000);
}
const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function buildPublication(workspace: WorkspaceStore, input: any) {
  if (
    !input ||
    !Array.isArray(input.noteIds) ||
    !input.noteIds.length ||
    input.noteIds.length > 100
  )
    throw new Error("Select 1–100 publishable notes explicitly");
  const notes = [...new Set<string>(input.noteIds)].map((id) => {
    const r = workspace.get(id, "note");
    if (!r) throw new Error("Note not found");
    if (r.data.properties?.private === true)
      throw new Error(
        "Private notes cannot be included in a publication export",
      );
    return r;
  });
  const title = String(input.title || "Research collection").slice(0, 120),
    files: Record<string, Uint8Array> = {};
  const list = notes
    .map((n) => `<li><a href="#note-${n.id}">${escape(n.data.title)}</a></li>`)
    .join("");
  const pages = notes
    .map(
      (n) =>
        `<article id="note-${n.id}" data-title="${escape(n.data.title.toLowerCase())}"><h2>${escape(n.data.title)}</h2><pre>${escape(n.data.body)}</pre><small>SourceWatch researcher note; not independent certification. Revision ${n.revision}.</small></article>`,
    )
    .join("");
  files["index.html"] = Buffer.from(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; connect-src 'none'"><title>${escape(title)}</title><link rel="stylesheet" href="site.css"><header><h1>${escape(title)}</h1><p>Explicitly selected researcher notes. Evidence references should be checked against preserved records.</p><label>Search this collection <input id="q" type="search"></label><button id="theme">Toggle theme</button></header><nav><ul>${list}</ul></nav><main>${pages}</main><script src="site.js"></script></html>`,
  );
  files["site.css"] = Buffer.from(
    "body{max-width:1000px;margin:30px auto;padding:20px;font:16px system-ui;background:#fafbf7;color:#193f30}body.dark{background:#17251e;color:#e1eee5}a{color:inherit}article{padding:30px 0;border-top:1px solid #8ca397}pre{white-space:pre-wrap;font:inherit;line-height:1.7}input,button{padding:10px;margin:8px}",
  );
  files["site.js"] = Buffer.from(
    'document.getElementById("q").addEventListener("input",e=>document.querySelectorAll("article").forEach(a=>a.hidden=!a.textContent.toLowerCase().includes(e.target.value.toLowerCase())));document.getElementById("theme").onclick=()=>document.body.classList.toggle("dark");',
  );
  files["notes.json"] = Buffer.from(JSON.stringify(notes, null, 2));
  files["README.txt"] = Buffer.from(
    "Static publication export, not a live hosted service. Serve these files using a static HTTP server. No account, remote upload, custom domain, authentication or access control is provisioned. Publication files contain only explicitly selected notes. Generated exports cannot be remotely revoked by SourceWatch. Review contents before hosting.\n",
  );
  const manifest = Buffer.from(
    JSON.stringify(
      {
        format: "sourcewatch-static-publication-v1",
        files: Object.fromEntries(
          Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)]),
        ),
      },
      null,
      2,
    ),
  );
  files["manifest.json"] = manifest;
  workspace.audit("publication-export", "local-export", {
    noteIds: notes.map((n) => n.id),
    manifestSha256: sha256(manifest),
  });
  return Buffer.from(zipSync(files));
}
export function registerWorkspaceExtraRoutes(
  app: FastifyInstance,
  workspace: WorkspaceStore,
) {
  app.get("/api/workspace/bases", async () => workspace.list("base"));
  app.post("/api/workspace/bases", async (req: any) => {
    const b = req.body;
    if (
      typeof b?.title !== "string" ||
      !b.title.trim() ||
      b.title.length > 120 ||
      !["table", "list", "cards", "kanban", "map"].includes(b.view)
    )
      throw new Error("Invalid base view");
    baseRows(workspace, b);
    return workspace.put("base", {
      title: b.title,
      view: b.view,
      kind: b.kind || "note",
      query: String(b.query || "").slice(0, 200),
      sort: String(b.sort || "title").slice(0, 80),
      groupBy: String(b.groupBy || "status").slice(0, 80),
      formula: String(b.formula || "").slice(0, 120),
    });
  });
  app.post("/api/workspace/bases/query", async (req: any) =>
    baseRows(workspace, req.body),
  );
  app.post(
    "/api/workspace/publish-export",
    { bodyLimit: 1024 * 1024 },
    async (req, reply) =>
      reply
        .type("application/zip")
        .header(
          "Content-Disposition",
          'attachment; filename="sourcewatch-publication.zip"',
        )
        .send(buildPublication(workspace, req.body)),
  );
  app.get("/api/workspace/extensions", async () => workspace.list("extension"));
  app.post("/api/workspace/extensions", async (req: any) => {
    const b = req.body;
    if (
      b?.apiVersion !== 1 ||
      typeof b.id !== "string" ||
      !/^[a-z0-9-]{1,60}$/.test(b.id) ||
      typeof b.name !== "string" ||
      b.name.length > 100 ||
      !Array.isArray(b.permissions) ||
      b.permissions.length ||
      !Array.isArray(b.commands) ||
      b.commands.length > 30 ||
      b.commands.some(
        (c: any) =>
          typeof c.title !== "string" ||
          c.title.length > 100 ||
          !["vault", "canvas", "intelligence", "bases", "tools"].includes(
            c.action,
          ),
      )
    )
      throw new Error(
        "Only API v1 declarative navigation extensions with no permissions are supported",
      );
    return workspace.put("extension", { ...b, enabled: true });
  });
  app.put<{ Params: { id: string } }>(
    "/api/workspace/extensions/:id",
    async (req, reply) => {
      const r = workspace.get(req.params.id, "extension"),
        b = req.body as any;
      if (!r || typeof b?.enabled !== "boolean")
        throw new Error("Invalid extension");
      return reply.send(
        workspace.put(
          "extension",
          { ...r.data, enabled: b.enabled },
          r.id,
          r.revision,
        ),
      );
    },
  );
  app.post(
    "/api/workspace/clip",
    { bodyLimit: 2 * 1024 * 1024 },
    async (req: any) => {
      const b = req.body;
      parsePublicUrl(b?.url);
      if (
        typeof b.title !== "string" ||
        b.title.length > 120 ||
        typeof b.text !== "string" ||
        b.text.length > 500000
      )
        throw new Error("Invalid clip");
      const vault = createVault(workspace);
      const note = vault.saveNote({
        title: b.title || new URL(b.url).hostname,
        body: `Source: ${b.url}\n\nClipped text (not an archived observation):\n\n${b.text}`,
        tags: ["clipping"],
        properties: { originalUrl: b.url, clippedAt: new Date().toISOString() },
        refs: [],
      });
      workspace.audit("clip", note.id, { url: b.url });
      return note;
    },
  );
}
