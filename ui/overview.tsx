import { captureFailureMessage } from "./capture-status.js";
import React, { useEffect, useState } from "react";
export function ResearchOverview({
  onOpen,
  onNavigate,
  onAddSource,
}: {
  onOpen: (ref: string) => void;
  onNavigate: (view: string) => void;
  onAddSource: () => void;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [query, setQuery] = useState("");
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const responses = await Promise.all(
          ["/api/ecosystem", "/api/sources?archived=true"].map(async (url) => {
            const r = await fetch(url);
            if (!r.ok) throw Error("Research overview could not load");
            return r.json();
          }),
        );
        if (live) { setData({ graph: responses[0], sources: responses[1] }); setError(""); }
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  if (error && !data) return <section className="desk-empty"><h2>Your research could not load</h2><p role="alert">{error}</p><button onClick={() => onNavigate("monitor")}>Open sources & captures</button></section>;
  if (!data) return <p role="status">Loading your research index…</p>;
  const nodes = data.graph.nodes as any[],
    matches = nodes.filter((n) =>
      [n.title, n.kind, ...n.tags]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
    count = (kind: string) => nodes.filter((n) => n.kind === kind).length,
    investigations = nodes.filter((n) => n.kind === "investigation");
  return (
    <section className="research-overview" aria-label="Research overview">
      <div className="desk-heading task-hero">
        <div>
          <span className="eyebrow">YOUR RESEARCH, ON THE RECORD</span>
          <h2>Save what a website says.<br />See what changes.</h2>
          <p>Start with a public webpage. Capture a version, compare it later, and keep the evidence on your computer.</p>
          <div className="desk-actions"><button className="primary" onClick={onAddSource}>Add a website <span aria-hidden="true">↗</span></button><button onClick={() => onNavigate("monitor")}>Open sources & captures</button></div>
        </div>
        <ol className="desk-steps" aria-label="How SourceWatch works">
          <li><span>01</span><div><strong>Add a public website</strong><p>Give it a name and collection.</p></div></li>
          <li><span>02</span><div><strong>Capture, then compare</strong><p>Save a version now. Capture again later to see additions and deletions.</p></div></li>
          <li><span>03</span><div><strong>Export your evidence</strong><p>Open a source and choose Export evidence ZIP.</p></div></li>
        </ol>
      </div>
      {data.sources.some((s: any) => s.error) && <section className="desk-attention" aria-label="Captures needing attention"><div><span className="eyebrow">NEEDS ATTENTION</span><h3>A capture did not finish</h3><p>No new snapshot was saved. Open the source to see the error and retry.</p></div>{data.sources.filter((s: any) => s.error).map((s: any) => <button key={s.id} onClick={() => onOpen("source:" + s.id)}><strong>{s.name}</strong><span>{captureFailureMessage(s.error)}</span><small>Review failed capture →</small></button>)}</section>}
      {error && <p role="alert">{error}</p>}
      <div className="desk-metrics">
        {[
          ["Websites", data.sources.length],
          ["Saved captures", count("evidence")],
          ["Research records", nodes.length],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{Number(value).toLocaleString()}</strong>
          </div>
        ))}
      </div>
      <div className="desk-layout">
        <div>
          <div className="desk-section-title">
            <h3>Research directory</h3>
            <label>
              Find a record
              <input
                aria-label="Search research directory"
                placeholder="Search notes, entities, evidence…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <table className="desk-table">
            <thead>
              <tr>
                <th>Record</th>
                <th>Category</th>
                <th>Connections</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {matches.slice(0, 50).map((n) => (
                <tr key={n.ref}>
                  <td>
                    <button onClick={() => onOpen(n.ref)}>{n.title}</button>
                    <small>
                      {n.tags.map((t: string) => "#" + t).join(" ")}
                    </small>
                  </td>
                  <td>
                    <span className="record-category">{n.kind}</span>
                  </td>
                  <td>{n.degree}</td>
                  <td>
                    <span className={"review-badge " + n.classification}>
                      {n.classification === "verified"
                        ? "Locally reviewed"
                        : n.classification || "Research context"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!matches.length && (
            <div className="desk-empty">
              <h3>Your research starts with a source.</h3>
              <p>
                Add a website above to save your first capture. Notes, connections and the graph grow from the records you add.
              </p>
              <button onClick={onAddSource}>Add your first website</button>
            </div>
          )}
          {matches.length > 50 && (
            <p className="muted">
              First 50 matching records. Search to narrow the directory; use the
              graph or database for deeper exploration.
            </p>
          )}
        </div>
        <aside className="desk-aside">
          <h3>Investigations</h3>
          {investigations.slice(0, 8).map((n) => (
            <button
              className="desk-investigation"
              key={n.ref}
              onClick={() => onOpen(n.ref)}
            >
              <strong>{n.title}</strong>
              <small>{n.degree} connected records →</small>
            </button>
          ))}
          {!investigations.length && (
            <p className="muted">
              Build a focused collection of records, notes and cited evidence.
            </p>
          )}
          <button onClick={() => onNavigate("intelligence")}>
            Open database & investigations
          </button>
          <div className="desk-method">
            <span className="eyebrow">EVIDENCE, WITH CONTEXT</span>
            <h3>A connection is not a conclusion.</h3>
            <p>
              Notes and annotations remain researcher context. Reviewed
              associations require explicit review and preserved evidence.
            </p>
            <button onClick={() => onNavigate("tools")}>
              Exports & evidence tools →
            </button>
          </div>
          <h3>Monitored sources</h3>
          {data.sources.slice(0, 8).map((s: any) => (
            <button
              className="desk-source"
              key={s.id}
              onClick={() => onOpen("source:" + s.id)}
            >
              <span className={"desk-dot " + (s.error ? "error" : "")} />
              <span>
                {s.name}
                <small>
                  {s.error
                    ? "Capture needs attention"
                    : s.paused
                      ? "Monitoring paused"
                      : s.intervalMinutes
                        ? "Scheduled while running"
                        : "Manual capture"}
                </small>
              </span>
            </button>
          ))}
        </aside>
      </div>
    </section>
  );
}
