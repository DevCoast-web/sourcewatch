import React, { useState, useEffect, useRef } from "react";
import "./intelligence.css";
const call = async (
  path: string,
  body?: any,
  method = body ? "POST" : "GET",
) => {
  const r = await fetch("/api/intelligence" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
};
const blank = (kind: string) =>
  kind === "entity"
    ? {
        title: "",
        type: "organization",
        aliases: [],
        jurisdiction: "",
        identifiers: {},
        citations: [],
        tags: [],
      }
    : kind === "relationship"
      ? {
          title: "",
          type: "documented association",
          fromRef: "",
          toRef: "",
          classification: "annotation",
          evidenceRefs: [],
          explanation: "",
          tags: [],
        }
      : kind === "investigation"
        ? { title: "", body: "", refs: [], timeline: [], tags: [] }
        : kind === "correction"
          ? {
              title: "",
              targetRef: "",
              body: "",
              evidenceRefs: [],
              status: "proposed",
              tags: [],
            }
          : { title: "", filters: {}, tags: [] };
export function IntelligenceView({
  initialRef,
  onOpenReference,
  onAddToCanvas,
}: {
  initialRef?: string;
  onOpenReference: (ref: string) => void;
  onAddToCanvas: (ref: string) => void;
}) {
  const [tab, setTab] = useState("Database"),
    [kind, setKind] = useState("entity"),
    [rows, setRows] = useState<any[]>([]),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [type, setType] = useState(""),
    [tag, setTag] = useState(""),
    [jurisdiction, setJurisdiction] = useState(""),
    [selected, setSelected] = useState<any>(null),
    [draft, setDraft] = useState<any>(blank("entity")),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [graph, setGraph] = useState<any>({ nodes: [], edges: [] }),
    [view, setView] = useState({ x: 0, y: 0, z: 1 }),
    [center, setCenter] = useState(""),
    [hops, setHops] = useState("1"),
    [audit, setAudit] = useState<any[]>([]),
    [report, setReport] = useState<any>(null),
    [format, setFormat] = useState("json"),
    [importText, setImportText] = useState(""),
    [reviewer, setReviewer] = useState(""),
    [reviewText, setReviewText] = useState(""),
    [pathTo, setPathTo] = useState(""),
    [pathResult, setPathResult] = useState<any>(null),
    [references, setReferences] = useState<any[]>([]),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false);
  const editing = useRef({ key: "entity:new", dirty: false, saving: false });
  editing.current = {
    key: (selected?.kind || kind) + ":" + (selected?.id || "new"),
    dirty,
    saving,
  };
  const draftKey = (key: string) => "sourcewatch-intelligence-draft:" + key;
  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(draftKey("entity:new"));
      if (cached) {
        setDraft(JSON.parse(cached).data || JSON.parse(cached));
        setDirty(true);
        setNotice(
          "Recovered unsaved intelligence draft from this browser session.",
        );
      }
    } catch {
      setError(
        "Draft recovery unavailable; export or copy your work before leaving.",
      );
    }
  }, []);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("sourcewatch-dirty", {
        detail: { kind: "intelligence", dirty: dirty || saving },
      }),
    );
    if (dirty)
      try {
        sessionStorage.setItem(
          draftKey(editing.current.key),
          JSON.stringify({ data: draft, baseRevision: selected?.revision }),
        );
      } catch {
        setError(
          "Draft storage is full or unavailable. Keep this view open and copy your work.",
        );
      }
  }, [dirty, saving, draft, kind, selected?.id]);
  useEffect(
    () => () => {
      window.dispatchEvent(
        new CustomEvent("sourcewatch-dirty", {
          detail: { kind: "intelligence", dirty: false },
        }),
      );
    },
    [],
  );
  function canLeave() {
    if (editing.current.dirty || editing.current.saving) {
      setError(
        "Save or explicitly discard the current intelligence draft before changing records.",
      );
      return false;
    }
    return true;
  }
  function discard() {
    if (saving) return;
    sessionStorage.removeItem(draftKey(editing.current.key));
    setDraft(
      selected ? JSON.parse(JSON.stringify(selected.data)) : blank(kind),
    );
    setDirty(false);
    setError("");
    setNotice("Unsaved draft discarded.");
  }
  function newRecord(nextKind: string) {
    if (!canLeave()) return;
    setKind(nextKind);
    setSelected(null);
    setDraft(blank(nextKind));
    setDirty(false);
    try {
      const cached = sessionStorage.getItem(draftKey(nextKind + ":new"));
      if (cached) {
        setDraft(JSON.parse(cached).data || JSON.parse(cached));
        setDirty(true);
        setNotice("Recovered unsaved draft.");
      }
    } catch {
      setError("Draft recovery failed.");
    }
  }
  const drag = useRef<any>(null);
  const filter = () =>
    new URLSearchParams({
      q: query,
      classification: status,
      type,
      jurisdiction,
      tag,
      offset: String(offset),
      limit: "50",
    }).toString();
  async function refresh() {
    const result = await call("/records/" + kind + "?" + filter());
    setRows(result.items);
    setTotal(result.total);
  }
  async function loadGraph() {
    setGraph(
      await call(
        "/graph?" +
          new URLSearchParams({
            q: query,
            classification: status,
            tag,
            center,
            hops,
          }),
      ),
    );
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [kind, query, status, type, tag, jurisdiction, offset]);
  useEffect(() => {
    if (tab === "Network") loadGraph().catch((e) => setError(e.message));
    if (tab === "Imports/Audit")
      call("/audit")
        .then(setAudit)
        .catch((e) => setError(e.message));
  }, [tab, query, status, tag, center, hops]);
  useEffect(() => {
    fetch("/api/workspace/catalog")
      .then((r) => r.json())
      .then((r) => setReferences(r.items || []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (
      initialRef?.startsWith("entity:") ||
      initialRef?.startsWith("relationship:")
    ) {
      const [k, id] = initialRef.split(":");
      if (!canLeave()) return;
      call("/records/" + k + "/" + id)
        .then(choose)
        .catch((e) => setError(e.message));
    }
  }, [initialRef]);
  function choose(row: any, force = false) {
    if (!force && !canLeave()) return;
    setSelected(row);
    setDraft(JSON.parse(JSON.stringify(row.data)));
    setKind(row.kind);
    setDirty(false);
    if (!force)
      try {
        const cached = sessionStorage.getItem(
          draftKey(row.kind + ":" + row.id),
        );
        if (cached) {
          const recovered = JSON.parse(cached);
          setDraft(recovered.data || recovered);
          if (recovered.baseRevision)
            setSelected({ ...row, revision: recovered.baseRevision });
          setDirty(true);
          setNotice(
            "Recovered unsaved draft for this record. Saving still checks its revision.",
          );
        }
      } catch {
        setError("Draft recovery failed.");
      }
    setError("");
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (editing.current.saving) return;
    const identity = editing.current.key;
    setSaving(true);
    try {
      const row = await call(
        "/records/" + kind + (selected ? "/" + selected.id : ""),
        selected ? { data: draft, revision: selected.revision } : draft,
        selected ? "PUT" : "POST",
      );
      if (editing.current.key !== identity) return;
      sessionStorage.removeItem(draftKey(identity));
      choose(row, true);
      await refresh();
      setNotice("Record saved with a recoverable revision.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const field = (key: string, value: any) => {
    if (saving) return;
    setDirty(true);
    setDraft((d: any) => ({ ...d, [key]: value }));
  };
  const ref = "" + (selected ? selected.kind + ":" + selected.id : "");
  const resolveTitle = (r: string) =>
    references.find((x) => x.ref === r)?.title || r;
  const points = new Map<string, { x: number; y: number }>();
  graph.nodes.forEach((n: any, i: number) =>
    points.set(n.ref, {
      x:
        450 +
        Math.cos((i * Math.PI * 2) / Math.max(1, graph.nodes.length)) * 300,
      y:
        270 +
        Math.sin((i * Math.PI * 2) / Math.max(1, graph.nodes.length)) * 210,
    }),
  );
  async function graphPick(r: string) {
    const [k, id] = r.split(":");
    if (
      [
        "entity",
        "relationship",
        "investigation",
        "board",
        "correction",
      ].includes(k)
    )
      choose(await call("/records/" + k + "/" + id));
    else onOpenReference(r);
  }
  return (
    <section className="intelligence">
      <h1>Network intelligence</h1>
      <p>
        Explicit records and researcher interpretations. A link is not evidence
        of wrongdoing or independent certification.
      </p>
      <nav className="intel-nav" aria-label="Intelligence sections">
        {["Database", "Network", "Investigations", "Imports/Audit"].map((t) => (
          <button
            key={t}
            aria-pressed={tab === t}
            onClick={() => {
              setTab(t);
              if (t === "Investigations") newRecord("investigation");
            }}
          >
            {t}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="intel-error">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="intel-controls">
        <label>
          Search records{" "}
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label>
          Evidence status{" "}
          <select
            aria-label="Evidence status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All</option>
            {["annotation", "hypothesis", "verified", "disputed"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Tag <input value={tag} onChange={(e) => setTag(e.target.value)} />
        </label>
      </div>
      {tab === "Imports/Audit" ? (
        <div className="intel-grid">
          <section className="intel-panel">
            <h2>Validated import</h2>
            <p>
              Each accepted row is validated; rejected rows are reported.
              Accepted rows commit together. Duplicate titles stay separate.
              Verified classifications require an explicit local review.
            </p>
            <label>
              Record kind{" "}
              <select
                aria-label="Import record kind"
                value={kind}
                onChange={(e) => newRecord(e.target.value)}
              >
                {[
                  "entity",
                  "relationship",
                  "investigation",
                  "board",
                  "correction",
                ].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <select
              aria-label="Import format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            >
              <option>json</option>
              <option>csv</option>
            </select>
            <textarea
              aria-label="Import content"
              rows={12}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div className="intel-actions">
              {[true, false].map((dryRun) => (
                <button
                  key={String(dryRun)}
                  onClick={async () => {
                    try {
                      setReport(
                        await call("/imports", {
                          kind,
                          format,
                          content: importText,
                          dryRun,
                        }),
                      );
                      setAudit(await call("/audit"));
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {dryRun ? "Validate import" : "Commit accepted records"}
                </button>
              ))}
            </div>
            {report && (
              <pre className="intel-code">
                {JSON.stringify(report, null, 2)}
              </pre>
            )}
            <h3>Portable research exports</h3>
            <p>
              Mutable research context. Original evidence files must be exported
              separately.
            </p>
            {["json", "csv", "gephi", "cytoscape", "zip"].map((f) => (
              <a key={f} href={"/api/intelligence/export?format=" + f}>
                Download {f}{" "}
              </a>
            ))}
          </section>
          <section className="intel-panel">
            <h2>Append-only audit</h2>
            {audit.slice(0, 100).map((a) => (
              <details key={a.id}>
                <summary>
                  {a.createdAt} · {a.kind}
                </summary>
                <pre className="intel-code">{JSON.stringify(a, null, 2)}</pre>
              </details>
            ))}
          </section>
        </div>
      ) : (
        <div className="intel-grid">
          <section className="intel-panel">
            {tab === "Network" ? (
              <>
                <h2>Network explorer</h2>
                <button
                  onClick={() => {
                    const svg = document.querySelector(".intel-network");
                    if (!svg) return;
                    const data = new XMLSerializer().serializeToString(svg);
                    const url = URL.createObjectURL(
                      new Blob([data], { type: "image/svg+xml" }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "sourcewatch-network.svg";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  Export graph SVG
                </button>
                <button
                  onClick={async () => {
                    try {
                      const title = "Network board " + new Date().toISOString();
                      await call("/records/board", {
                        title,
                        filters: {
                          q: query,
                          classification: status,
                          tag,
                          center,
                          hops: Number(hops),
                        },
                      });
                      setNotice(
                        "Board saved. Open it from the board category.",
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Save current board
                </button>
                <div className="intel-controls">
                  <button
                    onClick={() =>
                      setView((v) => ({ ...v, z: Math.min(4, v.z * 1.2) }))
                    }
                  >
                    Zoom in
                  </button>
                  <button
                    onClick={() =>
                      setView((v) => ({ ...v, z: Math.max(0.2, v.z / 1.2) }))
                    }
                  >
                    Zoom out
                  </button>
                  <button onClick={() => setView({ x: 0, y: 0, z: 1 })}>
                    Fit graph
                  </button>
                  <label>
                    Local center{" "}
                    <input
                      placeholder="entity:UUID"
                      value={center}
                      onChange={(e) => setCenter(e.target.value)}
                    />
                  </label>
                  <label>
                    Hops{" "}
                    <select
                      aria-label="Hops"
                      value={hops}
                      onChange={(e) => setHops(e.target.value)}
                    >
                      {["1", "2", "3", "4"].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="intel-subtle">
                  Showing {graph.nodes.length} nodes / {graph.edges.length}{" "}
                  relationships. Display cap 500 each.{" "}
                  {graph.truncated
                    ? "Filtered or truncated; refine the view."
                    : ""}{" "}
                  Drag to pan, scroll to zoom. Click a node or edge to inspect.
                </p>
                <svg
                  className="intel-network"
                  viewBox="0 0 900 540"
                  role="img"
                  aria-label="Interactive relationship graph"
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) {
                      drag.current = { x: e.clientX, y: e.clientY, v: view };
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }
                  }}
                  onPointerMove={(e) => {
                    if (drag.current)
                      setView({
                        ...drag.current.v,
                        x: drag.current.v.x + e.clientX - drag.current.x,
                        y: drag.current.v.y + e.clientY - drag.current.y,
                      });
                  }}
                  onPointerUp={() => {
                    drag.current = null;
                  }}
                  onWheel={(e) =>
                    setView((v) => ({
                      ...v,
                      z: Math.max(
                        0.2,
                        Math.min(4, v.z * (e.deltaY < 0 ? 1.1 : 0.9)),
                      ),
                    }))
                  }
                >
                  <defs>
                    <marker
                      id="intel-arrow"
                      markerWidth="8"
                      markerHeight="8"
                      refX="18"
                      refY="4"
                      orient="auto"
                    >
                      <path d="M0,0 L8,4 L0,8" fill="#638376" />
                    </marker>
                  </defs>
                  <g
                    transform={`translate(${view.x} ${view.y}) scale(${view.z})`}
                  >
                    {graph.edges.map((e: any) => {
                      const a = points.get(e.fromRef),
                        b = points.get(e.toRef);
                      return a && b ? (
                        <line
                          key={e.id}
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          markerEnd="url(#intel-arrow)"
                          className={
                            e.classification +
                            (selected?.id === e.id ? " selected" : "")
                          }
                          onClick={() => graphPick(e.ref)}
                        >
                          <title>
                            {e.type} · {e.classification}
                          </title>
                        </line>
                      ) : null;
                    })}
                    {graph.nodes.map((n: any) => {
                      const p = points.get(n.ref)!;
                      return (
                        <g key={n.ref} transform={`translate(${p.x} ${p.y})`}>
                          <circle
                            r="18"
                            className={ref === n.ref ? "selected" : ""}
                            onClick={() => graphPick(n.ref)}
                          />
                          <text y="34" textAnchor="middle">
                            {n.title.slice(0, 24)}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
                <h3>Accessible node and relationship list</h3>
                {graph.nodes.map((n: any) => (
                  <button
                    className="intel-row"
                    key={n.ref}
                    onClick={() => graphPick(n.ref)}
                  >
                    {n.title} · {n.kind}
                  </button>
                ))}
                {graph.edges.map((e: any) => (
                  <button
                    className="intel-row"
                    key={e.id}
                    onClick={() => graphPick(e.ref)}
                  >
                    {resolveTitle(e.fromRef)} → {e.type} →{" "}
                    {resolveTitle(e.toRef)} · {e.classification}
                  </button>
                ))}
                <label>
                  Path target{" "}
                  <input
                    value={pathTo}
                    onChange={(e) => setPathTo(e.target.value)}
                    placeholder="entity:UUID"
                  />
                </label>
                <button
                  disabled={!ref || !pathTo}
                  onClick={async () => {
                    try {
                      setPathResult(
                        await call(
                          "/path?" +
                            new URLSearchParams({ from: ref, to: pathTo }),
                        ),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Find path from selected record
                </button>
                {pathResult && <pre>{JSON.stringify(pathResult, null, 2)}</pre>}
              </>
            ) : (
              <>
                <div className="intel-controls">
                  <label>
                    Record category{" "}
                    <select
                      aria-label="Record category"
                      value={kind}
                      onChange={(e) => {
                        newRecord(e.target.value);
                        setOffset(0);
                      }}
                    >
                      {[
                        "entity",
                        "relationship",
                        "investigation",
                        "board",
                        "correction",
                      ].map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Type filter{" "}
                    <input
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                    />
                  </label>
                  <label>
                    Jurisdiction{" "}
                    <input
                      value={jurisdiction}
                      onChange={(e) => setJurisdiction(e.target.value)}
                    />
                  </label>
                  <button
                    onClick={() => {
                      newRecord(kind);
                    }}
                  >
                    New {kind}
                  </button>
                </div>
                <p>
                  {total} matching records · page {Math.floor(offset / 50) + 1}
                </p>
                <table className="intel-table">
                  <thead>
                    <tr>
                      <th>Record</th>
                      <th>Type</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <button onClick={() => choose(r)}>
                            {r.data.title}
                          </button>
                        </td>
                        <td>{r.data.type || r.kind}</td>
                        <td>
                          {r.data.classification ||
                            r.data.status ||
                            "research context"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 50))}
                >
                  Previous page
                </button>
                <button
                  disabled={offset + 50 >= total}
                  onClick={() => setOffset(offset + 50)}
                >
                  Next page
                </button>
              </>
            )}
          </section>
          <aside className="intel-panel">
            <h2>{selected ? "Inspect " + selected.kind : "Create " + kind}</h2>
            {(dirty || saving) && (
              <p role="status">
                {saving
                  ? "Saving intelligence record…"
                  : "Unsaved intelligence draft retained in this browser session."}
                <button disabled={saving} onClick={discard}>
                  Discard intelligence draft
                </button>
              </p>
            )}
            <form className="intel-form" onSubmit={save}>
              <fieldset disabled={saving}>
                <label>
                  Record title
                  <input
                    required
                    maxLength={200}
                    value={draft.title || ""}
                    onChange={(e) => field("title", e.target.value)}
                  />
                </label>
                {["entity", "relationship"].includes(kind) && (
                  <label>
                    Record type
                    <input
                      value={draft.type || ""}
                      onChange={(e) => field("type", e.target.value)}
                    />
                  </label>
                )}
                <label>
                  Tags (comma separated)
                  <input
                    value={(draft.tags || []).join(", ")}
                    onChange={(e) =>
                      field(
                        "tags",
                        e.target.value
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                      )
                    }
                  />
                </label>
                {kind === "entity" && (
                  <>
                    <label>
                      Jurisdiction
                      <input
                        value={draft.jurisdiction || ""}
                        onChange={(e) => field("jurisdiction", e.target.value)}
                      />
                    </label>
                    <label>
                      Aliases
                      <input
                        value={(draft.aliases || []).join(", ")}
                        onChange={(e) =>
                          field(
                            "aliases",
                            e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          )
                        }
                      />
                    </label>
                  </>
                )}
                {kind === "relationship" && (
                  <>
                    {["fromRef", "toRef"].map((k) => (
                      <label key={k}>
                        {k === "fromRef" ? "From reference" : "To reference"}
                        <input
                          list="intel-refs"
                          required
                          value={draft[k] || ""}
                          onChange={(e) => field(k, e.target.value)}
                        />
                      </label>
                    ))}
                    <label>
                      Classification
                      <select
                        aria-label="Classification"
                        value={draft.classification || "annotation"}
                        onChange={(e) =>
                          field("classification", e.target.value)
                        }
                      >
                        {["annotation", "hypothesis", "disputed"].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                        {draft.classification === "verified" && (
                          <option>verified</option>
                        )}
                      </select>
                    </label>
                    <label>
                      Evidence references (one per line)
                      <textarea
                        value={(draft.evidenceRefs || []).join("\n")}
                        onChange={(e) =>
                          field(
                            "evidenceRefs",
                            e.target.value.split("\n").filter(Boolean),
                          )
                        }
                      />
                    </label>
                    <label>
                      Explanation
                      <textarea
                        value={draft.explanation || ""}
                        onChange={(e) => field("explanation", e.target.value)}
                      />
                    </label>
                  </>
                )}
                <label>
                  Research body
                  <textarea
                    rows={4}
                    value={draft.body || ""}
                    onChange={(e) => field("body", e.target.value)}
                  />
                </label>
                <details>
                  <summary>Structured record fields (JSON)</summary>
                  <textarea
                    aria-label="Structured record JSON"
                    rows={12}
                    value={JSON.stringify(draft, null, 2)}
                    onChange={(e) => {
                      try {
                        if (saving) return;
                        setDirty(true);
                        setDraft(JSON.parse(e.target.value));
                        setError("");
                      } catch {
                        setError(
                          "Structured JSON must be valid before applying changes.",
                        );
                      }
                    }}
                  />
                </details>
                <button disabled={saving}>Save record</button>
              </fieldset>
            </form>
            <datalist id="intel-refs">
              {references.map((r) => (
                <option key={r.ref} value={r.ref}>
                  {r.title}
                </option>
              ))}
            </datalist>
            {selected && (
              <>
                <p className="intel-subtle">
                  {ref} · revision {selected.revision}
                </p>
                <div className="intel-actions">
                  <button onClick={() => onAddToCanvas(ref)}>
                    Add to canvas
                  </button>
                  <button onClick={() => onOpenReference(ref)}>
                    Open reference
                  </button>
                  <button
                    onClick={() => {
                      setCenter(ref);
                      setTab("Network");
                    }}
                  >
                    Explore neighborhood
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        setReport(await call("/history/" + selected.id));
                        setNotice("Revision history loaded in audit tab.");
                        setTab("Imports/Audit");
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Revision history
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        if (!canLeave()) return;
                        await call(
                          "/records/" + selected.kind + "/" + selected.id,
                          { revision: selected.revision },
                          "DELETE",
                        );
                        setSelected(null);
                        setDraft(blank(kind));
                        await refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Delete record
                  </button>
                </div>
                <h3>Evidence and references</h3>
                {[
                  ...(selected.data.evidenceRefs || []),
                  ...(selected.data.refs || []),
                  ...(selected.data.citations || []).map((c: any) => c.ref),
                ].map((r: string, i: number) => (
                  <button
                    className="intel-row"
                    key={r + i}
                    onClick={() => onOpenReference(r)}
                  >
                    {resolveTitle(r)}
                  </button>
                ))}
                {["relationship", "correction"].includes(selected.kind) && (
                  <form
                    className="intel-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!canLeave()) return;
                      const identity = editing.current.key;
                      setSaving(true);
                      try {
                        const reviewed = await call("/review/" + selected.id, {
                          reviewer,
                          explanation: reviewText,
                          status:
                            selected.kind === "relationship"
                              ? "verified"
                              : "accepted",
                          evidenceRefs: draft.evidenceRefs,
                          revision: selected.revision,
                        });
                        if (editing.current.key !== identity) return;
                        choose(reviewed, true);
                        await refresh();
                        setNotice(
                          "Explicit local review recorded. This is not independent certification.",
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    <h3>Explicit review</h3>
                    <label>
                      Reviewer
                      <input
                        required
                        value={reviewer}
                        onChange={(e) => setReviewer(e.target.value)}
                      />
                    </label>
                    <label>
                      Review explanation
                      <textarea
                        required
                        value={reviewText}
                        onChange={(e) => setReviewText(e.target.value)}
                      />
                    </label>
                    <button>
                      {selected.kind === "relationship"
                        ? "Verify against cited evidence"
                        : "Accept correction request"}
                    </button>
                  </form>
                )}
                {selected.kind === "board" && (
                  <button
                    onClick={() => {
                      const f = selected.data.filters || {};
                      setQuery(f.q || "");
                      setStatus(f.classification || "");
                      setCenter(f.center || "");
                      setHops(String(f.hops || 1));
                      setTab("Network");
                    }}
                  >
                    Open saved board
                  </button>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
