import { Store } from "./storage.js";
import { WorkspaceStore, type WorkspaceObject } from "./workspace-store.js";
export type CanvasNode = {
  id: string;
  type: "text" | "file" | "link" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
  color?: string;
  sourcewatchRef?: string;
  [key: string]: unknown;
};
export type CanvasEdge = {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  fromEnd?: "none" | "arrow";
  toEnd?: "none" | "arrow";
  label?: string;
  color?: string;
  sourcewatch?: {
    classification: "hypothesis" | "annotation";
    creator: string;
    createdAt: string;
    explanation: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};
export type CanvasData = {
  title: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number; [key: string]: unknown };
  [key: string]: unknown;
};
export type CanvasObject = WorkspaceObject<CanvasData>;
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
function json(value: unknown, depth = 0): void {
  if (depth > 24) throw new Error("Canvas metadata nesting exceeds 24 levels");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value === "string") {
    if (value.length > 1000000) throw new Error("Canvas string exceeds limit");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 20000) throw new Error("Canvas array exceeds limit");
    value.forEach((v) => json(v, depth + 1));
    return;
  }
  if (!plain(value)) throw new Error("Canvas requires plain JSON data");
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      ["__proto__", "constructor", "prototype"].includes(key) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")
    )
      throw new Error("Unsafe canvas metadata key");
    json(value[key], depth + 1);
  }
}
function text(value: unknown, name: string, max = 10000) {
  if (typeof value !== "string" || value.length > max)
    throw new Error(`Invalid canvas ${name}`);
  if (
    /<(?:script|iframe|object|embed)\b|\bon(?:error|load|click)\s*=/i.test(
      value,
    )
  )
    throw new Error("Active HTML is not permitted in canvas content");
  return value;
}
const id = (v: unknown) =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const finite = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
function url(value: unknown) {
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("Invalid canvas link");
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw new Error("Canvas links must be HTTP(S) without credentials");
  return value;
}
function file(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 500 ||
    value.includes("\\") ||
    value.includes(":") ||
    value.startsWith("/") ||
    value.split("/").some((p) => !p || p === ".." || p === ".") ||
    Array.from(value).some((c) => c.charCodeAt(0) < 32)
  )
    throw new Error(
      "Canvas files must be safe relative vault paths; host filesystem access is prohibited",
    );
  return value;
}
export function validateCanvas(
  input: unknown,
  workspace?: WorkspaceStore,
): { data: CanvasData; warnings: string[] } {
  json(input);
  if (Buffer.byteLength(JSON.stringify(input)) > 4 * 1024 * 1024)
    throw new Error("Canvas exceeds 4 MiB");
  if (
    !plain(input) ||
    (input.nodes !== undefined && !Array.isArray(input.nodes)) ||
    (input.edges !== undefined && !Array.isArray(input.edges))
  )
    throw new Error("JSON Canvas nodes and edges must be arrays when present");
  if (
    ((input.nodes as unknown[] | undefined)?.length ?? 0) > 2000 ||
    ((input.edges as unknown[] | undefined)?.length ?? 0) > 5000
  )
    throw new Error("Canvas limit: 2000 nodes and 5000 edges");
  const data = structuredClone(input) as CanvasData;
  data.nodes ||= [];
  data.edges ||= [];
  data.title = text(data.title ?? "Untitled canvas", "title", 200);
  const warnings: string[] = [];
  const ids = new Set<string>();
  for (const n of data.nodes) {
    if (
      !plain(n) ||
      !id(n.id) ||
      ids.has(n.id) ||
      !["text", "file", "link", "group"].includes(n.type)
    )
      throw new Error("Invalid or duplicate canvas card");
    ids.add(n.id);
    if (
      !finite(n.x, -10000000, 10000000) ||
      !finite(n.y, -10000000, 10000000) ||
      !finite(n.width, 1, 100000) ||
      !finite(n.height, 1, 100000)
    )
      throw new Error("Canvas card geometry is invalid");
    if (![n.x, n.y, n.width, n.height].every(Number.isInteger))
      throw new Error("JSON Canvas geometry must use integer pixels");
    if (n.type === "text") text(n.text, "text", 1000000);
    if (
      n.subpath !== undefined &&
      (typeof n.subpath !== "string" ||
        !n.subpath.startsWith("#") ||
        n.subpath.length > 2000)
    )
      throw new Error("Invalid canvas file subpath");
    if (n.type === "group" && n.background !== undefined) {
      file(n.background);
      warnings.push(
        "Group background retained as a relative vault reference; external files are not loaded",
      );
    }
    if (
      n.backgroundStyle !== undefined &&
      !["cover", "ratio", "repeat"].includes(String(n.backgroundStyle))
    )
      throw new Error("Invalid group background style");
    if (n.text !== undefined) text(n.text, "text", 1000000);
    if (n.label !== undefined) text(n.label, "label", 2000);
    if (n.color !== undefined && !/^(?:[1-6]|#[a-fA-F0-9]{6})$/.test(n.color))
      throw new Error("Invalid canvas color");
    if (n.type === "link") url(n.url);
    if (n.type === "file") {
      file(n.file);
      if (!n.sourcewatchRef)
        warnings.push(
          `Unresolved vault file: ${n.file}; retained as a reference without filesystem access`,
        );
    }
    if (n.sourcewatchRef !== undefined) {
      if (
        typeof n.sourcewatchRef !== "string" ||
        !/^\w+:[0-9a-f-]{36}$/.test(n.sourcewatchRef)
      )
        throw new Error("Invalid canvas workspace reference");
      if (workspace && !workspace.resolveReference(n.sourcewatchRef))
        throw new Error("Canvas workspace reference not found");
    }
  }
  const edgeIds = new Set<string>();
  for (const edge of data.edges) {
    if (
      !plain(edge) ||
      !id(edge.id) ||
      edgeIds.has(edge.id) ||
      !ids.has(edge.fromNode) ||
      !ids.has(edge.toNode)
    )
      throw new Error("Invalid canvas connection endpoints");
    edgeIds.add(edge.id);
    for (const side of [edge.fromSide, edge.toSide])
      if (
        side !== undefined &&
        !["top", "right", "bottom", "left"].includes(side)
      )
        throw new Error("Invalid canvas connection side");
    for (const end of [edge.fromEnd, edge.toEnd])
      if (end !== undefined && !["none", "arrow"].includes(end))
        throw new Error("Invalid canvas arrow direction");
    if (edge.label !== undefined) text(edge.label, "connection label", 2000);
    if (
      edge.color !== undefined &&
      (typeof edge.color !== "string" ||
        !/^(?:[1-6]|#[a-fA-F0-9]{6})$/.test(edge.color))
    )
      throw new Error("Invalid canvas connection color");
    if (edge.sourcewatch !== undefined && !plain(edge.sourcewatch))
      throw new Error("Invalid canvas relationship metadata");
    const metadata = edge.sourcewatch;
    if (
      metadata?.classification !== undefined &&
      !["annotation", "hypothesis"].includes(metadata.classification)
    )
      throw new Error(
        "Canvas connections are hypotheses or annotations, never verified factual relationships",
      );
    edge.sourcewatch = {
      ...metadata,
      classification: metadata?.classification || "annotation",
      creator: text(
        metadata?.creator ?? "local-researcher",
        "connection creator",
        200,
      ),
      createdAt: metadata?.createdAt || new Date().toISOString(),
      explanation: text(
        metadata?.explanation ?? "",
        "connection explanation",
        10000,
      ),
    };
    if (
      typeof edge.sourcewatch.createdAt !== "string" ||
      !Number.isFinite(Date.parse(edge.sourcewatch.createdAt))
    )
      throw new Error("Invalid canvas connection timestamp");
  }
  const viewport = data.viewport ?? { x: 0, y: 0, zoom: 1 };
  if (
    !plain(viewport) ||
    !finite(viewport.x, -10000000, 10000000) ||
    !finite(viewport.y, -10000000, 10000000) ||
    !finite(viewport.zoom, 0.05, 5)
  )
    throw new Error("Invalid canvas viewport");
  data.viewport = viewport;
  if (data.edges.length)
    warnings.push(
      "Canvas lines are researcher annotations or hypotheses, not verified real-world relationships",
    );
  return { data, warnings: [...new Set(warnings)] };
}
export function createCanvas(_store: Store, workspace: WorkspaceStore) {
  const get = (id: string) => {
    const row = workspace.get<CanvasData>(id, "canvas");
    if (!row)
      throw Object.assign(new Error("Canvas not found"), { statusCode: 404 });
    return row;
  };
  return {
    list: () => workspace.list<CanvasData>("canvas"),
    get,
    save(input: unknown, id?: string, expectedRevision?: number) {
      if (id) {
        get(id);
        if (expectedRevision === undefined)
          throw Object.assign(
            new Error("Canvas update requires expectedRevision"),
            { statusCode: 409 },
          );
      }
      const { data, warnings } = validateCanvas(input, workspace);
      const row = workspace.put("canvas", data, id, expectedRevision);
      return { ...row, warnings };
    },
    remove(id: string, expectedRevision?: number) {
      get(id);
      if (expectedRevision === undefined)
        throw Object.assign(
          new Error("Canvas delete requires expectedRevision"),
          { statusCode: 409 },
        );
      return workspace.remove(id, expectedRevision);
    },
    export(id: string) {
      return get(id).data;
    },
  };
}
