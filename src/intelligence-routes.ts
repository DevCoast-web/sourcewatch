import type { FastifyInstance } from "fastify";
import { Store } from "./storage.js";
import { WorkspaceStore } from "./workspace-store.js";
import { createIntelligence } from "./intelligence.js";
export function registerIntelligenceRoutes(
  app: FastifyInstance,
  store: Store,
  workspace: WorkspaceStore,
) {
  const engine = createIntelligence(store, workspace);
  app.get("/api/intelligence/records/:kind", async (req: any) =>
    engine.list(req.params.kind, req.query),
  );
  app.post("/api/intelligence/records/:kind", async (req: any) =>
    engine.save(req.params.kind, req.body),
  );
  app.get("/api/intelligence/records/:kind/:id", async (req: any) => {
    engine.list(req.params.kind, { limit: 1 });
    const row = workspace.get(req.params.id, req.params.kind);
    if (!row)
      throw Object.assign(new Error("Record not found"), { statusCode: 404 });
    return row;
  });
  app.put("/api/intelligence/records/:kind/:id", async (req: any) =>
    engine.save(
      req.params.kind,
      req.body.data,
      req.params.id,
      req.body.revision,
    ),
  );
  app.delete("/api/intelligence/records/:kind/:id", async (req: any) => {
    engine.list(req.params.kind, { limit: 1 });
    if (!workspace.get(req.params.id, req.params.kind))
      throw new Error("Record not found");
    return engine.remove(req.params.id, req.body?.revision);
  });
  app.post("/api/intelligence/review/:id", async (req: any) =>
    engine.review(req.params.id, req.body),
  );
  app.get("/api/intelligence/graph", async (req: any) =>
    engine.graph(req.query),
  );
  app.get("/api/intelligence/path", async (req: any) =>
    engine.path(req.query.from, req.query.to),
  );
  app.post(
    "/api/intelligence/imports",
    { bodyLimit: 9 * 1024 * 1024 },
    async (req: any) => engine.importRecords(req.body),
  );
  app.get("/api/intelligence/audit", async () => engine.audit());
  app.get("/api/intelligence/history/:id", async (req: any) =>
    engine.history(req.params.id),
  );
  app.get("/api/intelligence/export", async (req: any, reply) => {
    const out = engine.exportRecords(req.query.format);
    return reply
      .header("Content-Disposition", `attachment; filename="${out.name}"`)
      .type(out.type)
      .send(out.bytes);
  });
  return engine;
}
