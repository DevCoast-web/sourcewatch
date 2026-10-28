import type { FastifyInstance } from "fastify";
import { Store } from "./storage.js";
import { WorkspaceStore } from "./workspace-store.js";
import { createCanvas } from "./canvas.js";
export function registerCanvasRoutes(
  app: FastifyInstance,
  store: Store,
  workspace: WorkspaceStore,
) {
  const canvas = createCanvas(store, workspace);
  app.get("/api/canvases", async () => canvas.list());
  app.post(
    "/api/canvases",
    { bodyLimit: 5 * 1024 * 1024 },
    async (req, reply) =>
      reply.code(201).send(canvas.save((req.body as any)?.data ?? req.body)),
  );
  app.post(
    "/api/canvases/import",
    { bodyLimit: 5 * 1024 * 1024 },
    async (req, reply) =>
      reply.code(201).send(canvas.save((req.body as any)?.data ?? req.body)),
  );
  app.get<{ Params: { id: string } }>("/api/canvases/:id", async (req) =>
    canvas.get(req.params.id),
  );
  app.put<{ Params: { id: string } }>(
    "/api/canvases/:id",
    { bodyLimit: 5 * 1024 * 1024 },
    async (req) => {
      const body = req.body as any;
      return canvas.save(body?.data, req.params.id, body?.expectedRevision);
    },
  );
  app.delete<{ Params: { id: string } }>("/api/canvases/:id", async (req) =>
    canvas.remove(req.params.id, (req.body as any)?.expectedRevision),
  );
  app.get<{ Params: { id: string } }>(
    "/api/canvases/:id/export",
    async (req, reply) =>
      reply
        .header(
          "Content-Disposition",
          'attachment; filename="sourcewatch.canvas"',
        )
        .type("application/json")
        .send(canvas.export(req.params.id)),
  );
  return canvas;
}
