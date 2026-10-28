import type { FastifyInstance } from "fastify";
import type { Store } from "./storage.js";
import { WorkspaceStore } from "./workspace-store.js";
import { createVault } from "./vault.js";
export function registerVaultRoutes(
  app: FastifyInstance,
  _store: Store,
  workspace: WorkspaceStore,
) {
  const vault = createVault(workspace);
  const input = (req: any) => req.body || {};
  app.get("/api/vault/state", () => vault.state());
  app.get("/api/vault/notes", (req: any) =>
    vault.listNotes(req.query.q || "", {
      vaultId: req.query.vaultId,
      includeDeleted: req.query.deleted === "true",
    }),
  );
  app.post("/api/vault/notes", { bodyLimit: 4 * 1024 * 1024 }, (req: any) =>
    vault.saveNote(
      input(req).data || input(req),
      undefined,
      input(req).expectedRevision,
    ),
  );
  app.get("/api/vault/notes/:id", (req: any) => vault.detail(req.params.id));
  app.put("/api/vault/notes/:id", { bodyLimit: 4 * 1024 * 1024 }, (req: any) =>
    vault.saveNote(
      input(req).data || input(req),
      req.params.id,
      input(req).expectedRevision,
    ),
  );
  app.delete("/api/vault/notes/:id", (req: any) =>
    vault.removeNote(req.params.id, input(req).expectedRevision),
  );
  app.get("/api/vault/notes/:id/history", (req: any) =>
    vault.history(req.params.id),
  );
  app.post("/api/vault/notes/:id/restore", (req: any) =>
    vault.restoreNote(
      req.params.id,
      Number(input(req).revision),
      input(req).expectedRevision,
    ),
  );
  app.post("/api/vault/vaults", (req: any) =>
    vault.saveVault(input(req).data || input(req)),
  );
  app.put("/api/vault/vaults/:id", (req: any) =>
    vault.saveVault(
      input(req).data || input(req),
      req.params.id,
      input(req).expectedRevision,
    ),
  );
  app.post("/api/vault/templates", { bodyLimit: 4 * 1024 * 1024 }, (req: any) =>
    vault.saveTemplate(input(req).data || input(req)),
  );
  app.put(
    "/api/vault/templates/:id",
    { bodyLimit: 4 * 1024 * 1024 },
    (req: any) =>
      vault.saveTemplate(
        input(req).data || input(req),
        req.params.id,
        input(req).expectedRevision,
      ),
  );
  app.post("/api/vault/daily", (req: any) => vault.daily(input(req)));
  app.post("/api/vault/bookmarks", (req: any) =>
    vault.saveBookmark(input(req).data || input(req)),
  );
  app.delete("/api/vault/bookmarks/:id", (req: any) => {
    if (!workspace.get(req.params.id, "bookmark"))
      throw new Error("Bookmark not found");
    return workspace.remove(req.params.id, input(req).expectedRevision);
  });
  app.post("/api/vault/import", { bodyLimit: 6 * 1024 * 1024 }, (req: any) =>
    vault.importFiles(input(req)),
  );
  app.get("/api/vault/export", (req: any, reply) =>
    reply
      .type("application/zip")
      .header(
        "Content-Disposition",
        'attachment; filename="sourcewatch-vault.zip"',
      )
      .send(Buffer.from(vault.exportZip(req.query.vaultId))),
  );
  app.post("/api/vault/notes/:id/extract", (req: any) =>
    vault.extractNote(req.params.id, input(req)),
  );
  app.post("/api/vault/notes/:id/merge", (req: any) =>
    vault.mergeNote(req.params.id, input(req)),
  );
  app.post("/api/vault/unique", (req: any) => vault.uniqueNote(input(req)));
  return vault;
}
