import type { FastifyInstance } from "fastify";
import { WorkspaceStore } from "./workspace-store.js";
import { Store } from "./storage.js";
import { createIntelligence } from "./intelligence.js";
import { createCanvas } from "./canvas.js";
export function registerWorkspaceBridge(
  app: FastifyInstance,
  store: Store,
  workspace: WorkspaceStore,
) {
  const intelligence = createIntelligence(store, workspace),
    canvases = createCanvas(store, workspace);
  app.post<{ Params: { id: string; edgeId: string } }>(
    "/api/workspace/canvas/:id/propose/:edgeId",
    async (req) => {
      const body = req.body as any,
        canvas = canvases.get(req.params.id);
      if (body?.expectedRevision !== canvas.revision)
        throw Object.assign(Error("Canvas revision conflict"), {
          statusCode: 409,
        });
      const edge = canvas.data.edges.find((e) => e.id === req.params.edgeId);
      if (!edge) throw Error("Canvas line not found");
      const from = canvas.data.nodes.find((n) => n.id === edge.fromNode),
        to = canvas.data.nodes.find((n) => n.id === edge.toNode);
      if (!from?.sourcewatchRef || !to?.sourcewatchRef)
        throw Error(
          "Both cards need durable SourceWatch references before proposing a relationship",
        );
      if (
        typeof body.creator !== "string" ||
        !body.creator.trim() ||
        typeof body.explanation !== "string" ||
        !body.explanation.trim()
      )
        throw Error("Creator and explanation required");
      const existing = edge.sourcewatch?.relationshipRef;
      if (typeof existing === "string" && workspace.resolveReference(existing))
        return { relationshipRef: existing, canvas };
      store.db.exec("SAVEPOINT propose_canvas_relationship");
      try {
        const relationship = intelligence.save("relationship", {
          title: edge.label || "Canvas research hypothesis",
          type: edge.label || "research hypothesis",
          fromRef: from.sourcewatchRef,
          toRef: to.sourcewatchRef,
          creator: body.creator,
          explanation: body.explanation,
          classification: "hypothesis",
          evidenceRefs: [],
          canvasRef: "canvas:" + canvas.id,
          canvasEdgeId: edge.id,
        });
        edge.sourcewatch = {
          ...edge.sourcewatch,
          classification: edge.sourcewatch?.classification || "annotation",
          creator: edge.sourcewatch?.creator || body.creator,
          createdAt: edge.sourcewatch?.createdAt || new Date().toISOString(),
          explanation: edge.sourcewatch?.explanation || body.explanation,
          relationshipRef: "relationship:" + relationship.id,
        };
        const updated = canvases.save(canvas.data, canvas.id, canvas.revision);
        workspace.audit("canvas-propose", canvas.id, {
          edgeId: edge.id,
          relationshipRef: "relationship:" + relationship.id,
        });
        store.db.exec("RELEASE propose_canvas_relationship");
        return {
          relationshipRef: "relationship:" + relationship.id,
          canvas: updated,
        };
      } catch (e) {
        store.db.exec(
          "ROLLBACK TO propose_canvas_relationship;RELEASE propose_canvas_relationship",
        );
        throw e;
      }
    },
  );
}
