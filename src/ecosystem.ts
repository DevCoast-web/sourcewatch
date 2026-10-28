import { createCanvas } from "./canvas.js";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { workspaceId, type WorkspaceStore } from "./workspace-store.js";
import { parseWikiLinks } from "./vault.js";
export type EcosystemNode = {
  ref: string;
  title: string;
  kind: string;
  tags: string[];
  updatedAt: string;
  classification: string;
  degree: number;
  cluster: string;
};
export type EcosystemEdge = {
  id: string;
  from: string;
  to: string;
  kind: "hyperlink" | "citation" | "annotation" | "verified" | "membership";
  label: string;
  recordRef?: string;
};
export type EcosystemGraph = {
  nodes: EcosystemNode[];
  edges: EcosystemEdge[];
  stats: {
    indexed: number;
    entities: number;
    links: number;
    orphans: number;
    clusters: number;
    excluded: number;
    excludedByReason: Record<string, number>;
    unresolvedReferences: number;
    truncated: boolean;
  };
  revision: string;
  demo?: boolean;
};
const eligible = new Set([
  "note",
  "entity",
  "attachment",
  "investigation",
  "relationship",
  "canvas",
  "board",
  "correction",
]);
export function indexEcosystem(db: DatabaseSync): EcosystemGraph {
  const tables = new Set(
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as any[]
    ).map((r) => r.name),
  );
  const nodes: EcosystemNode[] = [],
    edges: EcosystemEdge[] = [],
    byRef = new Map<string, EcosystemNode>(),
    names = new Map<string, Set<string>>(),
    urls = new Map<string, string>(),
    excludedByReason: Record<string, number> = {};
  let unresolvedReferences = 0,
    truncated = false;
  const exclude = (reason: string, n = 1) => {
    excludedByReason[reason] = (excludedByReason[reason] || 0) + n;
  };
  function node(
    ref: string,
    title: string,
    kind: string,
    d: any = {},
    at = "",
  ) {
    if (nodes.length >= 100000) {
      exclude("node safety limit");
      truncated = true;
      return;
    }
    const n = {
      ref,
      title: String(title || kind).slice(0, 240),
      kind,
      tags: Array.isArray(d.tags)
        ? d.tags.filter((t: any) => typeof t === "string")
        : [],
      updatedAt: at,
      classification: String(d.classification || ""),
      degree: 0,
      cluster: "",
    };
    nodes.push(n);
    byRef.set(ref, n);
  }
  function edge(
    from: string,
    to: string,
    kind: EcosystemEdge["kind"],
    label: string,
    recordRef?: string,
  ) {
    if (!byRef.has(from) || !byRef.has(to)) {
      unresolvedReferences++;
      return;
    }
    if (edges.length >= 250000) {
      truncated = true;
      return;
    }
    edges.push({
      id: "e" + edges.length,
      from,
      to,
      kind,
      label: String(label || kind).slice(0, 200),
      recordRef,
    });
  }
  const urlKey = (s: string) => {
    try {
      const u = new URL(s);
      u.hash = "";
      return u.href;
    } catch {
      return "";
    }
  };
  if (tables.has("sources"))
    for (const s of db
      .prepare("SELECT * FROM sources")
      .iterate() as Iterable<any>) {
      node("source:" + s.id, s.name, "source", {}, s.createdAt);
      urls.set(urlKey(s.url), "source:" + s.id);
    }
  if (tables.has("captures"))
    for (const r of db
      .prepare("SELECT id,metadata FROM captures ORDER BY seq")
      .iterate() as Iterable<any>) {
      const c = JSON.parse(r.metadata);
      node(
        "capture:" + r.id,
        c.title || c.sourceName,
        "evidence",
        {},
        c.observedAt,
      );
    }
  if (tables.has("workspace_objects"))
    for (const r of db
      .prepare(
        "SELECT id,kind,deletedAt,updatedAt,json_extract(data,'$.title') title,json_extract(data,'$.tags') tags,json_extract(data,'$.aliases') aliases,json_extract(data,'$.vaultId') vaultId,json_extract(data,'$.folder') folder,json_extract(data,'$.classification') classification FROM workspace_objects",
      )
      .iterate() as Iterable<any>) {
      if (r.deletedAt) {
        exclude("deleted");
        continue;
      }
      if (!eligible.has(r.kind)) {
        exclude("configuration:" + r.kind);
        continue;
      }
      const ref = r.kind + ":" + r.id;
      node(
        ref,
        r.title,
        r.kind === "attachment" ? "document" : r.kind,
        {
          tags: r.tags ? JSON.parse(r.tags) : [],
          classification: r.classification,
        },
        r.updatedAt,
      );
      if (r.kind === "note")
        for (const name of [
          r.title,
          ...(r.aliases ? JSON.parse(r.aliases) : []),
          ...(r.folder ? [r.folder + "/" + r.title] : []),
        ]) {
          const key = String(r.vaultId) + ":" + String(name).toLowerCase();
          if (!names.has(key)) names.set(key, new Set());
          names.get(key)!.add(ref);
        }
    }
  if (tables.has("research_nodes"))
    for (const r of db
      .prepare("SELECT * FROM research_nodes")
      .iterate() as Iterable<any>)
      node(
        "node:" + r.id,
        r.title,
        "legacy",
        { tags: JSON.parse(r.tags) },
        r.updatedAt,
      );
  if (tables.has("captures"))
    for (const r of db
      .prepare("SELECT id,metadata FROM captures ORDER BY seq")
      .iterate() as Iterable<any>) {
      const c = JSON.parse(r.metadata);
      edge(
        "source:" + c.sourceId,
        "capture:" + r.id,
        "membership",
        "preserved observation",
      );
      for (const link of c.links || []) {
        const target = urls.get(
          urlKey(typeof link === "string" ? link : link.href || link.url),
        );
        if (target)
          edge(
            "capture:" + r.id,
            target,
            "hyperlink",
            "captured outbound link",
          );
      }
    }
  if (tables.has("workspace_objects"))
    for (const r of db
      .prepare(
        "SELECT id,kind,data FROM workspace_objects WHERE deletedAt IS NULL",
      )
      .iterate() as Iterable<any>) {
      const ref = r.kind + ":" + r.id;
      if (!byRef.has(ref)) continue;
      const d = JSON.parse(r.data);
      for (const target of d.refs || [])
        if (typeof target === "string")
          edge(ref, target, "annotation", "explicit research reference", ref);
      for (const target of d.evidenceRefs || [])
        if (typeof target === "string")
          edge(ref, target, "citation", "cited evidence", ref);
      for (const citation of d.citations || [])
        if (typeof citation.ref === "string")
          edge(
            ref,
            citation.ref,
            "citation",
            citation.title || "citation",
            ref,
          );
      if (r.kind === "relationship") {
        const kind =
          d.classification === "verified" ? "verified" : "annotation";
        edge(d.fromRef, d.toRef, kind, d.type || d.title, ref);
        edge(ref, d.fromRef, "membership", "relationship endpoint", ref);
        edge(ref, d.toRef, "membership", "relationship endpoint", ref);
      }
      if (r.kind === "note") {
        for (const link of parseWikiLinks(d.body || "")) {
          let target = !link.target
            ? ref
            : byRef.has(link.target)
              ? link.target
              : workspaceId(link.target) && byRef.has("note:" + link.target)
                ? "note:" + link.target
                : undefined;
          if (!target) {
            const matches = names.get(
              String(d.vaultId) +
                ":" +
                link.target.replace(/\.md$/i, "").toLowerCase(),
            );
            if (matches?.size === 1) target = [...matches][0];
          }
          if (target) edge(ref, target, "hyperlink", link.label, ref);
          else unresolvedReferences++;
        }
        for (const match of String(d.body || "").matchAll(
          /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g,
        )) {
          const target = urls.get(urlKey(match[1]));
          if (target)
            edge(ref, target, "hyperlink", "Markdown source hyperlink", ref);
        }
      }
      if (r.kind === "investigation")
        for (const entry of d.timeline || []) {
          const refs = [
            entry.ref,
            entry.evidenceRef,
            ...(Array.isArray(entry.refs) ? entry.refs : []),
          ];
          for (const target of refs)
            if (typeof target === "string")
              edge(ref, target, "annotation", "investigation timeline", ref);
        }
      if (r.kind === "canvas") {
        const cards = new Map<string, string>();
        for (const card of d.nodes || [])
          if (card.sourcewatchRef) {
            cards.set(card.id, card.sourcewatchRef);
            edge(
              ref,
              card.sourcewatchRef,
              "membership",
              "canvas placement",
              ref,
            );
          }
        for (const line of d.edges || []) {
          const from = cards.get(line.fromNode),
            to = cards.get(line.toNode);
          if (from && to)
            edge(
              from,
              to,
              "annotation",
              line.label || "canvas hypothesis",
              ref,
            );
        }
      }
    }
  if (tables.has("research_edges"))
    for (const e of db
      .prepare("SELECT * FROM research_edges")
      .iterate() as Iterable<any>) {
      edge(
        "node:" + e.fromId,
        "node:" + e.toId,
        "annotation",
        e.label,
        "node:" + e.fromId,
      );
      if (e.evidenceCaptureId)
        edge(
          "node:" + e.fromId,
          "capture:" + e.evidenceCaptureId,
          "citation",
          "legacy evidence",
        );
    }
  const unique = new Map<string, EcosystemEdge>();
  for (const e of edges) {
    const key = [e.from, e.to, e.kind, e.label, e.recordRef || ""].join("\0");
    if (!unique.has(key)) unique.set(key, e);
  }
  const links = [...unique.values()],
    adj = new Map(nodes.map((n) => [n.ref, [] as string[]]));
  for (const e of links) {
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
    byRef.get(e.from)!.degree++;
    byRef.get(e.to)!.degree++;
  }
  let clusters = 0;
  for (const n of nodes)
    if (!n.cluster) {
      const id = "cluster-" + ++clusters;
      n.cluster = id;
      const queue = [n.ref];
      for (let i = 0; i < queue.length; i++)
        for (const ref of adj.get(queue[i])!) {
          const other = byRef.get(ref)!;
          if (!other.cluster) {
            other.cluster = id;
            queue.push(ref);
          }
        }
    }
  const counts = new Map<string, number>();
  for (const n of nodes)
    counts.set(n.cluster, (counts.get(n.cluster) || 0) + 1);
  const large = new Set(
    nodes.filter((n) => (counts.get(n.cluster) || 0) > 250).map((n) => n.ref),
  );
  if (large.size) {
    let group = clusters;
    for (const seed of [...nodes].sort((a, b) => b.degree - a.degree)) {
      if (!large.has(seed.ref)) continue;
      const id = "neighborhood-" + ++group,
        queue = [seed.ref];
      large.delete(seed.ref);
      seed.cluster = id;
      for (let i = 0; i < queue.length; i++)
        for (const ref of adj.get(queue[i])!) {
          if (queue.length >= 200) break;
          if (large.has(ref)) {
            large.delete(ref);
            byRef.get(ref)!.cluster = id;
            queue.push(ref);
          }
        }
    }
    clusters = new Set(nodes.map((n) => n.cluster)).size;
  }
  return {
    nodes,
    edges: links,
    revision: "",
    stats: {
      indexed: nodes.length,
      entities: nodes.filter((n) => n.kind === "entity").length,
      links: links.length,
      orphans: nodes.filter((n) => !n.degree).length,
      clusters,
      excluded: Object.values(excludedByReason).reduce((a, b) => a + b, 0),
      excludedByReason,
      unresolvedReferences,
      truncated,
    },
  };
}
export function demoEcosystem(
  count = 10000,
  linkCount = 12000,
): EcosystemGraph {
  const kinds = [
    "entity",
    "note",
    "document",
    "source",
    "evidence",
    "investigation",
  ];
  const nodes: EcosystemNode[] = Array.from({ length: count }, (_, i) => ({
    ref: "demo:" + i,
    title: "DEMO " + kinds[i % kinds.length] + " " + i,
    kind: kinds[i % kinds.length],
    tags: ["synthetic"],
    updatedAt: "2026-10-28",
    classification: "",
    degree: 0,
    cluster: "cluster-" + Math.floor(i / 100),
  }));
  const edges: EcosystemEdge[] = [];
  for (let i = 0; i < linkCount; i++) {
    let from = i % count,
      to = Math.floor(from / 100) * 100 + (((from % 100) + 1) % 100);
    if (i >= count) {
      const j = i - count,
        g = j % Math.ceil(count / 100),
        base = g * 100;
      from = Math.min(
        count - 1,
        base + 1 + (Math.floor(j / Math.ceil(count / 100)) % 99),
      );
      to =
        (j + Math.floor(j / 100)) % 17 === 0
          ? ((g + 1) % Math.ceil(count / 100)) * 100
          : base;
    }
    nodes[from].degree++;
    nodes[to].degree++;
    edges.push({
      id: "demo-e" + i,
      from: nodes[from].ref,
      to: nodes[to].ref,
      kind: i % 5 === 0 ? "citation" : "annotation",
      label: "SYNTHETIC renderer test, not a research assertion",
    });
  }
  return {
    nodes,
    edges,
    revision: "demo-v1",
    demo: true,
    stats: {
      indexed: count,
      entities: nodes.filter((n) => n.kind === "entity").length,
      links: edges.length,
      orphans: 0,
      clusters: Math.ceil(count / 100),
      excluded: 0,
      excludedByReason: {},
      unresolvedReferences: 0,
      truncated: false,
    },
  };
}
export function registerEcosystemRoutes(
  app: FastifyInstance,
  workspace: WorkspaceStore,
) {
  app.get("/api/ecosystem/record", async (req: any) => {
    const ref = String(req.query.ref || ""),
      resolved = workspace.resolveReference(ref);
    if (!resolved) throw Error("Record unavailable");
    const [kind, id] = ref.split(":");
    if (kind === "capture") {
      const metadata = workspace.store.get(id)!;
      return {
        ...resolved,
        data: {
          ...metadata,
          text: workspace.store.file(id, "text.txt").toString().slice(0, 30000),
        },
      };
    }
    if (kind === "source")
      return { ...resolved, data: workspace.store.source(id) };
    if (kind === "node")
      return {
        ...resolved,
        data: workspace.store.db
          .prepare("SELECT * FROM research_nodes WHERE id=?")
          .get(id),
      };
    return { ...resolved, data: workspace.get(id)?.data };
  });
  const layout = (id: string) => {
    if (!workspace.get(id, "investigation"))
      throw Error("Investigation not found");
    return workspace
      .list("layout")
      .find(
        (r) =>
          r.data.purpose === "ecosystem-investigation" &&
          r.data.investigationId === id,
      );
  };
  app.get(
    "/api/ecosystem/layout/:id",
    async (req: any) => layout(req.params.id) || { revision: 0 },
  );
  app.put(
    "/api/ecosystem/layout/:id",
    { bodyLimit: 2 * 1024 * 1024 },
    async (req: any) => {
      const old = layout(req.params.id),
        b = req.body;
      if (
        !b ||
        !Number.isInteger(b.expectedRevision) ||
        b.expectedRevision !== (old?.revision || 0)
      )
        throw Object.assign(
          Error("Investigation layout changed; reload before saving"),
          { statusCode: 409 },
        );
      if (
        !b.positions ||
        typeof b.positions !== "object" ||
        Array.isArray(b.positions) ||
        Object.keys(b.positions).length > 10000
      )
        throw Error("Invalid layout positions");
      for (const [ref, p] of Object.entries(b.positions) as any) {
        if (
          !workspace.resolveReference(ref) ||
          !p ||
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          Math.abs(p.x) > 1e7 ||
          Math.abs(p.y) > 1e7
        )
          throw Error("Invalid position reference or coordinate");
      }
      if (
        !b.view ||
        !Number.isFinite(b.view.x) ||
        !Number.isFinite(b.view.y) ||
        !Number.isFinite(b.view.z) ||
        b.view.z < 0.015 ||
        b.view.z > 10
      )
        throw Error("Invalid graph viewport");
      return workspace.put(
        "layout",
        {
          title: "Investigation graph",
          purpose: "ecosystem-investigation",
          investigationId: req.params.id,
          positions: b.positions,
          view: b.view,
        },
        old?.id,
        old?.revision,
      );
    },
  );
  app.post("/api/ecosystem/investigation-canvas/:id", async (req: any) => {
    const investigation = workspace.get(req.params.id, "investigation");
    if (!investigation) throw Error("Investigation not found");
    const existing = workspace
      .list("canvas")
      .find(
        (r) => r.data.investigationRef === "investigation:" + req.params.id,
      );
    if (existing) return existing;
    const graph = indexEcosystem(workspace.store.db),
      refs = new Set<string>([
        "investigation:" + req.params.id,
        ...(investigation.data.refs || []),
      ]);
    for (const edge of graph.edges)
      if (refs.has(edge.from) && edge.kind === "citation") refs.add(edge.to);
    const selected = graph.nodes.filter((n) => refs.has(n.ref));
    if (selected.length > 1000)
      throw Error("Investigation canvas conversion limited to 1000 records");
    const positions = layout(req.params.id)?.data.positions || {},
      mapping = new Map(selected.map((n, i) => [n.ref, "record" + i]));
    return createCanvas(workspace.store, workspace).save({
      title: investigation.data.title + " · research canvas",
      investigationRef: "investigation:" + req.params.id,
      nodes: selected.map((n, i) => ({
        id: mapping.get(n.ref),
        type: "file",
        file: "records/" + n.ref.split(":")[1],
        sourcewatchRef: n.ref,
        x: Math.round(positions[n.ref]?.x ?? (i % 5) * 360),
        y: Math.round(positions[n.ref]?.y ?? Math.floor(i / 5) * 260),
        width: 300,
        height: 200,
      })),
      edges: graph.edges
        .filter((e) => refs.has(e.from) && refs.has(e.to))
        .slice(0, 5000)
        .map((e, i) => ({
          id: "connection" + i,
          fromNode: mapping.get(e.from),
          toNode: mapping.get(e.to),
          label: e.label,
          toEnd: "arrow",
          sourcewatch: {
            classification: "annotation",
            explanation:
              "Imported " +
              e.kind +
              " link; authoritative classification remains on its original record",
            creator: "local-researcher",
            ...(e.recordRef?.startsWith("relationship:")
              ? { relationshipRef: e.recordRef }
              : {}),
          },
        })),
    });
  });
  let cached: EcosystemGraph | undefined;
  let token = "";
  app.get("/api/ecosystem", async (req: any) => {
    if (req.query.demo === "true")
      return req.query.since === "demo-v1"
        ? { unchanged: true, revision: "demo-v1" }
        : demoEcosystem();
    const db = workspace.store.db;
    const current = JSON.stringify([
      db.prepare("SELECT total_changes() n").get(),
      db.prepare("PRAGMA data_version").get(),
    ]);
    if (current !== token || !cached) {
      cached = indexEcosystem(db);
      cached.revision = current;
      token = current;
    }
    if (req.query.since === current)
      return { unchanged: true, revision: current };
    return cached;
  });
}
