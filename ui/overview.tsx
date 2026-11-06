import React, { useEffect, useState } from "react";
export function ResearchOverview({
  onOpen,
  onNavigate,
}: {
  onOpen: (ref: string) => void;
  onNavigate: (view: string) => void;
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
        if (live) setData({ graph: responses[0], sources: responses[1] });
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
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Loading your research index…</p>;
  const nodes = data.graph.nodes as any[],
    edges = data.graph.edges as any[],
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
      <div className="desk-heading">
        <div>
          <span className="eyebrow">YOUR LOCAL RESEARCH INDEX</span>
          <h2>Follow the record.</h2>
          <p>
            Preserve the source. Connect the context. Keep the evidence in
            reach.
          </p>
        </div>
        <button className="primary" onClick={() => onNavigate("graph")}>
          Explore the ecosystem →
        </button>
      </div>
      <div className="desk-metrics">
        {[
          ["Indexed records", nodes.length],
          ["Preserved captures", count("evidence")],
          ["Entities", count("entity")],
          ["Documented links", edges.length],
          [
            "Reviewed associations",
            edges.filter((e) => e.kind === "verified").length,
          ],
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
                Add a public page in the source monitor, create a note, or begin
                an investigation. No demo records are added automatically.
              </p>
              <button onClick={() => onNavigate("vault")}>Open notes</button>
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
