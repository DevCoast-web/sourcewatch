import React, { useEffect, useState } from "react";
import "./research.css";
async function request(path: string, options: RequestInit = {}) {
  const response = await fetch("/api" + path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : {},
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}
export type InboxEvent = {
  id: string;
  sourceId: string;
  sourceName: string;
  captureId: string | null;
  beforeId: string | null;
  kind: "changed" | "failure";
  summary: string;
  readAt: string | null;
  createdAt: string;
};
export function Inbox({
  onClose,
  onOpen,
  onChanged,
}: {
  onClose: () => void;
  onOpen: (event: InboxEvent) => void;
  onChanged: () => void;
}) {
  const [events, setEvents] = useState<InboxEvent[]>([]),
    [unread, setUnread] = useState(false),
    [error, setError] = useState("");
  async function load() {
    try {
      setEvents(
        await request("/research/events" + (unread ? "?unread=true" : "")),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    let live = true;
    request("/research/events" + (unread ? "?unread=true" : ""))
      .then((rows) => {
        if (live) setEvents(rows);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [unread]);
  async function mark(event: InboxEvent) {
    try {
      await request("/research/events/" + event.id, { method: "PATCH" });
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="overlay">
      <section
        className="modal inbox-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inbox-title"
      >
        <button className="close" aria-label="Close inbox" onClick={onClose}>
          ×
        </button>
        <div className="eyebrow">RESEARCH UPDATES</div>
        <h2 id="inbox-title">Change inbox</h2>
        <p className="muted">
          Changes to preserved text, titles, and outbound links, plus capture
          failures. Updates stay on this machine.
        </p>
        <div className="inbox-controls">
          <label>
            <input
              type="checkbox"
              checked={unread}
              onChange={(e) => setUnread(e.target.checked)}
            />{" "}
            Unread only
          </label>
          <button onClick={load}>Refresh inbox</button>
        </div>
        {error && (
          <p role="alert" className="capture-error">
            {error}
          </p>
        )}
        {!events.length && (
          <div className="empty">
            <h3>Nothing to review.</h3>
            <p>
              Capture a changed page to start a trail of updates. Earlier
              captures are not backfilled.
            </p>
          </div>
        )}
        {events.map((event) => (
          <article
            className={"inbox-event " + (!event.readAt ? "unread" : "")}
            key={event.id}
          >
            <span className="tag">
              {event.kind === "changed" ? "Changed" : "Capture failed"}
              {event.readAt ? " · Read" : " · Unread"}
            </span>
            <h3>{event.sourceName}</h3>
            <p>{event.summary}</p>
            <small>{new Date(event.createdAt).toLocaleString()}</small>
            <div>
              <button
                onClick={() => {
                  void mark(event);
                  onOpen(event);
                }}
              >
                Open {event.captureId ? "comparison" : "source"}
              </button>
              {!event.readAt && (
                <button onClick={() => mark(event)}>Mark as read</button>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
export function ResearchNotes({ captureId }: { captureId: string }) {
  const [note, setNote] = useState(""),
    [tags, setTags] = useState(""),
    [saved, setSaved] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    setSaved("");
    request(`/captures/${captureId}/annotation`)
      .then((a) => {
        if (live) {
          setNote(a.note);
          setTags(a.tags.join(", "));
          setLoading(false);
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [captureId]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const result = await request(`/captures/${captureId}/annotation`, {
        method: "PUT",
        body: JSON.stringify({
          note,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      setTags(result.tags.join(", "));
      setSaved("Notes saved locally.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="research-notes">
      <div className="eyebrow">YOUR INTERPRETATION</div>
      <h3>Research notes &amp; tags</h3>
      <p className="small muted">
        Editable notes are separate from the original capture. Nonempty notes
        are included in evidence exports as clearly labeled researcher
        annotations.
      </p>
      <form onSubmit={save}>
        <label>
          Notes
          <textarea
            aria-label="Research notes"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setSaved("");
            }}
            maxLength={10000}
            rows={4}
            disabled={loading}
          />
        </label>
        <label>
          Tags <small>Comma separated, up to 20 tags.</small>
          <input
            aria-label="Research tags"
            value={tags}
            onChange={(e) => {
              setTags(e.target.value);
              setSaved("");
            }}
            disabled={loading}
          />
        </label>
        <div className="notes-actions">
          <button className="primary" disabled={loading}>
            Save notes
          </button>
          <a href={`/api/captures/${captureId}/annotation/export`}>
            ↓ Export notes JSON
          </a>
        </div>
        {saved && <p role="status">{saved}</p>}
        {error && (
          <p role="alert" className="capture-error">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
export function VisualComparison({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  const [reveal, setReveal] = useState(50);
  return (
    <section className="visual-comparison">
      <h3>Screenshot comparison</h3>
      <p className="small muted">
        Slide between actual preserved screenshots, aligned at the top and
        normalized to the same width. This is a visual review tool, not an
        automated pixel diff.
      </p>
      <label>
        Earlier screenshot reveal: {reveal}%
        <input
          type="range"
          aria-label="Earlier screenshot reveal"
          min="0"
          max="100"
          value={reveal}
          onChange={(e) => setReveal(Number(e.target.value))}
        />
      </label>
      <div className="visual-labels">
        <span>Earlier</span>
        <span>Later</span>
      </div>
      <div className="visual-stack">
        <div className={`visual-canvas reveal-${reveal}`}>
          <img
            src={`/api/captures/${after}/files/screenshot.png`}
            alt="Later preserved screenshot"
          />
          <div className="visual-before">
            <img
              src={`/api/captures/${before}/files/screenshot.png`}
              alt="Earlier preserved screenshot"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
export function StructureComparison({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  const [result, setResult] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setResult(null);
    setError("");
    request(`/compare/structure?before=${before}&after=${after}`)
      .then((r) => {
        if (live) setResult(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [before, after]);
  return (
    <section className="structure-comparison">
      <h3>HTML structure</h3>
      <p className="small muted">
        Element nesting and selected semantic attributes. Text, styling,
        scripts, and configured text exclusions are not part of this structural
        outline.
      </p>
      {error ? (
        <p role="alert" className="capture-error">
          {error}
        </p>
      ) : !result ? (
        <p>Comparing saved HTML…</p>
      ) : (
        <>
          {result.truncated && (
            <p role="status">
              Outline truncated at 5,000 elements or 30 nesting levels; changes
              beyond these limits may be absent.
            </p>
          )}
          <p>
            {result.changed
              ? `+${result.added} / −${result.removed} outline lines`
              : "No structural changes detected."}
          </p>
          <pre>
            {result.parts.map(
              (
                part: { value: string; added?: boolean; removed?: boolean },
                i: number,
              ) => (
                <span
                  key={i}
                  className={
                    part.removed ? "removed" : part.added ? "added" : ""
                  }
                >
                  {part.value}
                </span>
              ),
            )}
          </pre>
        </>
      )}
    </section>
  );
}
