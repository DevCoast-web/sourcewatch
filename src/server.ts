import { registerWorkspaceBridge } from "./workspace-bridge.js";
import { WorkspaceStore } from "./workspace-store.js";
import {
  registerWorkspaceRoutes,
  recordWorkspaceChange,
} from "./workspace-routes.js";
import { registerWorkspaceExtraRoutes } from "./workspace-extras.js";
import { registerVaultRoutes } from "./vault-routes.js";
import { registerCanvasRoutes } from "./canvas-routes.js";
import { registerIntelligenceRoutes } from "./intelligence-routes.js";
import {
  createKnowledge,
  type KnowledgeNodeInput,
  type KnowledgeEdgeInput,
} from "./knowledge.js";
import { VERSION } from "./version.js";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Store } from "./storage.js";
import { capture, type CaptureOptions } from "./capture.js";
import { parsePublicUrl } from "./network.js";
import { compare } from "./compare.js";
import { createResearch } from "./research.js";
import { compareStructure } from "./structure.js";
import { nextDue } from "./scheduler.js";
import { exportBundle } from "./export.js";
export async function createApp(
  options: {
    root?: string;
    captureOptions?: CaptureOptions;
    testMode?: boolean;
  } = {},
) {
  const store = new Store(
    options.root || resolve(process.env.SOURCEWATCH_DATA || "data"),
  );
  const research = createResearch(store);
  const knowledge = createKnowledge(store);
  const workspace = new WorkspaceStore(store);
  const app = Fastify({ logger: !options.testMode, bodyLimit: 16384 });
  let busy = false;
  let closing = false;
  let captureDrained: Promise<void> | undefined;
  app.addHook("onRequest", async (req, reply) => {
    const host = req.headers.host || "";
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))
      return reply.code(403).send({ error: "Loopback Host required" });
    if (req.headers.origin && req.headers.origin !== `http://${host}`)
      return reply.code(403).send({ error: "Cross-origin requests blocked" });
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; worker-src 'self'; frame-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
      );
  });
  app.setErrorHandler((e: any, _req, reply) =>
    reply
      .code(e.statusCode || 400)
      .send({ error: e.message || "Request failed" }),
  );
  const source = (id: string) => {
    const s = store.source(id);
    if (!s)
      throw Object.assign(new Error("Source not found"), { statusCode: 404 });
    return s;
  };
  const record = (id: string) => {
    const r = store.get(id);
    if (!r)
      throw Object.assign(new Error("Capture not found"), { statusCode: 404 });
    return r;
  };
  async function runCapture(id: string) {
    if (closing)
      throw Object.assign(new Error("Service is shutting down"), {
        statusCode: 503,
      });
    if (busy)
      throw Object.assign(
        new Error("Another capture is running. Please retry shortly."),
        { statusCode: 409 },
      );
    const s = source(id);
    if (s.archived)
      throw new Error("Restore this archived source before capturing");
    busy = true;
    let finishCapture: () => void = () => {};
    captureDrained = new Promise<void>((resolve) => {
      finishCapture = resolve;
    });
    try {
      store.attempt(id, null);
      const previous = store.history(id).at(-1);
      const result = store.save(
        s,
        await capture(s.url, s.selectors, {
          ...options.captureOptions,
          ...store.settings(),
        }),
      );
      store.attempt(id, null);
      try {
        research.recordSuccess(previous, result);
        recordWorkspaceChange(workspace, previous, result);
      } catch (e) {
        app.log.error({ err: e }, "Could not update change inbox");
      }
      return result;
    } catch (e) {
      store.attempt(id, (e as Error).message);
      try {
        research.recordFailure(id, (e as Error).message);
      } catch (inboxError) {
        app.log.error({ err: inboxError }, "Could not record failure in inbox");
      }
      throw e;
    } finally {
      busy = false;
      finishCapture();
      captureDrained = undefined;
    }
  }
  app.get("/api/status", async () => ({
    busy,
    version: VERSION,
    unread: research.unreadCount(),
  }));
  app.get<{ Querystring: { archived?: string } }>("/api/sources", async (req) =>
    store.sources(req.query.archived === "true").map((s) => {
      const h = store.history(s.id);
      return { ...s, captureCount: h.length, latest: h.at(-1) || null };
    }),
  );
  app.post("/api/sources", async (req, reply) => {
    const b = req.body as any;
    if (!b || typeof b.url !== "string" || b.url.length > 2048)
      throw new Error("A valid URL is required");
    if (!options.testMode || b.url !== options.captureOptions?.fixtureUrl)
      parsePublicUrl(b.url);
    const description = String(b.description || "").trim();
    if (description.length > 2000)
      throw new Error("Description must be at most 2000 characters");
    const name = String(b.name || new URL(b.url).hostname).trim();
    const collection = String(b.collection || "Unsorted").trim();
    const intervalMinutes = Number(b.intervalMinutes ?? 0);
    const selectors = b.selectors || [];
    if (
      !name ||
      name.length > 120 ||
      !collection ||
      collection.length > 80 ||
      !Number.isInteger(intervalMinutes) ||
      intervalMinutes < 0 ||
      intervalMinutes > 525600 ||
      (intervalMinutes > 0 && intervalMinutes < 5) ||
      !Array.isArray(selectors) ||
      selectors.length > 20 ||
      selectors.some(
        (s: unknown) => typeof s !== "string" || !s.trim() || s.length > 200,
      )
    )
      throw new Error(
        "Invalid source settings (interval: 0 or 5–525600 minutes; at most 20 CSS selectors)",
      );
    return reply.code(201).send(
      store.add({
        url: b.url,
        name,
        description,
        collection,
        intervalMinutes,
        selectors,
      }),
    );
  });
  app.patch<{ Params: { id: string } }>("/api/sources/:id", async (req) => {
    const current = source(req.params.id),
      b = req.body as any;
    if (!b || typeof b !== "object") throw new Error("Invalid settings");
    if (b.paused !== undefined) {
      if (typeof b.paused !== "boolean")
        throw new Error("paused must be boolean");
    }
    if (b.archived !== undefined) {
      if (typeof b.archived !== "boolean")
        throw new Error("archived must be boolean");
    }
    let updated: Parameters<Store["update"]>[1] | undefined;
    if (
      [
        "name",
        "description",
        "collection",
        "intervalMinutes",
        "selectors",
      ].some((k) => b[k] !== undefined)
    ) {
      updated = {
        name: b.name ?? current.name,
        description: b.description ?? current.description,
        collection: b.collection ?? current.collection,
        intervalMinutes: b.intervalMinutes ?? current.intervalMinutes,
        selectors: b.selectors ?? current.selectors,
      };
      if (
        typeof updated.name !== "string" ||
        !updated.name.trim() ||
        updated.name.length > 120 ||
        typeof updated.description !== "string" ||
        updated.description.length > 2000 ||
        typeof updated.collection !== "string" ||
        !updated.collection.trim() ||
        updated.collection.length > 80 ||
        !Number.isInteger(updated.intervalMinutes) ||
        updated.intervalMinutes < 0 ||
        updated.intervalMinutes > 525600 ||
        (updated.intervalMinutes > 0 && updated.intervalMinutes < 5) ||
        !Array.isArray(updated.selectors) ||
        updated.selectors.length > 20 ||
        updated.selectors.some(
          (v: any) => typeof v !== "string" || !v.trim() || v.length > 200,
        )
      )
        throw new Error("Invalid source settings");
    }
    store.db.exec("BEGIN IMMEDIATE");
    try {
      if (updated) store.update(current.id, updated);
      if (b.archived !== undefined) store.archive(current.id, b.archived);
      if (b.paused !== undefined) store.pause(current.id, b.paused);
      store.db.exec("COMMIT");
    } catch (e) {
      store.db.exec("ROLLBACK");
      throw e;
    }
    return source(current.id);
  });
  app.get("/api/settings", async () => ({
    ...store.settings(),
    limits: {
      captureTimeoutSeconds: 45,
      maxRequests: 150,
      maxResponseMiB: 8,
      maxTotalMiB: 32,
      maxScreenshotHeight: store.settings().maxScreenshotHeight,
      maxScreenshotPixels: 160000000,
      maxTiledHeight: 524288,
      tileHeight: 8192,
      maxScreenshotMiB: 64,
      concurrency: 1,
    },
  }));
  app.patch("/api/settings", async (req) => {
    const n = (req.body as any)?.settleMs;
    if (!Number.isInteger(n) || n < 0 || n > 5000)
      throw new Error("Render settle time must be 0–5000 milliseconds");
    const height = (req.body as any)?.maxScreenshotHeight;
    if (
      height !== undefined &&
      (!Number.isInteger(height) || height < 1000 || height > 200000)
    )
      throw new Error("Maximum screenshot height must be 1000–200000 pixels");
    const mode = (req.body as any)?.screenshotMode;
    const fallback = (req.body as any)?.preserveTextOnScreenshotFailure;
    if (mode !== undefined && !["single", "tiled"].includes(mode))
      throw new Error("Invalid screenshot mode");
    if (fallback !== undefined && typeof fallback !== "boolean")
      throw new Error("Invalid screenshot fallback");
    store.setSettings(n, height, mode, fallback);
    return store.settings();
  });
  app.get<{ Querystring: { q?: string } }>("/api/search", async (req) => {
    const q = (req.query.q || "").slice(0, 200).trim().toLowerCase();
    if (!q) return [];
    const results: any[] = [];
    for (const s of store.sources(true))
      for (const r of store.history(s.id).reverse()) {
        const text = store.file(r.id, "text.txt").toString();
        const at = text.toLowerCase().indexOf(q);
        const annotation = research.annotation(r.id);
        const noteText = annotation.note + " " + annotation.tags.join(" ");
        const noteAt = noteText.toLowerCase().indexOf(q);
        if (at >= 0 || r.title.toLowerCase().includes(q) || noteAt >= 0)
          results.push({
            id: r.id,
            sourceId: s.id,
            sourceName: s.name,
            archived: s.archived,
            title: r.title,
            observedAt: r.observedAt,
            snippet:
              noteAt >= 0 && at < 0
                ? "Research notes: " +
                  noteText.slice(Math.max(0, noteAt - 30), noteAt + 180)
                : text.slice(Math.max(0, at - 50), Math.max(0, at) + 180),
          });
        if (results.length >= 100) return results;
      }
    return results;
  });
  app.post<{ Params: { id: string } }>(
    "/api/sources/:id/capture",
    async (req) => runCapture(req.params.id),
  );
  app.get<{ Params: { id: string }; Querystring: { q?: string } }>(
    "/api/sources/:id/captures",
    async (req) => {
      source(req.params.id);
      const q = (req.query.q || "").slice(0, 200).toLowerCase();
      return store
        .history(req.params.id)
        .filter(
          (r) =>
            !q ||
            r.title.toLowerCase().includes(q) ||
            (
              research.annotation(r.id).note +
              " " +
              research.annotation(r.id).tags.join(" ")
            )
              .toLowerCase()
              .includes(q) ||
            store.file(r.id, "text.txt").toString().toLowerCase().includes(q),
        )
        .reverse();
    },
  );
  app.get<{ Params: { id: string } }>("/api/captures/:id", async (req) => {
    const r = record(req.params.id);
    return { ...r, text: store.file(r.id, "text.txt").toString() };
  });
  app.get<{ Params: { id: string; name: string } }>(
    "/api/captures/:id/files/:name",
    async (req, reply) => {
      const captureRecord = record(req.params.id);
      const n = req.params.name;
      if (n !== "metadata.json" && !Object.hasOwn(captureRecord.files, n))
        return reply.code(404).send({ error: "Artifact not found" });
      if (n === "page.html")
        reply.header("Content-Disposition", 'attachment; filename="page.html"');
      return reply
        .type(
          n.endsWith(".png")
            ? "image/png"
            : n === "metadata.json"
              ? "application/json"
              : "text/plain; charset=utf-8",
        )
        .send(store.file(req.params.id, n));
    },
  );
  app.get<{ Querystring: { unread?: string } }>(
    "/api/research/events",
    async (req) =>
      research
        .listEvents(req.query.unread === "true")
        .slice(0, 500)
        .map((e) => ({
          ...e,
          sourceName: store.source(e.sourceId)?.name || "Archived source",
        })),
  );
  app.patch<{ Params: { id: string } }>(
    "/api/research/events/:id",
    async (req) => research.markRead(req.params.id),
  );
  app.get<{ Params: { id: string } }>(
    "/api/captures/:id/annotation",
    async (req) => research.annotation(req.params.id),
  );
  app.put<{ Params: { id: string } }>(
    "/api/captures/:id/annotation",
    { bodyLimit: 65536 },
    async (req) => research.saveAnnotation(req.params.id, req.body as any),
  );
  app.get<{ Params: { id: string } }>(
    "/api/captures/:id/annotation/export",
    async (req, reply) =>
      reply
        .header(
          "Content-Disposition",
          'attachment; filename="research-notes.json"',
        )
        .send({
          type: "researcher-annotation",
          description:
            "Editable researcher notes; separate from original captured evidence.",
          ...research.annotation(req.params.id),
        }),
  );
  app.get<{ Querystring: { before: string; after: string } }>(
    "/api/compare/structure",
    async (req) => {
      const a = record(req.query.before),
        b = record(req.query.after);
      if (a.sourceId !== b.sourceId)
        throw new Error("Choose two captures from the same source");
      return compareStructure(
        store.file(a.id, "page.html").toString(),
        store.file(b.id, "page.html").toString(),
      );
    },
  );
  app.get<{ Querystring: { before: string; after: string } }>(
    "/api/compare",
    async (req) => {
      const a = record(req.query.before),
        b = record(req.query.after);
      if (a.sourceId !== b.sourceId)
        throw new Error("Choose two captures from the same source");
      return {
        ...compare(
          {
            text: store.file(a.id, "text.txt").toString(),
            links: a.links,
            title: a.title,
          },
          {
            text: store.file(b.id, "text.txt").toString(),
            links: b.links,
            title: b.title,
          },
        ),
        before: a,
        after: b,
      };
    },
  );
  app.get<{ Params: { id: string }; Querystring: { ids?: string } }>(
    "/api/sources/:id/export",
    async (req, reply) => {
      source(req.params.id);
      const bundle = exportBundle(
        store,
        req.params.id,
        req.query.ids?.split(",").filter(Boolean),
        store.history(req.params.id).map((r) => research.annotation(r.id)),
      );
      return reply
        .header(
          "Content-Disposition",
          `attachment; filename="sourcewatch-${req.params.id}.zip"`,
        )
        .header("X-Manifest-SHA256", bundle.manifestSha256)
        .type("application/zip")
        .send(bundle.zip);
    },
  );
  app.get("/api/knowledge", async () => knowledge.list());
  app.post("/api/knowledge/nodes", { bodyLimit: 131072 }, async (req, reply) =>
    reply.code(201).send(knowledge.saveNode(req.body as KnowledgeNodeInput)),
  );
  app.put<{ Params: { id: string } }>(
    "/api/knowledge/nodes/:id",
    { bodyLimit: 131072 },
    async (req) =>
      knowledge.saveNode(req.body as KnowledgeNodeInput, req.params.id),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/knowledge/nodes/:id",
    async (req) => knowledge.deleteNode(req.params.id),
  );
  app.post("/api/knowledge/edges", async (req, reply) =>
    reply.code(201).send(knowledge.addEdge(req.body as KnowledgeEdgeInput)),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/knowledge/edges/:id",
    async (req) => knowledge.deleteEdge(req.params.id),
  );
  app.get("/api/knowledge/export", async (_req, reply) =>
    reply
      .header(
        "Content-Disposition",
        'attachment; filename="sourcewatch-research.json"',
      )
      .send(knowledge.export()),
  );
  registerWorkspaceRoutes(app, store, workspace);
  registerWorkspaceExtraRoutes(app, workspace);
  registerVaultRoutes(app, store, workspace);
  registerCanvasRoutes(app, store, workspace);
  registerIntelligenceRoutes(app, store, workspace);
  registerWorkspaceBridge(app, store, workspace);
  const dist = resolve("dist");
  if (existsSync(dist)) await app.register(fastifyStatic, { root: dist });
  const runScheduled = async () => {
    if (busy || closing) return;
    const due = nextDue(store.sources());
    if (due)
      try {
        await runCapture(due.id);
      } catch (e) {
        app.log.warn({ err: e }, "Scheduled capture failed");
      }
  };
  const timer = setInterval(() => void runScheduled(), 15000);
  timer.unref();
  app.addHook("preClose", async () => {
    closing = true;
    clearInterval(timer);
    await captureDrained;
  });
  app.addHook("onClose", async () => {
    clearInterval(timer);
    store.close();
  });
  return { app, store, research, workspace, runCapture, runScheduled };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { app } = await createApp();
  await app.listen({
    host: "127.0.0.1",
    port: Number(process.env.PORT || 3210),
  });
  console.log("\nSOURCEWATCH · http://127.0.0.1:" + (process.env.PORT || 3210));
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => void app.close().then(() => process.exit(0)));
}
