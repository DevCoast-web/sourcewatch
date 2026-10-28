import { randomUUID } from "node:crypto";
import { Store, type RecordData } from "./storage.js";

export type KnowledgeKind = "topic" | "person" | "organization" | "claim";
export type KnowledgeNode = {
  id: string;
  title: string;
  kind: KnowledgeKind;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};
export type KnowledgeEdge = {
  id: string;
  fromId: string;
  toId: string;
  label: string;
  note: string;
  evidenceCaptureId: string | null;
  createdAt: string;
};
export type KnowledgeReference = {
  id: string;
  kind: "source" | "capture";
  title: string;
  sourceId: string;
  captureId?: string;
  url: string;
  archived?: boolean;
  observedAt?: string;
};
export type KnowledgeNodeInput = {
  title: string;
  kind: KnowledgeKind;
  body?: string;
  tags?: string[];
};
export type KnowledgeEdgeInput = {
  fromId: string;
  toId: string;
  label: string;
  note?: string;
  evidenceCaptureId?: string | null;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function requireId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !uuid.test(id))
    throw new Error("Invalid research identifier");
}
function data(input: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).some(
      (key) =>
        typeof key !== "string" ||
        !allowed.includes(key) ||
        !Object.getOwnPropertyDescriptor(input, key)?.enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key)!, "value"),
    )
  )
    throw new Error(
      "Invalid research data: use only the documented plain fields",
    );
  return input as Record<string, unknown>;
}
function text(
  value: unknown,
  field: string,
  max: number,
  required = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error(
      `Invalid ${field}: ${required ? "nonempty " : ""}text, maximum ${max} characters`,
    );
  return required ? value.trim() : value;
}

/** Editable researcher context; never part of the append-only capture chain. */
export function createKnowledge(store: Store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS research_nodes(
      id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
      kind TEXT NOT NULL CHECK(kind IN ('topic','person','organization','claim')),
      body TEXT NOT NULL CHECK(length(body)<=10000), tags TEXT NOT NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS research_edges(
      id TEXT PRIMARY KEY, fromId TEXT NOT NULL, toId TEXT NOT NULL,
      label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
      note TEXT NOT NULL CHECK(length(note)<=2000),
      evidenceCaptureId TEXT REFERENCES captures(id), createdAt TEXT NOT NULL,
      CHECK(fromId<>toId), UNIQUE(fromId,toId,label)
    );
    CREATE INDEX IF NOT EXISTS research_edges_from ON research_edges(fromId);
    CREATE INDEX IF NOT EXISTS research_edges_to ON research_edges(toId);
    CREATE TRIGGER IF NOT EXISTS research_nodes_limit BEFORE INSERT ON research_nodes
      WHEN (SELECT COUNT(*) FROM research_nodes)>=1000
      BEGIN SELECT RAISE(ABORT,'Research node limit reached (1000)'); END;
    CREATE TRIGGER IF NOT EXISTS research_edges_limit BEFORE INSERT ON research_edges
      WHEN (SELECT COUNT(*) FROM research_edges)>=5000
      BEGIN SELECT RAISE(ABORT,'Research edge limit reached (5000)'); END;
  `);
  const getNode = (id: string) => {
    const row = store.db
      .prepare("SELECT * FROM research_nodes WHERE id=?")
      .get(id) as (Omit<KnowledgeNode, "tags"> & { tags: string }) | undefined;
    return row ? { ...row, tags: JSON.parse(row.tags) as string[] } : undefined;
  };
  function transaction<T>(operation: () => T): T {
    store.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      store.db.exec("COMMIT");
      return result;
    } catch (error) {
      store.db.exec("ROLLBACK");
      throw error;
    }
  }
  function requireReference(value: unknown): string {
    if (typeof value !== "string")
      throw new Error("Invalid research reference");
    const match = /^(node|source|capture):(.+)$/.exec(value);
    if (!match) throw new Error("Invalid research reference");
    const [, kind, id] = match;
    requireId(id);
    const exists =
      kind === "node"
        ? getNode(id)
        : kind === "source"
          ? store.db.prepare("SELECT id FROM sources WHERE id=?").get(id)
          : store.get(id);
    if (!exists) throw new Error("Research reference not found");
    return value;
  }
  function saveNode(input: KnowledgeNodeInput, id?: string): KnowledgeNode;
  function saveNode(
    id: string | undefined,
    input: KnowledgeNodeInput,
  ): KnowledgeNode;
  function saveNode(first: unknown, second?: unknown): KnowledgeNode {
    const id =
      typeof first === "string" || first === undefined ? first : second;
    const input = data(
      typeof first === "string" || first === undefined ? second : first,
      ["title", "kind", "body", "tags"],
    );
    if (id !== undefined) requireId(id);
    const title = text(input.title, "title", 120, true);
    if (
      !["topic", "person", "organization", "claim"].includes(
        input.kind as string,
      )
    )
      throw new Error("Invalid research node kind");
    const body = text(
      input.body === undefined ? "" : input.body,
      "body",
      10000,
    );
    const rawTags = input.tags === undefined ? [] : input.tags;
    if (
      !Array.isArray(rawTags) ||
      rawTags.length > 20 ||
      rawTags.some((tag) => typeof tag !== "string" || tag.length > 40)
    )
      throw new Error("Invalid tags: maximum 20 tags of 40 characters");
    const tags = [
      ...new Set(rawTags.map((tag: string) => tag.trim()).filter(Boolean)),
    ];
    return transaction(() => {
      const previous = id === undefined ? undefined : getNode(id as string);
      if (id !== undefined && !previous)
        throw new Error("Research node not found");
      const nodeId = (id as string | undefined) || randomUUID();
      const now = new Date().toISOString();
      if (previous) {
        store.db
          .prepare(
            "UPDATE research_nodes SET title=?,kind=?,body=?,tags=?,updatedAt=? WHERE id=?",
          )
          .run(
            title,
            input.kind as string,
            body,
            JSON.stringify(tags),
            now,
            nodeId,
          );
      } else {
        store.db
          .prepare(
            "INSERT INTO research_nodes(id,title,kind,body,tags,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            nodeId,
            title,
            input.kind as string,
            body,
            JSON.stringify(tags),
            now,
            now,
          );
      }
      return getNode(nodeId)!;
    });
  }
  function deleteNode(id: string) {
    requireId(id);
    transaction(() => {
      if (!getNode(id)) throw new Error("Research node not found");
      store.db
        .prepare("DELETE FROM research_edges WHERE fromId=? OR toId=?")
        .run(`node:${id}`, `node:${id}`);
      store.db.prepare("DELETE FROM research_nodes WHERE id=?").run(id);
    });
    return { deleted: true };
  }
  function addEdge(value: KnowledgeEdgeInput): KnowledgeEdge {
    const input = data(value, [
      "fromId",
      "toId",
      "label",
      "note",
      "evidenceCaptureId",
    ]);
    const label = text(input.label, "label", 80, true);
    const note = text(
      input.note === undefined ? "" : input.note,
      "edge note",
      2000,
    );
    return transaction(() => {
      const fromId = requireReference(input.fromId);
      const toId = requireReference(input.toId);
      if (fromId === toId) throw new Error("Self links are not allowed");
      const evidenceCaptureId = input.evidenceCaptureId ?? null;
      if (evidenceCaptureId !== null) {
        requireId(evidenceCaptureId);
        if (!store.get(evidenceCaptureId))
          throw new Error("Evidence capture not found");
      }
      if (
        store.db
          .prepare(
            "SELECT id FROM research_edges WHERE fromId=? AND toId=? AND label=?",
          )
          .get(fromId, toId, label)
      )
        throw new Error("Duplicate research connection");
      const edge: KnowledgeEdge = {
        id: randomUUID(),
        fromId,
        toId,
        label,
        note,
        evidenceCaptureId: evidenceCaptureId as string | null,
        createdAt: new Date().toISOString(),
      };
      store.db
        .prepare(
          "INSERT INTO research_edges(id,fromId,toId,label,note,evidenceCaptureId,createdAt) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          edge.id,
          edge.fromId,
          edge.toId,
          edge.label,
          edge.note,
          edge.evidenceCaptureId,
          edge.createdAt,
        );
      return edge;
    });
  }
  function deleteEdge(id: string) {
    requireId(id);
    const result = store.db
      .prepare("DELETE FROM research_edges WHERE id=?")
      .run(id);
    if (!result.changes) throw new Error("Research connection not found");
    return { deleted: true };
  }
  function list() {
    const nodes = (
      store.db
        .prepare("SELECT id FROM research_nodes ORDER BY createdAt,id")
        .all() as { id: string }[]
    ).map(({ id }) => getNode(id)!);
    const edgeRows = store.db
      .prepare("SELECT * FROM research_edges ORDER BY createdAt,id")
      .all() as KnowledgeEdge[];
    const edges = edgeRows.map((edge) => ({ ...edge }));
    const sources = store.sources(true);
    const references: KnowledgeReference[] = sources.map((source) => ({
      id: `source:${source.id}`,
      kind: "source",
      title: source.name,
      sourceId: source.id,
      url: source.url,
      archived: !!source.archived,
    }));
    const captureIds = new Set<string>();
    const backlinks: Record<string, string[]> = Object.fromEntries(
      [
        ...nodes.map((node) => `node:${node.id}`),
        ...references.map((ref) => ref.id),
      ].map((id) => [id, []]),
    );
    for (const edge of edges) {
      for (const ref of [edge.fromId, edge.toId]) {
        if (ref.startsWith("capture:")) captureIds.add(ref.slice(8));
      }
      if (edge.evidenceCaptureId) captureIds.add(edge.evidenceCaptureId);
      (backlinks[edge.toId] ||= []).push(edge.id);
    }
    for (const id of captureIds) {
      const capture = store.get(id);
      if (capture)
        references.push({
          id: `capture:${id}`,
          kind: "capture",
          title: capture.title || "Untitled capture",
          sourceId: capture.sourceId,
          captureId: capture.id,
          url: capture.finalUrl,
          observedAt: capture.observedAt,
        });
      backlinks[`capture:${id}`] ||= [];
    }
    const choiceRows = store.db
      .prepare("SELECT metadata FROM captures ORDER BY seq DESC LIMIT 1001")
      .all() as { metadata: string }[];
    const captureChoices: KnowledgeReference[] = choiceRows
      .slice(0, 1000)
      .map((row) => {
        const capture = JSON.parse(row.metadata) as RecordData;
        return {
          id: `capture:${capture.id}`,
          kind: "capture",
          title: capture.title || "Untitled capture",
          sourceId: capture.sourceId,
          captureId: capture.id,
          url: capture.finalUrl,
          observedAt: capture.observedAt,
        };
      });
    return {
      nodes,
      references,
      edges,
      backlinks,
      captureChoices,
      capturesTruncated: choiceRows.length > 1000,
    };
  }
  function exportContext() {
    const { nodes, references, edges, backlinks } = list();
    return {
      format: "sourcewatch-research-context" as const,
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      notice:
        "Editable researcher context. Connections express researcher interpretations, not verified relationships. This JSON is separate from preserved captures and their tamper-evident chains; it does not certify authenticity or timestamps.",
      nodes,
      references,
      edges,
      backlinks,
    };
  }
  return {
    list,
    saveNode,
    deleteNode,
    addEdge,
    deleteEdge,
    export: exportContext,
  };
}
