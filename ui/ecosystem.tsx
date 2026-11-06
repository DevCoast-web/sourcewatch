import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  EcosystemGraph,
  EcosystemNode,
  EcosystemEdge,
} from "../src/ecosystem.js";
import { initialPoints, type Point } from "./ecosystem-force.js";
import "./ecosystem.css";
const palette: Record<string, string> = {
  note: "#7862bc",
  entity: "#2d8769",
  document: "#c58c2c",
  source: "#3584b7",
  evidence: "#be5c52",
  investigation: "#b44f90",
  relationship: "#3f697a",
  canvas: "#b78652",
  board: "#777d94",
  legacy: "#7e9360",
  correction: "#a84e4e",
};
const lineColors = {
  hyperlink: "#8570b5",
  citation: "#c08031",
  annotation: "#8d9299",
  verified: "#14845e",
  membership: "#aabdb2",
};
type V = { x: number; y: number; z: number };
function readPrefs() {
  try {
    return JSON.parse(
      sessionStorage.getItem("sourcewatch-global-context") || "{}",
    );
  } catch {
    return {};
  }
}
export function GlobalGraph({
  active,
  onOpenReference,
  appearance = "light",
}: {
  appearance?: string;
  active: boolean;
  onOpenReference: (ref: string) => void;
}) {
  const prefs = useRef(readPrefs());
  const [graph, setGraph] = useState<EcosystemGraph | null>(null),
    [demo, setDemo] = useState(
      () => new URLSearchParams(location.search).get("demo") === "1",
    ),
    [error, setError] = useState(""),
    [query, setQuery] = useState(prefs.current.query || ""),
    [category, setCategory] = useState(prefs.current.category || ""),
    [edgeKind, setEdgeKind] = useState(prefs.current.edgeKind || ""),
    [orphans, setOrphans] = useState(prefs.current.orphans ?? true),
    [perspective, setPerspective] = useState(
      prefs.current.perspective || "global",
    ),
    [center, setCenter] = useState(prefs.current.center || ""),
    [depth, setDepth] = useState(prefs.current.depth || 2),
    [selected, setSelected] = useState<string>(prefs.current.selected || ""),
    [collapsed, setCollapsed] = useState<string[]>(
      prefs.current.collapsed || [],
    ),
    [colors, setColors] = useState<Record<string, string>>(() => {
      try {
        return {
          ...palette,
          ...JSON.parse(
            localStorage.getItem("sourcewatch-graph-colors") || "{}",
          ),
        };
      } catch {
        return palette;
      }
    }),
    [sizes, setSizes] = useState<Record<string, number>>(() => {
      try {
        return JSON.parse(
          localStorage.getItem("sourcewatch-graph-sizes") || "{}",
        );
      } catch {
        return {};
      }
    }),
    [scale, setScale] = useState(1),
    [points, setPoints] = useState<Record<string, Point>>({}),
    [view, setView] = useState<V>(prefs.current.view || { x: 0, y: 0, z: 1 }),
    [ticks, setTicks] = useState(0),
    [record, setRecord] = useState<any>(null),
    [layoutRevision, setLayoutRevision] = useState(0),
    [notice, setNotice] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    worker = useRef<Worker | null>(null),
    last = useRef(""),
    requestBusy = useRef(false),
    positionCache = useRef<Record<string, Point>>(
      prefs.current.positions || {},
    ),
    drag = useRef<any>(null),
    screen = useRef({ width: 1000, height: 650 }),
    needsFit = useRef(!prefs.current.view),
    drawMetrics = useRef({ frames: 0, lastMs: 0 });
  const latestContext = useRef<any>({});
  latestContext.current = {
    selected,
    view,
    query,
    category,
    edgeKind,
    perspective,
    center,
    depth,
    orphans,
    collapsed,
    positions: positionCache.current,
  };
  useEffect(
    () => () => {
      try {
        sessionStorage.setItem(
          "sourcewatch-global-context",
          JSON.stringify(latestContext.current),
        );
      } catch {
        /* Browser storage may be unavailable. */
      }
    },
    [],
  );
  useEffect(() => {
    try {
      sessionStorage.setItem(
        "sourcewatch-global-context",
        JSON.stringify({
          selected,
          view,
          query,
          category,
          edgeKind,
          perspective,
          center,
          depth,
          orphans,
          collapsed,
        }),
      );
    } catch {
      /* Storage can be disabled. */
    }
  }, [selected, view, query, category, edgeKind, perspective, center, depth]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const load = async () => {
      if (requestBusy.current) return;
      requestBusy.current = true;
      try {
        const r = await fetch(
          "/api/ecosystem?demo=" +
            demo +
            "&since=" +
            encodeURIComponent(last.current),
        );
        if (!r.ok) throw Error("Graph index could not load");
        const data = await r.json();
        if (live && !data.unchanged) {
          last.current = data.revision;
          setGraph(data);
          setError("");
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        requestBusy.current = false;
      }
    };
    last.current = "";
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [active, demo]);
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const n of graph?.nodes || []) map.set(n.ref, new Set());
    for (const e of graph?.edges || []) {
      map.get(e.from)?.add(e.to);
      map.get(e.to)?.add(e.from);
    }
    return map;
  }, [graph]);
  const filtered = useMemo(() => {
    if (!graph)
      return { nodes: [] as EcosystemNode[], edges: [] as EcosystemEdge[] };
    let allowed: Set<string> | undefined;
    if (perspective !== "global") {
      allowed = new Set(center ? [center] : []);
      let front = [...allowed];
      for (let h = 0; h < depth; h++) {
        const next: string[] = [];
        for (const ref of front)
          for (const target of adjacency.get(ref) || [])
            if (!allowed.has(target)) {
              allowed.add(target);
              next.push(target);
            }
        front = next;
      }
    }
    const nodes = graph.nodes.filter(
      (n) =>
        (!allowed || allowed.has(n.ref)) &&
        (!category || n.kind === category) &&
        (!query ||
          [n.title, ...n.tags]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase())) &&
        (orphans || n.degree > 0),
    );
    const ids = new Set(nodes.map((n) => n.ref));
    return {
      nodes,
      edges: graph.edges.filter(
        (e) =>
          ids.has(e.from) &&
          ids.has(e.to) &&
          (!edgeKind || e.kind === edgeKind),
      ),
    };
  }, [
    graph,
    perspective,
    center,
    depth,
    category,
    query,
    orphans,
    edgeKind,
    adjacency,
  ]);
  const displayed = useMemo(() => {
    const groups = new Map<string, EcosystemNode[]>();
    for (const n of filtered.nodes) {
      if (!groups.has(n.cluster)) groups.set(n.cluster, []);
      groups.get(n.cluster)!.push(n);
    }
    const nodes: EcosystemNode[] = [],
      mapping = new Map<string, string>();
    for (const [id, items] of groups) {
      if (collapsed.includes(id) && items.length > 1) {
        nodes.push({
          ref: id,
          title: "Cluster · " + items.length + " records",
          kind: "cluster",
          tags: [],
          updatedAt: "",
          classification: "",
          degree: items.reduce((sum, n) => sum + n.degree, 0),
          cluster: id,
        });
        for (const n of items) mapping.set(n.ref, id);
      } else
        for (const n of items) {
          nodes.push(n);
          mapping.set(n.ref, n.ref);
        }
    }
    const edges = filtered.edges
      .map((e) => ({
        ...e,
        from: mapping.get(e.from)!,
        to: mapping.get(e.to)!,
      }))
      .filter((e) => e.from !== e.to);
    return { nodes, edges, groups };
  }, [filtered, collapsed]);
  useEffect(() => {
    if (!active || !graph) return;
    const w = new Worker(new URL("./ecosystem.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    const seed = initialPoints(displayed.nodes, positionCache.current);
    const initial = Object.fromEntries(
      displayed.nodes.map((n, i) => [n.ref, seed[i]]),
    );
    setPoints(initial);
    w.onmessage = (event) => {
      const next: Record<string, Point> = {};
      displayed.nodes.forEach((n, i) => {
        next[n.ref] = event.data.points[i];
        positionCache.current[n.ref] = event.data.points[i];
      });
      setPoints(next);
      setTicks(event.data.ticks);
    };
    w.onerror = () =>
      setError("Force worker failed; initial positions remain navigable.");
    w.postMessage({ ...displayed, previous: positionCache.current });
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, [active, graph, displayed]);
  const fit = useCallback(
    (refs?: string[]) => {
      const values = (refs ? graph?.nodes || [] : displayed.nodes)
        .filter((n) => !refs || refs.includes(n.ref))
        .map((n) => points[n.ref] || positionCache.current[n.ref])
        .filter(Boolean);
      if (!values.length) return;
      const xs = values.map((p) => p.x),
        ys = values.map((p) => p.y),
        minX = Math.min(...xs),
        maxX = Math.max(...xs),
        minY = Math.min(...ys),
        maxY = Math.max(...ys),
        { width, height } = screen.current,
        z = Math.min(
          3,
          (width - 80) / Math.max(100, maxX - minX),
          (height - 80) / Math.max(100, maxY - minY),
        );
      setView({
        x: width / 2 - ((minX + maxX) * z) / 2,
        y: height / 2 - ((minY + maxY) * z) / 2,
        z,
      });
    },
    [displayed, points, graph],
  );
  useEffect(() => {
    if (needsFit.current && Object.keys(points).length) {
      needsFit.current = false;
      fit();
    }
  }, [points, fit]);
  useEffect(() => {
    const el = canvas.current;
    if (!el || !active) return;
    const paint = () => {
      const started = performance.now(),
        bounds = el.getBoundingClientRect(),
        ratio = devicePixelRatio || 1;
      screen.current = { width: bounds.width, height: bounds.height };
      el.width = Math.round(bounds.width * ratio);
      el.height = Math.round(bounds.height * ratio);
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.fillStyle = appearance === "dark" ? "#18232b" : "#f5f8f3";
      ctx.fillRect(0, 0, bounds.width, bounds.height);
      ctx.translate(view.x, view.y);
      ctx.scale(view.z, view.z);
      ctx.lineWidth = 0.8 / view.z;
      for (const kind of Object.keys(lineColors)) {
        ctx.strokeStyle = lineColors[kind as keyof typeof lineColors];
        ctx.setLineDash(kind === "annotation" ? [4 / view.z, 4 / view.z] : []);
        ctx.beginPath();
        for (const e of displayed.edges) {
          if (e.kind !== kind) continue;
          const a = points[e.from],
            b = points[e.to];
          if (!a || !b) continue;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const n of displayed.nodes) {
        const p = points[n.ref];
        if (!p) continue;
        const x = p.x * view.z + view.x,
          y = p.y * view.z + view.y;
        if (
          x < -30 ||
          y < -30 ||
          x > bounds.width + 30 ||
          y > bounds.height + 30
        )
          continue;
        const radius =
          (n.kind === "cluster"
            ? 15
            : 3 + Math.min(12, Math.sqrt(n.degree) * 1.8)) *
          scale *
          (sizes[n.kind] || 1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = colors[n.kind] || "#526e61";
        ctx.fill();
        if (n.ref === selected) {
          ctx.strokeStyle = "#141d18";
          ctx.lineWidth = 3 / view.z;
          ctx.stroke();
        }
        if (view.z > 0.65 || n.ref === selected || n.kind === "cluster") {
          ctx.fillStyle = appearance === "dark" ? "#cfddd9" : "#243d30";
          ctx.font = `${11 / view.z}px system-ui`;
          ctx.fillText(n.title.slice(0, 40), p.x + radius + 3, p.y + 3);
        }
      }
      drawMetrics.current = {
        frames: drawMetrics.current.frames + 1,
        lastMs: performance.now() - started,
      };
      el.dataset.drawMs = String(drawMetrics.current.lastMs.toFixed(2));
      el.dataset.nodes = String(displayed.nodes.length);
      el.dataset.view = JSON.stringify(view);
      el.dataset.edges = String(displayed.edges.length);
    };
    const frame = requestAnimationFrame(paint);
    const observer = new ResizeObserver(paint);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [
    active,
    displayed,
    points,
    view,
    selected,
    colors,
    scale,
    sizes,
    appearance,
  ]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect(),
        x = e.clientX - box.left,
        y = e.clientY - box.top;
      setView((v) => {
        const z = Math.max(
          0.015,
          Math.min(10, v.z * Math.exp(-e.deltaY * 0.001)),
        );
        return {
          x: x - ((x - v.x) * z) / v.z,
          y: y - ((y - v.y) * z) / v.z,
          z,
        };
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    let live = true;
    setRecord(null);
    if (!selected || selected.startsWith("cluster-") || demo) return;
    fetch("/api/ecosystem/record?ref=" + encodeURIComponent(selected))
      .then(async (r) => {
        if (!r.ok) throw Error("Record unavailable");
        return r.json();
      })
      .then((r) => {
        if (live) setRecord(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [selected, demo, graph?.revision]);
  const selectedNode = graph?.nodes.find((n) => n.ref === selected),
    known =
      graph?.edges.filter((e) => e.from === selected || e.to === selected) ||
      [];
  function pick(ref: string) {
    setSelected(ref);
    if (ref.startsWith("cluster-"))
      setNotice("Cluster selected. Expand it or focus its records.");
  }
  function hit(x: number, y: number) {
    let best: EcosystemNode | undefined,
      distance = Infinity;
    for (const n of displayed.nodes) {
      const p = points[n.ref];
      if (!p) continue;
      const d = Math.hypot(
          p.x * view.z + view.x - x,
          p.y * view.z + view.y - y,
        ),
        radius = Math.max(
          8,
          (3 + Math.min(12, Math.sqrt(n.degree) * 1.8)) *
            scale *
            (sizes[n.kind] || 1) *
            view.z,
        );
      if (d < radius && d < distance) {
        distance = d;
        best = n;
      }
    }
    return best;
  }
  async function saveInvestigation() {
    try {
      const positions = Object.fromEntries(
        filtered.nodes
          .filter((n) => points[n.ref])
          .map((n) => [n.ref, { x: points[n.ref].x, y: points[n.ref].y }]),
      );
      const r = await fetch("/api/ecosystem/layout/" + center.split(":")[1], {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positions,
          view,
          expectedRevision: layoutRevision,
        }),
      });
      if (!r.ok) throw Error((await r.json()).error);
      const result = await r.json();
      setLayoutRevision(result.revision);
      setNotice("Investigation layout saved.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function loadInvestigation(ref: string) {
    setCenter(ref);
    setPerspective("investigation");
    needsFit.current = true;
    try {
      const r = await fetch("/api/ecosystem/layout/" + ref.split(":")[1]);
      const saved = await r.json();
      setLayoutRevision(saved.revision || 0);
      if (saved.data?.positions) {
        positionCache.current = {
          ...positionCache.current,
          ...Object.fromEntries(
            Object.entries(saved.data.positions).map(([ref, p]: any) => [
              ref,
              { ...p, vx: 0, vy: 0, fixed: true },
            ]),
          ),
        };
        setPoints((p) => ({ ...p, ...saved.data.positions }));
        setView(saved.data.view);
        needsFit.current = false;
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="ecosystem" aria-label="Global Graph workspace">
      <header>
        <div>
          <span className="eyebrow">LIVE RESEARCH INDEX</span>
          <h2>Global Graph</h2>
          <p>
            Stored links retain their meaning. Verified means explicit local
            review, not independent certification.
          </p>
        </div>
        <label>
          <input
            type="checkbox"
            checked={demo}
            onChange={(e) => {
              setDemo(e.target.checked);
              setPerspective("global");
              setCenter("");
              setQuery("");
              setCategory("");
              setEdgeKind("");
              setCollapsed([]);
              setSelected("");
              needsFit.current = true;
              positionCache.current = {};
            }}
          />
          Demonstration dataset · 10,000 nodes / 12,000 edges
        </label>
      </header>
      {demo && (
        <p className="ecosystem-demo" role="status">
          DEMONSTRATION ONLY — synthetic renderer data, never written to your
          research database.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {graph && (
        <p className="ecosystem-counts" role="status">
          {graph.stats.indexed.toLocaleString()} indexed records ·{" "}
          {graph.stats.entities.toLocaleString()} entities ·{" "}
          {graph.stats.links.toLocaleString()} links ·{" "}
          {graph.stats.orphans.toLocaleString()} orphaned nodes ·{" "}
          {graph.stats.excluded.toLocaleString()} excluded records ·{" "}
          {graph.stats.unresolvedReferences} unresolved references
          {graph.stats.truncated ? " · SAFETY LIMIT: index incomplete" : ""}
        </p>
      )}
      <div className="ecosystem-controls">
        <label>
          Perspective
          <select
            aria-label="Graph perspective"
            value={perspective}
            onChange={(e) => {
              setPerspective(e.target.value);
              if (e.target.value === "local")
                setCenter(selectedNode?.ref || graph?.nodes[0]?.ref || "");
            }}
          >
            <option value="global">Global Ecosystem</option>
            <option value="local">Local Network</option>
            <option value="investigation">Investigation Network</option>
          </select>
        </label>
        <label>
          Search graph
          <input
            aria-label="Search graph"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Title or tag"
          />
        </label>
        <label>
          Record category
          <select
            aria-label="Graph category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {[...new Set(graph?.nodes.map((n) => n.kind))].sort().map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Link category
          <select
            aria-label="Graph link category"
            value={edgeKind}
            onChange={(e) => setEdgeKind(e.target.value)}
          >
            <option value="">All links</option>
            {Object.keys(lineColors).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={orphans}
            onChange={(e) => setOrphans(e.target.checked)}
          />
          Show isolated nodes
        </label>
        <label>
          Relationship depth
          <input
            aria-label="Graph depth"
            type="number"
            min="1"
            max="8"
            value={depth}
            onChange={(e) =>
              setDepth(Math.max(1, Math.min(8, Number(e.target.value) || 1)))
            }
          />
        </label>
        {perspective !== "global" && (
          <label>
            Center record
            <select
              aria-label="Graph center"
              value={center}
              onChange={(e) =>
                perspective === "investigation"
                  ? void loadInvestigation(e.target.value)
                  : setCenter(e.target.value)
              }
            >
              <option value="">Choose record</option>
              {(graph?.nodes || [])
                .filter(
                  (n) =>
                    perspective !== "investigation" ||
                    n.kind === "investigation",
                )
                .slice(0, 12000)
                .map((n) => (
                  <option key={n.ref} value={n.ref}>
                    {n.title}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      <div className="ecosystem-toolbar">
        <button onClick={() => fit()}>Fit ecosystem</button>
        <button
          onClick={() => setView((v) => ({ ...v, z: Math.min(10, v.z * 1.3) }))}
        >
          Zoom in graph
        </button>
        <button
          onClick={() =>
            setView((v) => ({ ...v, z: Math.max(0.015, v.z / 1.3) }))
          }
        >
          Zoom out graph
        </button>
        <button onClick={() => setCollapsed([...displayed.groups.keys()])}>
          Collapse clusters
        </button>
        <button onClick={() => setCollapsed([])}>Expand all clusters</button>
        <button
          disabled={!selected}
          onClick={() => {
            const cluster = selectedNode?.cluster || selected;
            if (!cluster) return;
            setCollapsed((c) => c.filter((x) => x !== cluster));
            fit(
              graph?.nodes
                .filter((n) => n.cluster === cluster)
                .map((n) => n.ref),
            );
          }}
        >
          Focus selected cluster
        </button>
        {perspective === "investigation" && (
          <>
            <button
              disabled={!center || demo}
              onClick={() => void saveInvestigation()}
            >
              Save investigation layout
            </button>
            <button
              disabled={!center || demo}
              onClick={async () => {
                try {
                  const r = await fetch(
                    "/api/ecosystem/investigation-canvas/" +
                      center.split(":")[1],
                    { method: "POST" },
                  );
                  if (!r.ok) throw Error((await r.json()).error);
                  onOpenReference("canvas:" + (await r.json()).id);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Open investigation canvas
            </button>
          </>
        )}
        <span>
          {displayed.nodes.length.toLocaleString()} visible nodes ·{" "}
          {displayed.edges.length.toLocaleString()} visible edges · force tick{" "}
          {ticks}
        </span>
      </div>
      <div className="ecosystem-layout">
        <div>
          <canvas
            ref={canvas}
            className="ecosystem-stage"
            role="img"
            aria-label="Force-directed research ecosystem"
            tabIndex={0}
            onKeyDown={(e) => {
              if (
                ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                  e.key,
                )
              ) {
                e.preventDefault();
                setView((v) => ({
                  ...v,
                  x:
                    v.x +
                    (e.key === "ArrowLeft"
                      ? 40
                      : e.key === "ArrowRight"
                        ? -40
                        : 0),
                  y:
                    v.y +
                    (e.key === "ArrowUp"
                      ? 40
                      : e.key === "ArrowDown"
                        ? -40
                        : 0),
                }));
              }
            }}
            onPointerDown={(e) => {
              const box = e.currentTarget.getBoundingClientRect(),
                x = e.clientX - box.left,
                y = e.clientY - box.top,
                n = hit(x, y);
              if (n) pick(n.ref);
              drag.current = { x, y, view, node: n?.ref, moved: false };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const box = e.currentTarget.getBoundingClientRect(),
                x = e.clientX - box.left,
                y = e.clientY - box.top;
              d.moved = true;
              if (d.node) {
                const p = {
                  x: (x - view.x) / view.z,
                  y: (y - view.y) / view.z,
                  vx: 0,
                  vy: 0,
                  fixed: true,
                };
                positionCache.current[d.node] = p;
                setPoints((old) => ({ ...old, [d.node]: p }));
                worker.current?.postMessage({
                  type: "pin",
                  index: displayed.nodes.findIndex((n) => n.ref === d.node),
                  ...p,
                });
              } else
                setView({
                  ...d.view,
                  x: d.view.x + x - d.x,
                  y: d.view.y + y - d.y,
                });
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onDoubleClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect(),
                n = hit(e.clientX - box.left, e.clientY - box.top);
              if (n?.kind === "cluster")
                setCollapsed((c) => c.filter((x) => x !== n.ref));
            }}
          />
          <p className="ecosystem-help">
            Wheel to zoom · drag background to pan · drag nodes to pin ·
            double-click a collapsed cluster to expand. Clusters are connected
            neighborhoods, not inferred factual communities.
          </p>
          <details>
            <summary>Colors and sizes</summary>
            {Object.entries(colors).map(([kind, color]) => (
              <label key={kind}>
                {kind}
                <input
                  aria-label={"Color " + kind}
                  type="color"
                  value={color}
                  onChange={(e) => {
                    const next = { ...colors, [kind]: e.target.value };
                    setColors(next);
                    localStorage.setItem(
                      "sourcewatch-graph-colors",
                      JSON.stringify(next),
                    );
                  }}
                />
              </label>
            ))}
            {Object.keys(palette).map((kind) => (
              <label key={kind}>
                {kind} size
                <input
                  aria-label={"Size " + kind}
                  type="number"
                  min="0.5"
                  max="3"
                  step="0.1"
                  value={sizes[kind] || 1}
                  onChange={(e) => {
                    const next = {
                      ...sizes,
                      [kind]: Math.max(
                        0.5,
                        Math.min(3, Number(e.target.value) || 1),
                      ),
                    };
                    setSizes(next);
                    localStorage.setItem(
                      "sourcewatch-graph-sizes",
                      JSON.stringify(next),
                    );
                  }}
                />
              </label>
            ))}
            <label>
              Node size
              <input
                aria-label="Graph node size"
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
              />
            </label>
          </details>
        </div>
        <aside aria-label="Graph record inspector">
          <h3>{selectedNode?.title || "Select a record"}</h3>
          {selectedNode && (
            <>
              <p>
                {selectedNode.kind} · {selectedNode.degree} stored connections
              </p>
              <button
                onClick={() => {
                  setCenter(selectedNode.ref);
                  setPerspective("local");
                }}
              >
                Explore local network
              </button>
              {!demo &&
                selectedNode.kind !== "document" &&
                selectedNode.kind !== "legacy" && (
                  <button onClick={() => onOpenReference(selectedNode.ref)}>
                    Open full record
                  </button>
                )}
            </>
          )}
          {record && (
            <>
              <h4>Stored record</h4>
              <pre>
                {JSON.stringify(record.data || record, null, 2).slice(0, 30000)}
              </pre>
              {selectedNode?.kind === "document" && (
                <a
                  href={
                    "/api/workspace/attachments/" +
                    selected.split(":")[1] +
                    "/file"
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  Open preserved document
                </a>
              )}
            </>
          )}
          <h4>Known relationships ({known.length})</h4>
          {known.slice(0, 100).map((e) => (
            <button
              className="ecosystem-record"
              key={e.id}
              onClick={() => pick(e.from === selected ? e.to : e.from)}
            >
              <strong>
                {e.kind}: {e.label}
              </strong>
              <small>
                {
                  graph?.nodes.find(
                    (n) => n.ref === (e.from === selected ? e.to : e.from),
                  )?.title
                }
              </small>
            </button>
          ))}
          {known.length > 100 && (
            <p>First 100 listed; the graph retains all indexed edges.</p>
          )}
          <h4>Search results / accessible node list</h4>
          {displayed.nodes.slice(0, 100).map((n) => (
            <button
              className="ecosystem-record"
              key={n.ref}
              onClick={() => {
                pick(n.ref);
                const p = points[n.ref];
                if (p)
                  setView({
                    x: screen.current.width / 2 - p.x * 1.8,
                    y: screen.current.height / 2 - p.y * 1.8,
                    z: 1.8,
                  });
              }}
            >
              {n.title} · {n.kind}
            </button>
          ))}
          {displayed.nodes.length > 100 && (
            <p>
              Showing first 100 accessible results; use search to find any
              indexed record.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
