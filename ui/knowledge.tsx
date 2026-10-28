import React, { useEffect, useMemo, useRef, useState } from "react";
import "./knowledge.css";
type Kind = "topic" | "person" | "organization" | "claim";
type Node = {
  id: string;
  title: string;
  kind: Kind;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};
type Reference = {
  id: string;
  kind: "source" | "capture";
  title: string;
  sourceId: string;
  url: string;
  archived?: boolean;
  observedAt?: string;
  captureId?: string;
};
type Edge = {
  id: string;
  fromId: string;
  toId: string;
  label: string;
  note: string;
  evidenceCaptureId: string | null;
  createdAt: string;
};
type Graph = {
  nodes: Node[];
  references: Reference[];
  edges: Edge[];
  backlinks: Record<string, string[]>;
  captureChoices?: Reference[];
  capturesTruncated?: boolean;
};
type Item = {
  ref: string;
  title: string;
  kind: string;
  node?: Node;
  reference?: Reference;
};
const empty: Graph = { nodes: [], references: [], edges: [], backlinks: {} };
async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/knowledge" + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Research connections request failed");
  return result;
}
export function KnowledgeWorkspace({
  onClose,
  onOpenSource,
}: {
  onClose: () => void;
  onOpenSource: (sourceId: string, captureId?: string) => void;
}) {
  const [graph, setGraph] = useState<Graph>(empty),
    [selected, setSelected] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<{
    id?: string;
    title: string;
    kind: Kind;
    body: string;
    tags: string;
  } | null>(null);
  const [relationship, setRelationship] = useState({
    fromId: "",
    toId: "",
    label: "",
    note: "",
    evidenceCaptureId: "",
  });
  const generation = useRef(0),
    mounted = useRef(true),
    dialog = useRef<HTMLElement>(null),
    selection = useRef(selected);
  selection.current = selected;
  async function load() {
    const token = ++generation.current;
    try {
      const result = (await request("")) as Graph;
      if (mounted.current && token === generation.current) {
        setGraph(result);
        setError("");
      }
    } catch (e) {
      if (mounted.current && token === generation.current)
        setError((e as Error).message);
    } finally {
      if (mounted.current && token === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => {
      mounted.current = false;
      generation.current++;
      previous?.focus();
    };
  }, []);
  const items = useMemo<Item[]>(
    () =>
      [
        ...graph.nodes.map((node) => ({
          ref: "node:" + node.id,
          title: node.title,
          kind: node.kind,
          node,
        })),
        ...graph.references.map((reference) => ({
          ref: reference.id,
          title: reference.title,
          kind: reference.kind,
          reference,
        })),
      ].sort(
        (a, b) => a.title.localeCompare(b.title) || a.ref.localeCompare(b.ref),
      ),
    [graph],
  );
  const relationshipItems = useMemo(
    () => [
      ...new Map(
        [
          ...items,
          ...(graph.captureChoices || []).map((reference) => ({
            ref: reference.id,
            title: reference.title,
            kind: reference.kind,
            reference,
          })),
        ].map((item) => [item.ref, item]),
      ).values(),
    ],
    [items, graph.captureChoices],
  );
  const byRef = useMemo(
    () => new Map(items.map((item) => [item.ref, item])),
    [items],
  );
  const visible = items.filter(
    (item) =>
      (filter === "all" || item.kind === filter) &&
      [
        item.title,
        item.node?.body || "",
        ...(item.node?.tags || []),
        item.reference?.url || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const shown = visible.slice(0, 60),
    current = byRef.get(selected),
    connections = graph.edges.filter(
      (edge) => edge.fromId === selected || edge.toId === selected,
    );
  const positions = new Map(
    shown.map((item, index) => [
      item.ref,
      { x: 30 + (index % 5) * 166, y: 34 + Math.floor(index / 5) * 76 },
    ]),
  );
  const graphHeight = Math.max(150, Math.ceil(shown.length / 5) * 76 + 16);
  async function mutate(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request(path, method, body);
      await load();
      return result;
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
      throw e;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function choose(ref: string) {
    if (busy) return;
    setSelected(ref);
    setEditor(null);
    setNotice("");
    setRelationship((r) => ({ ...r, fromId: ref }));
  }
  function open(item: Item) {
    choose(item.ref);
  }
  function openEvidence(sourceId: string, captureId?: string) {
    onClose();
    onOpenSource(sourceId, captureId);
  }
  return (
    <div className="overlay">
      <section
        ref={dialog}
        tabIndex={-1}
        className="modal knowledge-workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby="knowledge-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
          if (e.key === "Tab") {
            const focusable = dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]',
            );
            if (!focusable?.length) return;
            const first = focusable[0],
              last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <button
          className="close"
          aria-label="Close research connections"
          onClick={onClose}
        >
          ×
        </button>
        <div className="eyebrow">LOCAL RESEARCH WORKSPACE</div>
        <h2 id="knowledge-title">Research connections</h2>
        <p className="muted">
          Researcher connections, not verified facts. Editable notes and
          relationships are separate from immutable capture evidence.
        </p>
        <div className="knowledge-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              setEditor({ title: "", kind: "topic", body: "", tags: "" });
              setSelected("");
            }}
          >
            + Add research node
          </button>
          <button onClick={() => void load()} disabled={busy}>
            Refresh connections
          </button>
          <a href="/api/knowledge/export">Export research JSON ↓</a>
        </div>
        {error && (
          <p role="alert" className="capture-error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <div className="knowledge-filters">
          <label>
            Search research
            <input
              disabled={busy}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Title, notes, tags or URL"
            />
          </label>
          <label>
            Node kind
            <select
              aria-label="Node kind"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {[
                "all",
                "topic",
                "person",
                "organization",
                "claim",
                "source",
                "capture",
              ].map((kind) => (
                <option key={kind} value={kind}>
                  {kind === "all"
                    ? "All kinds"
                    : kind[0].toUpperCase() + kind.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading ? (
          <p role="status">Loading research connections…</p>
        ) : (
          <>
            <p className="knowledge-count">
              {visible.length} matching nodes · Graph shows {shown.length} of{" "}
              {visible.length}
              {visible.length > 60
                ? " (first 60 alphabetically; use search to narrow)"
                : ""}
              . {graph.edges.length} researcher relationships total.
            </p>
            <div className="knowledge-columns">
              <div className="knowledge-overview">
                <div className="knowledge-graph-scroll">
                  <svg
                    className="knowledge-graph"
                    viewBox={`0 0 850 ${graphHeight}`}
                    role="group"
                    aria-label="Research connections graph"
                  >
                    <title>
                      Research connections. Select a labeled node to inspect it.
                    </title>
                    {graph.edges.map((edge) => {
                      const from = positions.get(edge.fromId),
                        to = positions.get(edge.toId);
                      return from && to ? (
                        <line
                          key={edge.id}
                          x1={from.x + 72}
                          y1={from.y + 22}
                          x2={to.x + 72}
                          y2={to.y + 22}
                          className={
                            "knowledge-line " +
                            (edge.fromId === selected || edge.toId === selected
                              ? "highlighted"
                              : "")
                          }
                        >
                          <title>
                            {byRef.get(edge.fromId)?.title} → {edge.label} →{" "}
                            {byRef.get(edge.toId)?.title}
                          </title>
                        </line>
                      ) : null;
                    })}
                    {shown.map((item) => {
                      const p = positions.get(item.ref)!;
                      return (
                        <g
                          key={item.ref}
                          role="button"
                          tabIndex={0}
                          aria-label={`${item.kind}: ${item.title}`}
                          aria-pressed={selected === item.ref}
                          className={
                            "knowledge-node " +
                            (selected === item.ref ? "selected" : "")
                          }
                          transform={`translate(${p.x} ${p.y})`}
                          onClick={() => open(item)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              open(item);
                            }
                          }}
                        >
                          <title>
                            {item.title} ({item.kind})
                          </title>
                          <rect width="144" height="47" rx="7" />
                          <text x="9" y="17" className="knowledge-node-kind">
                            {item.kind}
                          </text>
                          <text x="9" y="35">
                            {item.title.length > 19
                              ? item.title.slice(0, 18) + "…"
                              : item.title}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
                <div
                  className="knowledge-node-list"
                  aria-label="Matching research nodes"
                >
                  {!visible.length && (
                    <p>
                      No matching nodes. Add a topic, person, organization, or
                      claim to connect your research.
                    </p>
                  )}
                  {visible.map((item) => (
                    <button
                      key={item.ref}
                      className={selected === item.ref ? "active" : ""}
                      onClick={() => choose(item.ref)}
                    >
                      <span>{item.title}</span>
                      <small>
                        {item.kind}
                        {item.reference?.archived ? " · archived" : ""}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="knowledge-detail">
                {editor ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const identity = selection.current;
                      try {
                        const result = await mutate(
                          editor.id ? "/nodes/" + editor.id : "/nodes",
                          editor.id ? "PUT" : "POST",
                          {
                            title: editor.title,
                            kind: editor.kind,
                            body: editor.body,
                            tags: editor.tags
                              .split(",")
                              .map((t) => t.trim())
                              .filter(Boolean),
                          },
                        );
                        if (mounted.current && selection.current === identity) {
                          setSelected("node:" + result.id);
                          setEditor(null);
                          setNotice("Research node saved locally.");
                        }
                      } catch {
                        /* error displayed above */
                      }
                    }}
                  >
                    <h3>
                      {editor.id ? "Edit research node" : "New research node"}
                    </h3>
                    <label>
                      Title
                      <input
                        required
                        maxLength={120}
                        value={editor.title}
                        onChange={(e) =>
                          setEditor({ ...editor, title: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Research kind
                      <select
                        disabled={busy}
                        aria-label="Research kind"
                        value={editor.kind}
                        onChange={(e) =>
                          setEditor({ ...editor, kind: e.target.value as Kind })
                        }
                      >
                        {["topic", "person", "organization", "claim"].map(
                          (kind) => (
                            <option key={kind}>{kind}</option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      Research notes
                      <textarea
                        disabled={busy}
                        rows={5}
                        maxLength={10000}
                        value={editor.body}
                        onChange={(e) =>
                          setEditor({ ...editor, body: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Tags (comma separated)
                      <input
                        value={editor.tags}
                        onChange={(e) =>
                          setEditor({ ...editor, tags: e.target.value })
                        }
                      />
                    </label>
                    <div className="knowledge-actions">
                      <button className="primary" disabled={busy}>
                        Save research node
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setEditor(null)}
                      >
                        Cancel edit
                      </button>
                    </div>
                  </form>
                ) : current ? (
                  <>
                    <span className="tag">{current.kind}</span>
                    <h3>{current.title}</h3>
                    {current.node ? (
                      <>
                        <p className="knowledge-body">
                          {current.node.body || "No research notes yet."}
                        </p>
                        <p>
                          {current.node.tags.map((tag) => (
                            <span className="tag" key={tag}>
                              {tag}{" "}
                            </span>
                          ))}
                        </p>
                        <div className="knowledge-actions">
                          <button
                            disabled={busy}
                            onClick={() =>
                              setEditor({
                                ...current.node!,
                                tags: current.node!.tags.join(", "),
                              })
                            }
                          >
                            Edit node
                          </button>
                          <button
                            disabled={busy}
                            onClick={async () => {
                              const ref = current.ref;
                              try {
                                await mutate(
                                  "/nodes/" + current.node!.id,
                                  "DELETE",
                                );
                                if (selection.current === ref) setSelected("");
                                setNotice(
                                  "Research node and its relationships deleted. Captures are preserved.",
                                );
                              } catch {
                                /* error displayed */
                              }
                            }}
                          >
                            Delete research node
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="knowledge-url">
                          {current.reference?.url}
                        </p>
                        {current.reference?.observedAt && (
                          <p>
                            Observed{" "}
                            {new Date(
                              current.reference.observedAt,
                            ).toLocaleString()}
                          </p>
                        )}
                        <p className="muted">
                          Preserved evidence reference. Edit research nodes to
                          add your interpretation.
                        </p>
                        <button
                          onClick={() =>
                            openEvidence(
                              current.reference!.sourceId,
                              current.reference?.captureId ||
                                (current.kind === "capture"
                                  ? current.ref.slice(8)
                                  : undefined),
                            )
                          }
                        >
                          Open{" "}
                          {current.kind === "capture" ? "capture" : "source"}
                        </button>
                      </>
                    )}
                    <h4>Connections &amp; backlinks ({connections.length})</h4>
                    {!connections.length && (
                      <p className="muted">No researcher relationships yet.</p>
                    )}
                    {connections.map((edge) => {
                      const other = byRef.get(
                        edge.fromId === selected ? edge.toId : edge.fromId,
                      );
                      const evidence = byRef.get(
                        "capture:" + edge.evidenceCaptureId,
                      )?.reference;
                      return (
                        <article className="knowledge-connection" key={edge.id}>
                          <small>
                            {edge.fromId === selected ? "Outgoing" : "Incoming"}{" "}
                            · {edge.label}
                          </small>
                          <button
                            className="knowledge-link"
                            onClick={() => choose(other?.ref || "")}
                          >
                            {other?.title || "Unavailable reference"}
                          </button>
                          {edge.note && (
                            <p className="knowledge-body">{edge.note}</p>
                          )}
                          {edge.evidenceCaptureId && (
                            <button
                              disabled={!evidence}
                              onClick={() => {
                                if (evidence)
                                  openEvidence(
                                    evidence.sourceId,
                                    edge.evidenceCaptureId!,
                                  );
                              }}
                            >
                              Inspect supporting capture
                            </button>
                          )}
                          <button
                            disabled={busy}
                            onClick={() =>
                              void mutate("/edges/" + edge.id, "DELETE").catch(
                                () => {},
                              )
                            }
                          >
                            Remove relationship
                          </button>
                        </article>
                      );
                    })}
                  </>
                ) : (
                  <div className="empty">
                    <h3>Follow a connection.</h3>
                    <p>
                      Select a node from the graph or list, or add your own
                      research node.
                    </p>
                  </div>
                )}
                <form
                  className="knowledge-edge-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await mutate("/edges", "POST", {
                        ...relationship,
                        evidenceCaptureId:
                          relationship.evidenceCaptureId || null,
                      });
                      setRelationship((r) => ({ ...r, label: "", note: "" }));
                      setNotice("Research relationship saved locally.");
                    } catch {
                      /* error displayed */
                    }
                  }}
                >
                  <h3>Add a relationship</h3>
                  <p className="small muted">
                    A connection records your interpretation. Attaching a
                    capture provides a reference, not verification.
                  </p>
                  {(["fromId", "toId"] as const).map((key) => (
                    <label key={key}>
                      {key === "fromId" ? "From node" : "To node"}
                      <select
                        aria-label={key === "fromId" ? "From node" : "To node"}
                        required
                        value={relationship[key]}
                        onChange={(e) =>
                          setRelationship({
                            ...relationship,
                            [key]: e.target.value,
                          })
                        }
                      >
                        <option value="">
                          Choose a node or evidence reference
                        </option>
                        {relationshipItems.map((item) => (
                          <option key={item.ref} value={item.ref}>
                            {item.kind}: {item.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label>
                    Relationship label
                    <input
                      required
                      maxLength={80}
                      placeholder="e.g. discusses, cites, relates to"
                      value={relationship.label}
                      onChange={(e) =>
                        setRelationship({
                          ...relationship,
                          label: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Relationship note
                    <textarea
                      rows={3}
                      maxLength={2000}
                      value={relationship.note}
                      onChange={(e) =>
                        setRelationship({
                          ...relationship,
                          note: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Supporting capture (optional)
                    <select
                      aria-label="Supporting capture (optional)"
                      value={relationship.evidenceCaptureId}
                      onChange={(e) =>
                        setRelationship({
                          ...relationship,
                          evidenceCaptureId: e.target.value,
                        })
                      }
                    >
                      <option value="">No supporting capture</option>
                      {(graph.captureChoices || graph.references)
                        .filter((r) => r.kind === "capture")
                        .map((r) => (
                          <option
                            key={r.id}
                            value={r.captureId || r.id.slice(8)}
                          >
                            {r.title}
                            {r.observedAt
                              ? " · " + new Date(r.observedAt).toLocaleString()
                              : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                  {graph.capturesTruncated && (
                    <p className="small muted">
                      Capture choices show the latest 1,000 captures. Existing
                      relationships retain older references.
                    </p>
                  )}
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      relationshipItems.length < 2 ||
                      relationship.fromId === relationship.toId
                    }
                  >
                    Save relationship
                  </button>
                </form>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
