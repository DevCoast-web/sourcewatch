import PDFPreview from "./pdf-preview.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  CanvasData,
  CanvasNode,
  CanvasEdge,
  CanvasObject,
} from "../src/canvas.js";
import "./canvas.css";
type Ref = {
  ref: string;
  title: string;
  kind: string;
  url?: string;
  mime?: string;
  captureId?: string;
  classification?: string;
  data?: Record<string, any>;
};
type Props = {
  initialRef?: string;
  addReference?: string;
  onReferenceAdded?: () => void;
  onOpenReference: (ref: string) => void;
};
type Gesture = {
  type: "move" | "resize" | "pan" | "select";
  start: { x: number; y: number };
  original: CanvasData;
  ids: string[];
};
const blank = (): CanvasData => ({
  title: "Untitled canvas",
  nodes: [],
  edges: [],
  viewport: { x: 40, y: 40, zoom: 1 },
});
const clone = <T,>(v: T): T => structuredClone(v),
  uid = () => crypto.randomUUID();
const colors: Record<string, string> = {
  "1": "#fae0dc",
  "2": "#f8e6cf",
  "3": "#fcf0bf",
  "4": "#deeddc",
  "5": "#dcecf0",
  "6": "#e9def0",
};
const paint = (c?: string) => (c ? colors[c] || c : "#fffef9");
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.error || "Canvas request failed"), {
      status: r.status,
    });
  return data;
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeHref(value?: string) {
  try {
    const u = new URL(value || "");
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}
function Markdown({ text }: { text: string }) {
  return (
    <div className="canvas-markdown">
      {text
        .split("\n")
        .slice(0, 300)
        .map((s, i) => {
          const h = /^(#{1,6})\s+(.*)/.exec(s);
          return (
            <div key={i} className={h ? "canvas-md-heading" : ""}>
              {(h?.[2] || s)
                .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
                .map((p, j) =>
                  p.startsWith("**") ? (
                    <strong key={j}>{p.slice(2, -2)}</strong>
                  ) : p.startsWith("`") ? (
                    <code key={j}>{p.slice(1, -1)}</code>
                  ) : (
                    p
                  ),
                )}
              {!s && <br />}
            </div>
          );
        })}
    </div>
  );
}
function DatabaseCard({
  config,
  onOpen,
}: {
  config: Record<string, any>;
  onOpen: (ref: string) => void;
}) {
  const [rows, setRows] = useState<any[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api("/api/workspace/bases/query", "POST", config)
      .then((result) => {
        if (active) setRows(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [config]);
  return error ? (
    <p role="alert">{error}</p>
  ) : !rows ? (
    <p>Loading saved database query…</p>
  ) : (
    <>
      <small>{rows.length} matches · table preview of first 30</small>
      <table className="canvas-base-table">
        <thead>
          <tr>
            <th>Record</th>
            <th>Tags</th>
            <th>Computed</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 30).map((row) => (
            <tr key={row.id}>
              <td>
                <button onClick={() => onOpen(row.kind + ":" + row.id)}>
                  {row.data.title || row.id}
                </button>
              </td>
              <td>{(row.data.tags || []).join(", ")}</td>
              <td>{String(row.computed ?? "—")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
function CanvasMini({ data }: { data: Record<string, any> }) {
  const nodes = (Array.isArray(data.nodes) ? data.nodes : []).slice(
    0,
    100,
  ) as CanvasNode[];
  if (!nodes.length) return <p>Empty nested canvas.</p>;
  const x = Math.min(...nodes.map((n) => n.x)),
    y = Math.min(...nodes.map((n) => n.y)),
    width = Math.max(...nodes.map((n) => n.x + n.width)) - x,
    height = Math.max(...nodes.map((n) => n.y + n.height)) - y;
  return (
    <>
      <small>Nested layout · {nodes.length} cards shown</small>
      <svg
        className="canvas-mini"
        viewBox={[x - 20, y - 20, width + 40, height + 40].join(" ")}
        aria-label="Nested canvas layout"
      >
        {nodes.map((n) => (
          <g key={n.id}>
            <rect
              x={n.x}
              y={n.y}
              width={n.width}
              height={n.height}
              fill={paint(n.color)}
              stroke="#477859"
            />
            <text x={n.x + 8} y={n.y + 20} fontSize="14">
              {(n.label || n.text || n.type).slice(0, 25)}
            </text>
          </g>
        ))}
      </svg>
    </>
  );
}
export function CanvasView({
  initialRef,
  addReference,
  onReferenceAdded,
  onOpenReference,
}: Props) {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const autoCreating = useRef(false);
  const [list, setList] = useState<CanvasObject[]>([]),
    [current, setCurrent] = useState<CanvasObject | null>(null),
    [doc, setDoc] = useState<CanvasData>(blank),
    [catalog, setCatalog] = useState<Ref[]>([]),
    [references, setReferences] = useState<Record<string, Ref>>({}),
    [selected, setSelected] = useState<string[]>([]),
    [edgeId, setEdgeId] = useState(""),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [conflict, setConflict] = useState(false),
    [readonly, setReadonly] = useState(false),
    [snap, setSnap] = useState(true),
    [pan, setPan] = useState(false),
    [refChoice, setRefChoice] = useState(""),
    [size, setSize] = useState({ width: 1000, height: 650 }),
    [marquee, setMarquee] = useState<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>(null),
    [counts, setCounts] = useState([0, 0]);
  const emptyLine = {
    id: "",
    fromNode: "",
    toNode: "",
    fromSide: "right",
    toSide: "left",
    fromEnd: "none",
    toEnd: "arrow",
    label: "",
    color: "#477859",
    classification: "annotation",
    explanation: "",
    creator: "local-researcher",
  };
  const [line, setLine] = useState(emptyLine);
  const docRef = useRef(doc),
    active = useRef(current),
    read = useRef(readonly),
    revision = useRef(0),
    saved = useRef(""),
    saving = useRef(false),
    dirty = useRef(false),
    live = useRef(true),
    token = useRef(0),
    blocked = useRef(false),
    undo = useRef<CanvasData[]>([]),
    redo = useRef<CanvasData[]>([]),
    gesture = useRef<Gesture | null>(null),
    svg = useRef<SVGSVGElement>(null),
    pointers = useRef(new Map<number, { x: number; y: number }>()),
    pinch = useRef<{
      distance: number;
      doc: CanvasData;
      center: { x: number; y: number };
    } | null>(null),
    added = useRef("");
  docRef.current = doc;
  active.current = current;
  read.current = readonly;
  blocked.current = conflict;
  const update = useCallback((next: CanvasData) => {
    docRef.current = next;
    if (!read.current) {
      dirty.current = true;
      setStatus("Unsaved canvas changes.");
    }
    setDoc(next);
  }, []);
  function commit(next: CanvasData) {
    if (read.current) return;
    undo.current.push(clone(docRef.current));
    if (undo.current.length > 100) undo.current.shift();
    redo.current = [];
    setCounts([undo.current.length, 0]);
    update(next);
  }
  function history(direction: boolean) {
    if (read.current) return;
    const from = direction ? undo.current : redo.current,
      to = direction ? redo.current : undo.current,
      next = from.pop();
    if (next) {
      to.push(clone(docRef.current));
      update(next);
      setCounts([undo.current.length, redo.current.length]);
    }
  }
  const refresh = useCallback(async () => {
    const [rows, refs] = await Promise.all([
      api("/api/canvases"),
      api("/api/workspace/catalog"),
    ]);
    if (live.current) {
      setList(rows);
      setCatalog(refs.items || []);
    }
  }, []);
  const save = useCallback(async () => {
    const row = active.current;
    if (
      !row ||
      saving.current ||
      blocked.current ||
      !dirty.current ||
      read.current ||
      gesture.current
    )
      return;
    const payload = clone(docRef.current),
      hash = JSON.stringify(payload);
    if (hash === saved.current) {
      dirty.current = false;
      return;
    }
    saving.current = true;
    setStatus("Saving canvas…");
    try {
      const result = await api("/api/canvases/" + row.id, "PUT", {
        data: payload,
        expectedRevision: revision.current,
      });
      if (!live.current || active.current?.id !== row.id) return;
      revision.current = result.revision;
      saved.current = hash;
      dirty.current = JSON.stringify(docRef.current) !== hash;
      setCurrent(result);
      setError("");
      setStatus(dirty.current ? "Changes waiting to save." : "Saved locally.");
      void refresh();
    } catch (e) {
      if (live.current && active.current?.id === row.id) {
        setError((e as Error).message);
        if ((e as { status?: number }).status === 409) {
          setConflict(true);
          blocked.current = true;
        }
        setStatus("Your unsaved draft remains in this view.");
      }
    } finally {
      saving.current = false;
    }
  }, [refresh]);
  async function open(id: string, discard = false) {
    if (dirty.current && !discard) {
      setError("Save or export your current draft before switching canvases.");
      return;
    }
    const request = ++token.current;
    setLoading(true);
    try {
      const row = await api("/api/canvases/" + id);
      if (!live.current || request !== token.current) return;
      revision.current = row.revision;
      saved.current = JSON.stringify(row.data);
      dirty.current = false;
      active.current = row;
      docRef.current = row.data;
      setCurrent(row);
      setDoc(row.data);
      setSelected([]);
      setEdgeId("");
      setConflict(false);
      blocked.current = false;
      setError("");
      undo.current = [];
      redo.current = [];
      setCounts([0, 0]);
      setStatus("Canvas loaded.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (live.current && request === token.current) setLoading(false);
    }
  }
  async function create() {
    try {
      await save();
      if (dirty.current) return;
      setLoading(true);
      const row = await api("/api/canvases", "POST", { data: blank() });
      await refresh();
      await open(row.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (live.current) setLoading(false);
    }
  }
  useEffect(() => {
    live.current = true;
    Promise.all([api("/api/canvases"), api("/api/workspace/catalog")])
      .then(async ([rows, refs]) => {
        if (!live.current) return;
        setList(rows);
        setCatalog(refs.items || []);
        if (initialRef?.startsWith("canvas:")) await open(initialRef.slice(7));
        else if (rows[0]) await open(rows[0].id);
        else setLoading(false);
        if (live.current) setReady(true);
      })
      .catch((e) => { if (live.current) { setError(e.message); setLoading(false); } });
    return () => {
      live.current = false;
      token.current++;
    };
  }, []);
  useEffect(() => {
    if (
      initialRef?.startsWith("canvas:") &&
      active.current?.id !== initialRef.slice(7)
    )
      void open(initialRef.replace(/^canvas:/, ""));
  }, [initialRef]);
  useEffect(() => {
    if (!current || readonly || conflict) return;
    const timer = setTimeout(() => void save(), 600);
    return () => clearTimeout(timer);
  }, [doc, current, readonly, conflict, save]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  useEffect(() => {
    let valid = true;
    for (const ref of [
      ...new Set(
        [
          ...doc.nodes.map((n) => n.sourcewatchRef),
          ...doc.edges
            .map((e) => e.sourcewatch?.relationshipRef)
            .filter((r) => typeof r === "string"),
        ].filter(Boolean),
      ),
    ] as string[])
      if (!references[ref])
        api("/api/workspace/resolve?ref=" + encodeURIComponent(ref))
          .then((data) => {
            if (valid) setReferences((old) => ({ ...old, [ref]: data }));
          })
          .catch(() => {});
    return () => {
      valid = false;
    };
  }, [doc.nodes, doc.edges, references]);
  function zoomAt(factor: number, x = size.width / 2, y = size.height / 2) {
    const old = docRef.current,
      v = old.viewport,
      z = Math.max(0.05, Math.min(5, v.zoom * factor));
    update({
      ...old,
      viewport: {
        ...v,
        x: x - ((x - v.x) * z) / v.zoom,
        y: y - ((y - v.y) * z) / v.zoom,
        zoom: z,
      },
    });
  }
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0].contentRect;
      setSize({ width: box.width, height: box.height });
    });
    observer.observe(el);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(
        Math.exp(-e.deltaY * 0.0015),
        e.clientX - r.left,
        e.clientY - r.top,
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, [current?.id, loading]);
  function add(type: CanvasNode["type"], ref?: string) {
    const v = docRef.current.viewport,
      node: CanvasNode = {
        id: uid(),
        type,
        x: Math.round((size.width / 2 - v.x) / v.zoom / 20) * 20,
        y: Math.round((size.height / 2 - v.y) / v.zoom / 20) * 20,
        width: type === "group" ? 640 : 300,
        height: type === "group" ? 420 : 220,
      };
    if (type === "text") node.text = "# Research card\nWrite your notes here.";
    if (type === "group") {
      node.label = "Research group";
      node.color = "4";
    }
    if (type === "link") node.url = "https://example.com/";
    if (type === "file") {
      node.file = ref?.startsWith("attachment:")
        ? "attachments/" + ref.slice(11)
        : "notes/" + (ref?.split(":")[1] || "unresolved") + ".md";
      if (ref) node.sourcewatchRef = ref;
    }
    commit({ ...docRef.current, nodes: [...docRef.current.nodes, node] });
    setEdgeId("");
    setSelected([node.id]);
  }
  useEffect(() => {
    if (
      addReference &&
      current &&
      !readonly &&
      added.current !== addReference
    ) {
      added.current = addReference;
      add("file", addReference);
      onReferenceAdded?.();
    }
  }, [addReference, current?.id, readonly]);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("sourcewatch-dirty", {
        detail: { kind: "canvas", dirty: dirty.current },
      }),
    );
  }, [doc, current, status, conflict]);
  useEffect(() => {
    if (!addReference) {
      added.current = "";
      return;
    }
    if (ready && !current && list.length === 0 && !readonly && !autoCreating.current) {
      autoCreating.current = true;
      void create().finally(() => {
        autoCreating.current = false;
      });
    }
  }, [addReference, ready, current?.id, readonly, list.length]);
  function remove() {
    const ids = new Set(selected);
    commit({
      ...docRef.current,
      nodes: docRef.current.nodes.filter((n) => !ids.has(n.id)),
      edges: docRef.current.edges.filter(
        (e) => !ids.has(e.fromNode) && !ids.has(e.toNode) && e.id !== edgeId,
      ),
    });
    setSelected([]);
    setEdgeId("");
  }
  function duplicate() {
    const ids = new Map(selected.map((id) => [id, uid()])),
      nodes = docRef.current.nodes
        .filter((n) => ids.has(n.id))
        .map((n) => ({
          ...clone(n),
          id: ids.get(n.id)!,
          x: n.x + 40,
          y: n.y + 40,
        })),
      edges = docRef.current.edges
        .filter((e) => ids.has(e.fromNode) && ids.has(e.toNode))
        .map((e) => ({
          ...clone(e),
          id: uid(),
          fromNode: ids.get(e.fromNode)!,
          toNode: ids.get(e.toNode)!,
        }));
    commit({
      ...docRef.current,
      nodes: [...docRef.current.nodes, ...nodes],
      edges: [...docRef.current.edges, ...edges],
    });
    setEdgeId("");
    setSelected(nodes.map((n) => n.id));
  }
  function arrange(action: string) {
    const nodes = docRef.current.nodes.filter((n) => selected.includes(n.id));
    if (nodes.length < 2) return;
    const left = Math.min(...nodes.map((n) => n.x)),
      top = Math.min(...nodes.map((n) => n.y)),
      right = Math.max(...nodes.map((n) => n.x + n.width)),
      bottom = Math.max(...nodes.map((n) => n.y + n.height)),
      sorted = [...nodes].sort((a, b) =>
        action === "distribute-y" ? a.y - b.y : a.x - b.x,
      ),
      changes = new Map(nodes.map((n) => [n.id, { ...n }]));
    let cursorX = left,
      cursorY = top;
    const gapX =
        (right - left - sorted.reduce((sum, n) => sum + n.width, 0)) /
        (sorted.length - 1),
      gapY =
        (bottom - top - sorted.reduce((sum, n) => sum + n.height, 0)) /
        (sorted.length - 1);
    for (const n of sorted) {
      const next = changes.get(n.id)!;
      if (action === "left") next.x = left;
      if (action === "top") next.y = top;
      if (action === "center-x") next.x = (left + right - n.width) / 2;
      if (action === "center-y") next.y = (top + bottom - n.height) / 2;
      if (action === "distribute-x") {
        next.x = cursorX;
        cursorX += n.width + gapX;
      }
      if (action === "distribute-y") {
        next.y = cursorY;
        cursorY += n.height + gapY;
      }
    }
    commit({
      ...docRef.current,
      nodes: docRef.current.nodes.map((n) => {
        const updated = changes.get(n.id);
        return updated
          ? { ...updated, x: Math.round(updated.x), y: Math.round(updated.y) }
          : n;
      }),
    });
  }
  function fit() {
    const ns = docRef.current.nodes;
    if (!ns.length) {
      update({ ...docRef.current, viewport: { x: 40, y: 40, zoom: 1 } });
      return;
    }
    const x = Math.min(...ns.map((n) => n.x)),
      y = Math.min(...ns.map((n) => n.y)),
      w = Math.max(...ns.map((n) => n.x + n.width)) - x,
      h = Math.max(...ns.map((n) => n.y + n.height)) - y,
      z = Math.min(
        2,
        Math.max(0.05, Math.min((size.width - 80) / w, (size.height - 80) / h)),
      );
    update({
      ...docRef.current,
      viewport: {
        x: (size.width - w * z) / 2 - x * z,
        y: (size.height - h * z) / 2 - y * z,
        zoom: z,
      },
    });
  }
  function point(e: { clientX: number; clientY: number }) {
    const r = svg.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function world(p: { x: number; y: number }, data = docRef.current) {
    return {
      x: (p.x - data.viewport.x) / data.viewport.zoom,
      y: (p.y - data.viewport.y) / data.viewport.zoom,
    };
  }
  function down(
    e: React.PointerEvent<SVGElement>,
    id?: string,
    resize = false,
  ) {
    if (e.button !== 0 && e.button !== 1) return;
    const p = point(e);
    pointers.current.set(e.pointerId, p);
    svg.current?.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        doc: clone(docRef.current),
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      gesture.current = null;
      return;
    }
    const original = clone(docRef.current);
    if (id && !pan && !readonly) {
      e.stopPropagation();
      let ids = e.shiftKey
        ? selected.includes(id)
          ? selected.filter((v) => v !== id)
          : [...selected, id]
        : selected.includes(id)
          ? selected
          : [id];
      const region = original.nodes.find((n) => n.id === id);
      if (resize) ids = [id];
      else if (region?.type === "group")
        ids = [
          ...new Set([
            ...ids,
            ...original.nodes
              .filter(
                (n) =>
                  n.id !== id &&
                  n.x >= region.x &&
                  n.y >= region.y &&
                  n.x + n.width <= region.x + region.width &&
                  n.y + n.height <= region.y + region.height,
              )
              .map((n) => n.id),
          ]),
        ];
      setSelected(ids);
      setEdgeId("");
      gesture.current = {
        type: resize ? "resize" : "move",
        start: world(p),
        original,
        ids,
      };
    } else {
      gesture.current = {
        type:
          pan || e.button === 1 || e.pointerType === "touch" ? "pan" : "select",
        start: p,
        original,
        ids: [],
      };
      if (gesture.current.type === "select" && !e.shiftKey) setSelected([]);
    }
  }
  function move(e: React.PointerEvent<SVGSVGElement>) {
    const p = point(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()],
        s = pinch.current,
        z = Math.max(
          0.05,
          Math.min(
            5,
            (s.doc.viewport.zoom * Math.hypot(a.x - b.x, a.y - b.y)) /
              s.distance,
          ),
        ),
        c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      update({
        ...docRef.current,
        viewport: {
          x: c.x - ((s.center.x - s.doc.viewport.x) * z) / s.doc.viewport.zoom,
          y: c.y - ((s.center.y - s.doc.viewport.y) * z) / s.doc.viewport.zoom,
          zoom: z,
        },
      });
      return;
    }
    const g = gesture.current;
    if (!g) return;
    if (g.type === "pan") {
      update({
        ...g.original,
        viewport: {
          ...g.original.viewport,
          x: g.original.viewport.x + p.x - g.start.x,
          y: g.original.viewport.y + p.y - g.start.y,
        },
      });
      return;
    }
    if (g.type === "select") {
      const a = world(g.start),
        b = world(p);
      setMarquee({
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x),
        height: Math.abs(a.y - b.y),
      });
      setSelected(
        g.original.nodes
          .filter(
            (n) =>
              n.x < Math.max(a.x, b.x) &&
              n.x + n.width > Math.min(a.x, b.x) &&
              n.y < Math.max(a.y, b.y) &&
              n.y + n.height > Math.min(a.y, b.y),
          )
          .map((n) => n.id),
      );
      return;
    }
    const pos = world(p, g.original),
      dx = pos.x - g.start.x,
      dy = pos.y - g.start.y,
      round = (n: number) => (snap ? Math.round(n / 20) * 20 : Math.round(n));
    update({
      ...g.original,
      nodes: g.original.nodes.map((n) =>
        !g.ids.includes(n.id)
          ? n
          : g.type === "resize"
            ? {
                ...n,
                width: Math.max(80, round(n.width + dx)),
                height: Math.max(60, round(n.height + dy)),
              }
            : { ...n, x: round(n.x + dx), y: round(n.y + dy) },
      ),
    });
  }
  function up(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const g = gesture.current;
    if (
      g &&
      (g.type === "move" || g.type === "resize") &&
      JSON.stringify(g.original) !== JSON.stringify(docRef.current)
    ) {
      undo.current.push(g.original);
      redo.current = [];
      setCounts([undo.current.length, 0]);
    }
    gesture.current = null;
    setMarquee(null);
    if (svg.current?.hasPointerCapture(e.pointerId))
      svg.current.releasePointerCapture(e.pointerId);
    void save();
  }
  const selectedNode = doc.nodes.find(
    (n) => selected.length === 1 && n.id === selected[0],
  );
  function changeNode(change: Partial<CanvasNode>) {
    if (selectedNode)
      commit({
        ...docRef.current,
        nodes: docRef.current.nodes.map((n) =>
          n.id === selectedNode.id ? { ...n, ...change } : n,
        ),
      });
  }
  function selectEdge(e: CanvasEdge) {
    setEdgeId(e.id);
    setSelected([]);
    setLine({
      id: e.id,
      fromNode: e.fromNode,
      toNode: e.toNode,
      fromSide: e.fromSide || "right",
      toSide: e.toSide || "left",
      fromEnd: e.fromEnd || "none",
      toEnd: e.toEnd || "arrow",
      label: e.label || "",
      color: e.color?.startsWith("#") ? e.color : "#477859",
      classification: e.sourcewatch?.classification || "annotation",
      explanation: e.sourcewatch?.explanation || "",
      creator: e.sourcewatch?.creator || "local-researcher",
    });
  }
  function endpoint(n: CanvasNode, s?: string) {
    return s === "top"
      ? { x: n.x + n.width / 2, y: n.y }
      : s === "bottom"
        ? { x: n.x + n.width / 2, y: n.y + n.height }
        : s === "left"
          ? { x: n.x, y: n.y + n.height / 2 }
          : { x: n.x + n.width, y: n.y + n.height / 2 };
  }
  async function imageExport(format: "svg" | "png") {
    try {
      if (!svg.current) return;
      const copy = svg.current.cloneNode(true) as SVGSVGElement;
      copy.querySelectorAll(".canvas-ui-only").forEach((n) => n.remove());
      copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      for (const el of Array.from(copy.querySelectorAll("img"))) {
        const src = el.getAttribute("src");
        if (!src?.startsWith("/api/")) {
          el.remove();
          continue;
        }
        const blob = await (await fetch(src)).blob();
        const data = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
        el.setAttribute("src", data);
      }
      copy.querySelectorAll("iframe,video,audio").forEach((n) => n.remove());
      const style = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "style",
      );
      style.textContent =
        ".canvas-card-content{font:14px Arial;color:#203d30;overflow:hidden;padding:12px;box-sizing:border-box;height:100%;overflow-wrap:anywhere}.canvas-md-heading{font-weight:bold}.canvas-card-content img{max-width:100%;max-height:100%}.canvas-label,.canvas-card-header{font:13px Arial;fill:#203d30}";
      copy.prepend(style);
      const xml = new XMLSerializer().serializeToString(copy),
        blob = new Blob([xml], { type: "image/svg+xml" });
      if (format === "svg") {
        download(blob, "canvas-view.svg");
        return;
      }
      const img = new Image();
      img.src =
        "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(4096, Math.round(size.width * 2));
      canvas.height = Math.min(4096, Math.round(size.height * 2));
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#f5f6ef";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const png = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("PNG export failed"))),
          "image/png",
        ),
      );
      download(png, "canvas-view.png");
    } catch (e) {
      setError("Image export: " + (e as Error).message);
    }
  }
  const reviewEdge = doc.edges.find((e) => e.id === line.id);
  const lineDraftChanged =
    !!reviewEdge &&
    (line.fromNode !== reviewEdge.fromNode ||
      line.toNode !== reviewEdge.toNode ||
      line.label !== (reviewEdge.label || "") ||
      line.explanation !== (reviewEdge.sourcewatch?.explanation || "") ||
      line.creator !== (reviewEdge.sourcewatch?.creator || "local-researcher"));
  const reviewRef = reviewEdge?.sourcewatch?.relationshipRef;
  const canPropose =
    !!reviewEdge &&
    [reviewEdge.fromNode, reviewEdge.toNode].every(
      (id) => !!doc.nodes.find((n) => n.id === id)?.sourcewatchRef,
    );
  const [proposing, setProposing] = useState(false);
  async function propose() {
    const row = active.current;
    if (!row || !reviewEdge || dirty.current || saving.current || readonly)
      return;
    setProposing(true);
    try {
      const result = await api(
        "/api/workspace/canvas/" + row.id + "/propose/" + reviewEdge.id,
        "POST",
        {
          expectedRevision: revision.current,
          creator: line.creator,
          explanation: line.explanation,
        },
      );
      if (!live.current || active.current?.id !== row.id) return;
      revision.current = result.canvas.revision;
      saved.current = JSON.stringify(result.canvas.data);
      dirty.current = false;
      docRef.current = result.canvas.data;
      setDoc(result.canvas.data);
      setCurrent(result.canvas);
      setStatus("Proposed for explicit evidence review; not verified.");
      onOpenReference(result.relationshipRef);
    } catch (e) {
      setError((e as Error).message);
      if ((e as { status?: number }).status === 409) setConflict(true);
    } finally {
      setProposing(false);
    }
  }
  function card(n: CanvasNode) {
    const ref = references[n.sourcewatchRef || ""],
      data = ref?.data || {},
      local = ref?.url?.startsWith("/api/workspace/attachments/")
        ? ref.url
        : undefined;
    return (
      <div
        className="canvas-card-content"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {n.type === "text" ? (
          <Markdown text={n.text || ""} />
        ) : n.type === "link" ? (
          <>
            <h4>Website reference</h4>
            <a href={safeHref(n.url)} target="_blank" rel="noreferrer">
              {n.url}
            </a>
            <p>URL only. No external webpage is loaded.</p>
          </>
        ) : (
          <>
            <h4>{ref?.title || n.label || n.sourcewatchRef || n.file}</h4>
            {ref?.kind === "note" ? (
              <Markdown text={String(data.body || "").slice(0, 12000)} />
            ) : ref?.kind === "capture" ? (
              <img
                src={"/api/captures/" + ref.captureId + "/files/screenshot.png"}
                alt="Preserved capture"
              />
            ) : ref?.kind === "attachment" && local ? (
              ref.mime?.startsWith("image/") ? (
                <img src={local} alt={ref.title} />
              ) : ref.mime?.startsWith("audio/") ? (
                <audio controls preload="none" src={local} />
              ) : ref.mime?.startsWith("video/") ? (
                <video controls preload="none" src={local} />
              ) : ref.mime === "application/pdf" ? (
                <PDFPreview title={ref.title} url={local} />
              ) : (
                <p>Attachment reference.</p>
              )
            ) : ref?.kind === "canvas" ? (
              <CanvasMini data={data} />
            ) : ref?.kind === "base" ? (
              <DatabaseCard config={data} onOpen={onOpenReference} />
            ) : (
              <p>
                {n.sourcewatchRef
                  ? "Workspace reference"
                  : "Imported relative file. No host file is accessed."}
              </p>
            )}
            {n.sourcewatchRef && (
              <button
                onClick={() =>
                  n.sourcewatchRef?.startsWith("canvas:")
                    ? void open(n.sourcewatchRef.slice(7))
                    : onOpenReference(n.sourcewatchRef!)
                }
              >
                Open referenced record
              </button>
            )}
          </>
        )}
      </div>
    );
  }
  if (loading) return <section className="canvas-workspace" aria-label="Canvas workspace" aria-busy="true"><h2>Canvas</h2><p role="status">Loading saved canvases…</p></section>;
  return (
    <section
      className="canvas-workspace"
      aria-label="Canvas workspace"
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("input,textarea,select")) return;
        const key = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && key === "z") {
          e.preventDefault();
          history(!e.shiftKey);
        }
        if ((e.ctrlKey || e.metaKey) && key === "y") {
          e.preventDefault();
          history(false);
        }
        if ((e.ctrlKey || e.metaKey) && key === "a") {
          e.preventDefault();
          setSelected(doc.nodes.map((n) => n.id));
        }
        if ((e.ctrlKey || e.metaKey) && key === "d") {
          e.preventDefault();
          duplicate();
        }
        if ((e.ctrlKey || e.metaKey) && key === "s") {
          e.preventDefault();
          void save();
        }
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          remove();
        }
        if (e.key === "Escape") {
          setSelected([]);
          setEdgeId("");
        }
        if (
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
          selected.length
        ) {
          e.preventDefault();
          const a = e.shiftKey ? 100 : snap ? 20 : 1;
          commit({
            ...docRef.current,
            nodes: docRef.current.nodes.map((n) =>
              selected.includes(n.id)
                ? {
                    ...n,
                    x:
                      n.x +
                      (e.key === "ArrowLeft"
                        ? -a
                        : e.key === "ArrowRight"
                          ? a
                          : 0),
                    y:
                      n.y +
                      (e.key === "ArrowUp"
                        ? -a
                        : e.key === "ArrowDown"
                          ? a
                          : 0),
                  }
                : n,
            ),
          });
        }
      }}
    >
      <div className="canvas-heading">
        <div>
          <div className="eyebrow">VISUAL RESEARCH WORKSPACE</div>
          <h2>Canvas</h2>
          <p>
            Canvas connections are annotations or hypotheses, never verified
            factual relationships.
          </p>
        </div>
        <div className="canvas-actions">
          <button onClick={() => void create()}>+ New canvas</button>
          <button
            onClick={() => {
              setReferences({});
              void refresh();
            }}
          >
            Refresh embedded records
          </button>
          <label className="canvas-import">
            Import .canvas
            <input
              type="file"
              accept=".canvas,application/json"
              onChange={async (e) => {
                const input = e.currentTarget,
                  file = input.files?.[0];
                if (!file) return;
                try {
                  if (file.size > 4 * 1024 * 1024)
                    throw new Error("Import exceeds 4 MiB");
                  await save();
                  if (dirty.current)
                    throw new Error("Save or export the current draft first");
                  const row = await api("/api/canvases/import", "POST", {
                    data: JSON.parse(await file.text()),
                  });
                  await refresh();
                  await open(row.id);
                  setStatus(
                    (row.warnings || []).join(" ") || "Canvas imported.",
                  );
                } catch (error) {
                  setError((error as Error).message);
                }
                input.value = "";
              }}
            />
          </label>
        </div>
      </div>
      <div className="canvas-toolbar">
        <label>
          Canvas
          <select
            aria-label="Choose canvas"
            value={current?.id || ""}
            onChange={(e) => void open(e.target.value)}
          >
            <option value="">Choose canvas</option>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.data.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input
            aria-label="Canvas title"
            disabled={!current || readonly}
            maxLength={200}
            value={doc.title}
            onChange={(e) => commit({ ...doc, title: e.target.value })}
          />
        </label>
        <label className="canvas-check">
          <input
            type="checkbox"
            checked={readonly}
            onChange={(e) => {
              if (e.target.checked && dirty.current) {
                setError("Save your draft before entering read-only mode.");
                return;
              }
              setReadonly(e.target.checked);
            }}
          />
          Read-only
        </label>
        <button
          disabled={!current || readonly || conflict}
          onClick={() => void save()}
        >
          Save now
        </button>
        <button
          disabled={!current}
          onClick={() =>
            download(
              new Blob([JSON.stringify(doc, null, 2)], {
                type: "application/json",
              }),
              "sourcewatch.canvas",
            )
          }
        >
          Export .canvas draft
        </button>
        <button disabled={!current} onClick={() => void imageExport("svg")}>
          Export SVG view
        </button>
        <button disabled={!current} onClick={() => void imageExport("png")}>
          Export PNG view
        </button>
      </div>
      {error && (
        <p role="alert" className="capture-error">
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
      {conflict && (
        <div className="canvas-conflict">
          <strong>Another view changed this canvas.</strong> Your draft remains
          here. Export it before reloading.
          <button onClick={() => void open(current!.id, true)}>
            Discard draft and reload server version
          </button>
        </div>
      )}
      {!current ? (
        <div className="empty">
          <h3>A place to organize the evidence.</h3>
          <p>Create a canvas or import an open JSON Canvas file.</p>
        </div>
      ) : (
        <>
          <div className="canvas-toolbar">
            <button disabled={readonly} onClick={() => add("text")}>
              + Markdown card
            </button>
            <button disabled={readonly} onClick={() => add("link")}>
              + Website card
            </button>
            <button disabled={readonly} onClick={() => add("group")}>
              + Group
            </button>
            <select
              aria-label="Workspace record to embed"
              value={refChoice}
              onChange={(e) => setRefChoice(e.target.value)}
            >
              <option value="">Choose workspace record</option>
              {catalog.map((r) => (
                <option key={r.ref} value={r.ref}>
                  {r.kind}: {r.title}
                </option>
              ))}
            </select>
            <button
              disabled={readonly || !refChoice}
              onClick={() => add("file", refChoice)}
            >
              Embed record
            </button>
            <button
              disabled={readonly || !counts[0]}
              onClick={() => history(true)}
            >
              Undo
            </button>
            <button
              disabled={readonly || !counts[1]}
              onClick={() => history(false)}
            >
              Redo
            </button>
            <button disabled={readonly || !selected.length} onClick={duplicate}>
              Duplicate selected
            </button>
            <button
              disabled={readonly || (!selected.length && !edgeId)}
              onClick={remove}
            >
              Delete selected cards / line
            </button>
          </div>
          <div className="canvas-toolbar">
            <button aria-pressed={!pan} onClick={() => setPan(false)}>
              Select / drag
            </button>
            <button aria-pressed={pan} onClick={() => setPan(true)}>
              Pan
            </button>
            <button onClick={() => zoomAt(1 / 1.2)} aria-label="Zoom out">
              −
            </button>
            <span>{Math.round(doc.viewport.zoom * 100)}%</span>
            <button onClick={() => zoomAt(1.2)} aria-label="Zoom in">
              +
            </button>
            <button onClick={fit}>Fit cards</button>
            <label className="canvas-check">
              <input
                type="checkbox"
                checked={snap}
                onChange={(e) => setSnap(e.target.checked)}
              />
              Snap to 20px grid
            </label>
            <span>
              {selected.length} selected · Shift-click / drag blank space to
              multiselect. Touch blank space to pan; pinch to zoom.
            </span>
          </div>
          <div className="canvas-layout">
            <div className="canvas-surface-wrap">
              <svg
                ref={svg}
                className="canvas-surface"
                viewBox={`0 0 ${size.width} ${size.height}`}
                tabIndex={0}
                role="application"
                aria-label="Interactive canvas. Arrow keys move selected cards. Control Z undoes. Delete removes only cards."
                onPointerDown={(e) => down(e)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (readonly) return;
                  const ref =
                    e.dataTransfer.getData("text/sourcewatch-ref") ||
                    e.dataTransfer.getData("text/plain");
                  if (catalog.some((r) => r.ref === ref)) add("file", ref);
                  else
                    setError(
                      "Drop a known workspace reference; use Import for .canvas files.",
                    );
                }}
              >
                <defs>
                  <pattern
                    id="canvas-grid"
                    width="20"
                    height="20"
                    patternUnits="userSpaceOnUse"
                  >
                    <circle cx="1" cy="1" r="1" fill="#d2ddce" />
                  </pattern>
                  <marker
                    id="canvas-arrow"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto-start-reverse"
                  >
                    <path d="M0,0 L8,4 L0,8 Z" fill="#477859" />
                  </marker>
                </defs>
                <rect width="100%" height="100%" fill="#f5f6ef" />
                <g
                  transform={`translate(${doc.viewport.x} ${doc.viewport.y}) scale(${doc.viewport.zoom})`}
                >
                  <rect
                    x="-100000"
                    y="-100000"
                    width="200000"
                    height="200000"
                    fill="url(#canvas-grid)"
                  />
                  {doc.nodes
                    .filter((n) => n.type === "group")
                    .map((n) => (
                      <g key={n.id} onPointerDown={(e) => down(e, n.id)}>
                        <rect
                          x={n.x}
                          y={n.y}
                          width={n.width}
                          height={n.height}
                          rx="12"
                          fill={paint(n.color)}
                          fillOpacity=".45"
                          stroke={
                            selected.includes(n.id) ? "#275a46" : "#a7b9a0"
                          }
                          strokeWidth={selected.includes(n.id) ? 3 : 1}
                        />
                        <text
                          className="canvas-card-header"
                          x={n.x + 12}
                          y={n.y + 22}
                        >
                          {n.label || "Group"}
                        </text>
                        {selected.includes(n.id) && !readonly && (
                          <rect
                            className="canvas-resize canvas-ui-only"
                            x={n.x + n.width - 15}
                            y={n.y + n.height - 15}
                            width="15"
                            height="15"
                            onPointerDown={(e) => down(e, n.id, true)}
                          />
                        )}
                      </g>
                    ))}
                  {doc.edges.map((edge) => {
                    const a = doc.nodes.find((n) => n.id === edge.fromNode),
                      b = doc.nodes.find((n) => n.id === edge.toNode);
                    if (!a || !b) return null;
                    const relationRef = edge.sourcewatch?.relationshipRef;
                    const reviewed =
                      typeof relationRef === "string" &&
                      references[relationRef]?.classification === "verified";
                    const start = endpoint(a, edge.fromSide),
                      end = endpoint(b, edge.toSide);
                    return (
                      <g
                        key={edge.id}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          selectEdge(edge);
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={
                          "Connection: " +
                          (edge.label ||
                            edge.sourcewatch?.classification ||
                            "annotation")
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") selectEdge(edge);
                        }}
                      >
                        <line
                          x1={start.x}
                          y1={start.y}
                          x2={end.x}
                          y2={end.y}
                          stroke={
                            reviewed
                              ? "#176c9a"
                              : paint(edge.color || "#477859")
                          }
                          strokeDasharray={
                            !reviewed &&
                            edge.sourcewatch?.classification === "hypothesis"
                              ? "7 4"
                              : undefined
                          }
                          strokeWidth={edgeId === edge.id ? 5 : 2}
                          markerStart={
                            edge.fromEnd === "arrow"
                              ? "url(#canvas-arrow)"
                              : undefined
                          }
                          markerEnd={
                            edge.toEnd === "none"
                              ? undefined
                              : "url(#canvas-arrow)"
                          }
                        />
                        <line
                          x1={start.x}
                          y1={start.y}
                          x2={end.x}
                          y2={end.y}
                          stroke="transparent"
                          strokeWidth="18"
                        />
                        <text
                          className="canvas-label"
                          x={(start.x + end.x) / 2}
                          y={(start.y + end.y) / 2 - 7}
                        >
                          {edge.label || edge.sourcewatch?.classification}
                        </text>
                      </g>
                    );
                  })}
                  {doc.nodes
                    .filter((n) => n.type !== "group")
                    .map((n) => (
                      <g
                        key={n.id}
                        tabIndex={0}
                        role="group"
                        aria-label={
                          "Canvas card: " +
                          (n.label ||
                            n.text?.slice(0, 60) ||
                            references[n.sourcewatchRef || ""]?.title ||
                            n.file ||
                            n.url)
                        }
                        onFocus={() => setSelected([n.id])}
                      >
                        <rect
                          x={n.x}
                          y={n.y}
                          width={n.width}
                          height={n.height}
                          rx="8"
                          fill={paint(n.color)}
                          stroke={
                            selected.includes(n.id) ? "#275a46" : "#9fb098"
                          }
                          strokeWidth={selected.includes(n.id) ? 3 : 1}
                        />
                        <rect
                          className="canvas-drag-handle"
                          x={n.x}
                          y={n.y}
                          width={n.width}
                          height="30"
                          rx="8"
                          fill="#e5eddf"
                          onPointerDown={(e) => down(e, n.id)}
                        />
                        <text
                          pointerEvents="none"
                          className="canvas-card-header"
                          x={n.x + 10}
                          y={n.y + 20}
                        >
                          {n.type === "text"
                            ? "Markdown"
                            : n.type === "link"
                              ? "Website reference"
                              : references[n.sourcewatchRef || ""]?.kind ||
                                "Workspace record"}{" "}
                          · drag header
                        </text>
                        <foreignObject
                          x={n.x}
                          y={n.y + 30}
                          width={n.width}
                          height={Math.max(1, n.height - 30)}
                        >
                          {card(n)}
                        </foreignObject>
                        {selected.includes(n.id) && !readonly && (
                          <rect
                            className="canvas-resize canvas-ui-only"
                            x={n.x + n.width - 15}
                            y={n.y + n.height - 15}
                            width="15"
                            height="15"
                            onPointerDown={(e) => down(e, n.id, true)}
                          />
                        )}
                      </g>
                    ))}
                  {marquee && (
                    <rect
                      className="canvas-ui-only"
                      x={marquee.x}
                      y={marquee.y}
                      width={marquee.width}
                      height={marquee.height}
                      fill="#275a46"
                      fillOpacity=".1"
                      stroke="#275a46"
                    />
                  )}
                </g>
              </svg>
            </div>
            <aside className="canvas-properties">
              <h3>Card and layout</h3>
              <label>
                Selected cards
                <select
                  multiple
                  aria-label="Selected canvas cards"
                  value={selected}
                  onChange={(e) =>
                    setSelected(
                      Array.from(e.target.selectedOptions).map((o) => o.value),
                    )
                  }
                >
                  {doc.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label ||
                        n.text?.slice(0, 40) ||
                        references[n.sourcewatchRef || ""]?.title ||
                        n.file ||
                        n.type}
                    </option>
                  ))}
                </select>
              </label>
              {selectedNode && (
                <>
                  <label>
                    Card label
                    <input
                      disabled={readonly}
                      maxLength={2000}
                      value={selectedNode.label || ""}
                      onChange={(e) => changeNode({ label: e.target.value })}
                    />
                  </label>
                  {selectedNode.type === "text" && (
                    <label>
                      Markdown card text
                      <textarea
                        disabled={readonly}
                        rows={8}
                        aria-label="Markdown card text"
                        value={selectedNode.text || ""}
                        onChange={(e) => changeNode({ text: e.target.value })}
                      />
                    </label>
                  )}
                  {selectedNode.type === "link" && (
                    <label>
                      Website URL
                      <input
                        disabled={readonly}
                        type="url"
                        aria-label="Website URL"
                        value={selectedNode.url || ""}
                        onChange={(e) => changeNode({ url: e.target.value })}
                      />
                    </label>
                  )}
                  {(["x", "y", "width", "height"] as const).map((key) => (
                    <label key={key}>
                      {key}
                      <input
                        aria-label={"Card " + key}
                        disabled={readonly}
                        type="number"
                        value={selectedNode[key]}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          if (
                            Number.isFinite(value) &&
                            (!["width", "height"].includes(key) || value >= 32)
                          )
                            changeNode({ [key]: Math.round(value) });
                        }}
                      />
                    </label>
                  ))}
                </>
              )}
              <label>
                Selected card / group color
                <input
                  aria-label="Card color"
                  type="color"
                  disabled={readonly || !selected.length}
                  value={
                    selectedNode?.color?.startsWith("#")
                      ? selectedNode.color
                      : "#fffef9"
                  }
                  onChange={(e) =>
                    commit({
                      ...doc,
                      nodes: doc.nodes.map((n) =>
                        selected.includes(n.id)
                          ? { ...n, color: e.target.value }
                          : n,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Align / distribute
                <select
                  aria-label="Align selected cards"
                  disabled={readonly || selected.length < 2}
                  defaultValue=""
                  onChange={(e) => {
                    arrange(e.target.value);
                    e.target.value = "";
                  }}
                >
                  <option value="">Choose action</option>
                  {[
                    "left",
                    "top",
                    "center-x",
                    "center-y",
                    "distribute-x",
                    "distribute-y",
                  ].map((action) => (
                    <option key={action}>{action}</option>
                  ))}
                </select>
              </label>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (readonly) return;
                  const old = doc.edges.find((edge) => edge.id === line.id),
                    edge: CanvasEdge = {
                      ...old,
                      id: old?.id || uid(),
                      fromNode: line.fromNode,
                      toNode: line.toNode,
                      fromSide: line.fromSide,
                      toSide: line.toSide,
                      fromEnd: line.fromEnd as "none" | "arrow",
                      toEnd: line.toEnd as "none" | "arrow",
                      label: line.label,
                      color: line.color,
                      sourcewatch: {
                        ...old?.sourcewatch,
                        classification: line.classification as
                          "annotation" | "hypothesis",
                        creator: line.creator,
                        createdAt:
                          old?.sourcewatch?.createdAt ||
                          new Date().toISOString(),
                        explanation: line.explanation,
                      },
                    };
                  commit({
                    ...doc,
                    edges: old
                      ? doc.edges.map((e) => (e.id === edge.id ? edge : e))
                      : [...doc.edges, edge],
                  });
                  setEdgeId(edge.id);
                  setLine({ ...line, id: edge.id });
                }}
              >
                <h3>{line.id ? "Edit connection" : "Connect cards"}</h3>
                <p>
                  A researcher line does not establish a factual relationship.
                </p>
                {(["fromNode", "toNode"] as const).map((key) => (
                  <label key={key}>
                    {key === "fromNode" ? "Connection from" : "Connection to"}
                    <select
                      required
                      disabled={readonly}
                      aria-label={
                        {
                          fromNode: "Connection from",
                          toNode: "Connection to",
                          fromSide: "Start side",
                          toSide: "End side",
                          fromEnd: "Start arrow",
                          toEnd: "End arrow",
                        }[key]
                      }
                      value={line[key]}
                      onChange={(e) =>
                        setLine({ ...line, [key]: e.target.value })
                      }
                    >
                      <option value="">Choose card</option>
                      {doc.nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.label || n.text?.slice(0, 30) || n.type}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                {(["fromSide", "toSide"] as const).map((key) => (
                  <label key={key}>
                    {key === "fromSide" ? "Start side" : "End side"}
                    <select
                      disabled={readonly}
                      aria-label={
                        {
                          fromNode: "Connection from",
                          toNode: "Connection to",
                          fromSide: "Start side",
                          toSide: "End side",
                          fromEnd: "Start arrow",
                          toEnd: "End arrow",
                        }[key]
                      }
                      value={line[key]}
                      onChange={(e) =>
                        setLine({ ...line, [key]: e.target.value })
                      }
                    >
                      {["top", "right", "bottom", "left"].map((side) => (
                        <option key={side}>{side}</option>
                      ))}
                    </select>
                  </label>
                ))}
                {(["fromEnd", "toEnd"] as const).map((key) => (
                  <label key={key}>
                    {key === "fromEnd" ? "Start arrow" : "End arrow"}
                    <select
                      disabled={readonly}
                      aria-label={
                        {
                          fromNode: "Connection from",
                          toNode: "Connection to",
                          fromSide: "Start side",
                          toSide: "End side",
                          fromEnd: "Start arrow",
                          toEnd: "End arrow",
                        }[key]
                      }
                      value={line[key]}
                      onChange={(e) =>
                        setLine({ ...line, [key]: e.target.value })
                      }
                    >
                      <option>none</option>
                      <option>arrow</option>
                    </select>
                  </label>
                ))}
                <label>
                  Connection label
                  <input
                    disabled={readonly}
                    value={line.label}
                    onChange={(e) =>
                      setLine({ ...line, label: e.target.value })
                    }
                  />
                </label>
                <label>
                  Connection color
                  <input
                    disabled={readonly}
                    type="color"
                    value={line.color}
                    onChange={(e) =>
                      setLine({ ...line, color: e.target.value })
                    }
                  />
                </label>
                <label>
                  Connection classification
                  <select
                    disabled={readonly}
                    aria-label="Connection classification"
                    value={line.classification}
                    onChange={(e) =>
                      setLine({ ...line, classification: e.target.value })
                    }
                  >
                    <option>annotation</option>
                    <option>hypothesis</option>
                  </select>
                </label>
                <label>
                  Researcher / creator
                  <input
                    disabled={readonly}
                    aria-label="Researcher / creator"
                    value={line.creator}
                    maxLength={200}
                    onChange={(e) =>
                      setLine({ ...line, creator: e.target.value })
                    }
                  />
                </label>
                <label>
                  Connection explanation
                  <textarea
                    disabled={readonly}
                    rows={3}
                    aria-label="Connection explanation"
                    value={line.explanation}
                    onChange={(e) =>
                      setLine({ ...line, explanation: e.target.value })
                    }
                  />
                </label>
                <button disabled={readonly || !line.fromNode || !line.toNode}>
                  Save connection
                </button>
                {line.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setEdgeId("");
                      setLine(emptyLine);
                    }}
                  >
                    New connection
                  </button>
                )}
                {reviewEdge && (
                  <>
                    <button
                      type="button"
                      disabled={
                        readonly ||
                        dirty.current ||
                        saving.current ||
                        proposing ||
                        !canPropose ||
                        lineDraftChanged ||
                        typeof reviewRef === "string" ||
                        !line.explanation.trim() ||
                        !line.creator.trim()
                      }
                      onClick={() => void propose()}
                    >
                      Propose evidence review
                    </button>
                    <p className="small muted">
                      Save the canvas first. Both cards need workspace
                      references and an explanation. A proposal remains a
                      hypothesis until a separate evidence review.
                    </p>
                  </>
                )}
                {typeof reviewRef === "string" &&
                  /^relationship:[0-9a-f-]{36}$/.test(reviewRef) && (
                    <button
                      type="button"
                      onClick={() => onOpenReference(reviewRef)}
                    >
                      Open relationship review
                    </button>
                  )}
              </form>
              <h3>Canvas management</h3>
              <p className="small muted">
                Deleting cards removes only their placement. Underlying notes,
                sources, captures, and files are preserved.
              </p>
              <button
                disabled={readonly}
                onClick={async () => {
                  try {
                    await save();
                    if (dirty.current) return;
                    await api("/api/canvases/" + current.id, "DELETE", {
                      expectedRevision: revision.current,
                    });
                    dirty.current = false;
                    active.current = null;
                    setCurrent(null);
                    await refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Delete this canvas
              </button>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
