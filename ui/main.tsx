import { IntegratedWorkspace } from "./workspace.js";
import { KnowledgeWorkspace } from "./knowledge.js";
import { VERSION } from "../src/version.js";
import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import {
  Inbox,
  ResearchNotes,
  PreservedScreenshot,
  VisualComparison,
  StructureComparison,
  type InboxEvent,
} from "./research.js";
type Source = {
  id: string;
  name: string;
  url: string;
  collection: string;
  description: string;
  archived: number;
  selectors: string[];
  captureCount: number;
  intervalMinutes: number;
  paused: number;
  error: string | null;
  latest: Capture | null;
};
type Capture = {
  id: string;
  observedAt: string;
  title: string;
  finalUrl: string;
  status: number;
  chainHash: string;
  previousHash: string | null;
  warnings: string[];
  ignoredSelectors: string[];
  text?: string;
  headers: Record<string, string>;
  files: Record<string, string>;
  screenshotInfo?: import("../src/capture.js").ScreenshotInfo;
};
type Part = { value: string; added?: boolean; removed?: boolean };
type Comparison = {
  titleChanged: boolean;
  beforeTitle: string;
  afterTitle: string;
  parts: Part[];
  words: Part[];
  added: number;
  removed: number;
  changed: boolean;
  linksAdded: string[];
  linksRemoved: string[];
};
async function api(path: string, options: RequestInit = {}) {
  const r = await fetch("/api" + path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!r.ok) {
    const e = await r.json();
    throw new Error(e.error || "Request failed");
  }
  return r.json();
}
const date = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
function App() {
  const [sources, setSources] = useState<Source[]>([]),
    [selected, setSelected] = useState(""),
    [collection, setCollection] = useState("All collections"),
    [query, setQuery] = useState(""),
    [captureQuery, setCaptureQuery] = useState(""),
    [history, setHistory] = useState<Capture[]>([]),
    [before, setBefore] = useState(""),
    [after, setAfter] = useState(""),
    [comparison, setComparison] = useState<Comparison | null>(null),
    [mode, setMode] = useState("side"),
    [tab, setTab] = useState("changes"),
    [detail, setDetail] = useState<Capture | null>(null),
    [showAdd, setShowAdd] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [exportHash, setExportHash] = useState(""),
    [editing, setEditing] = useState(false),
    [settings, setSettings] = useState<any>(null),
    [showArchived, setShowArchived] = useState(false),
    [globalSearch, setGlobalSearch] = useState(false),
    [searchText, setSearchText] = useState(""),
    [searchResults, setSearchResults] = useState<any[]>([]),
    [captureMatches, setCaptureMatches] = useState<Capture[] | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(
    ["graph", "overview"].includes(
      new URLSearchParams(location.search).get("workspace") || "",
    ),
  );
  const [workspaceView, setWorkspaceView] = useState(
    ["graph", "overview"].includes(
      new URLSearchParams(location.search).get("workspace") || "",
    )
      ? new URLSearchParams(location.search).get("workspace")!
      : "vault",
  );
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false),
    [unread, setUnread] = useState(0),
    [focusCapture, setFocusCapture] = useState<{
      sourceId: string;
      after: string;
      before: string;
    } | null>(null);
  function openUpdate(event: InboxEvent) {
    setShowArchived(true);
    setSelected(event.sourceId);
    setResearchOpen(false);
    if (event.captureId)
      setFocusCapture({
        sourceId: event.sourceId,
        after: event.captureId,
        before: event.beforeId || "",
      });
    else setTab("history");
  }
  useEffect(() => {
    if (
      focusCapture &&
      selected === focusCapture.sourceId &&
      history.some((c) => c.id === focusCapture.after)
    ) {
      setAfter(focusCapture.after);
      setBefore(focusCapture.before);
      setTab(focusCapture.before ? "changes" : "inspect");
      setFocusCapture(null);
    }
  }, [focusCapture, history, selected]);
  const selectedRef = useRef(selected),
    archivedRef = useRef(showArchived),
    afterRef = useRef(after),
    beforeRef = useRef(before);
  selectedRef.current = selected;
  archivedRef.current = showArchived;
  afterRef.current = after;
  beforeRef.current = before;
  const followLatest = useRef<string | null>(null);
  const sourceRequest = useRef(0),
    historyRequest = useRef(0),
    lastHistorySource = useRef("");
  const [serverVersion, setServerVersion] = useState("");
  function updateStatus(status: {
    busy: boolean;
    unread?: number;
    version: string;
  }) {
    setBusy(status.busy);
    setUnread(status.unread || 0);
    setServerVersion(status.version);
  }
  const [comparisonError, setComparisonError] = useState(""),
    [detailError, setDetailError] = useState(""),
    [detailRetry, setDetailRetry] = useState(0);
  const source = sources.find((s) => s.id === selected);
  const collections = [...new Set(sources.map((s) => s.collection))].sort();
  useEffect(() => {
    if (
      !showAdd &&
      !exportHash &&
      !settings &&
      !globalSearch &&
      !researchOpen &&
      !knowledgeOpen
    )
      return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector(
      ".overlay:last-of-type .modal",
    ) as HTMLElement | null;
    const nodes = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select, textarea, a[href]",
        ) || [],
      );
    nodes()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowAdd(false);
        setExportHash("");
        setSettings(null);
        setGlobalSearch(false);
        setResearchOpen(false);
        setKnowledgeOpen(false);
      }
      if (e.key === "Tab") {
        const all = nodes(),
          first = all[0],
          last = all.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [
    showAdd,
    !!exportHash,
    !!settings,
    globalSearch,
    researchOpen,
    knowledgeOpen,
  ]);
  async function refresh() {
    const request = ++sourceRequest.current;
    const rows = await api(
      "/sources" + (archivedRef.current ? "?archived=true" : ""),
    );
    if (request !== sourceRequest.current) return;
    setSources(rows);
    api("/status")
      .then(updateStatus)
      .catch(() => {});
    setSelected((prev) =>
      rows.some((s: Source) => s.id === prev) ? prev : rows[0]?.id || "",
    );
  }
  async function refreshHistory(id: string, preferLatest = false) {
    const request = ++historyRequest.current;
    const selectLatest = preferLatest || followLatest.current === id;
    const rows = await api(`/sources/${id}/captures`);
    if (request !== historyRequest.current || selectedRef.current !== id)
      return;
    setHistory(rows);
    setAfter(
      !selectLatest && rows.some((c: Capture) => c.id === afterRef.current)
        ? afterRef.current
        : rows[0]?.id || "",
    );
    setBefore(
      !selectLatest && rows.some((c: Capture) => c.id === beforeRef.current)
        ? beforeRef.current
        : rows[1]?.id || "",
    );
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      refresh().catch(() => {});
      api("/status")
        .then(updateStatus)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [showArchived]);
  useEffect(() => {
    if (lastHistorySource.current !== selected) {
      lastHistorySource.current = selected;
      setHistory([]);
      setBefore("");
      setAfter("");
      setComparison(null);
      setDetail(null);
      setCaptureQuery("");
      setCaptureMatches(null);
    }
    if (selected) refreshHistory(selected).catch((e) => setError(e.message));
    else setHistory([]);
  }, [selected, source?.captureCount]);
  useEffect(() => {
    let live = true;
    setComparison(null);
    setComparisonError("");
    if (before && after && before !== after)
      api(`/compare?before=${before}&after=${after}`)
        .then((c) => {
          if (live) setComparison(c);
        })
        .catch((e) => {
          if (live) setComparisonError(e.message);
        });
    return () => {
      live = false;
    };
  }, [before, after]);
  useEffect(() => {
    let live = true;
    setDetail(null);
    setDetailError("");
    if (after)
      api(`/captures/${after}`)
        .then((c) => {
          if (live) setDetail(c);
        })
        .catch((e) => {
          if (live) setDetailError(e.message);
        });
    return () => {
      live = false;
    };
  }, [after, detailRetry]);
  async function captureNow() {
    if (!source) return;
    followLatest.current = source.id;
    setBusy(true);
    setError("");
    setNotice("Rendering the page and preserving artifacts…");
    try {
      const captured = await api(`/sources/${source.id}/capture`, {
        method: "POST",
      });
      await refresh();
      await refreshHistory(source.id, true);
      setNotice(
        captured.screenshotInfo && !captured.screenshotInfo.complete
          ? "HTML and text preserved. Visual capture is incomplete; inspect the coverage warning."
          : "Capture preserved. The receipt is in your local history.",
      );
    } catch (e) {
      setError((e as Error).message);
      setNotice("");
    } finally {
      if (followLatest.current === source.id) followLatest.current = null;
      setBusy(false);
    }
  }
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const s = await api(editing ? `/sources/${selected}` : "/sources", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          description: form.get("description"),
          name: form.get("name"),
          url: form.get("url"),
          collection: form.get("collection"),
          intervalMinutes: Number(form.get("interval")),
          selectors: String(form.get("selectors") || "")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      await refresh();
      setSelected(s.id);
      setShowAdd(false);
      setEditing(false);
      setNotice("Source saved. Capture its first receipt when ready.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportEvidence(ids?: string[]) {
    if (!source) return;
    setError("");
    try {
      const r = await fetch(
        `/api/sources/${source.id}/export${ids?.length ? `?ids=${ids.join(",")}` : ""}`,
      );
      if (!r.ok) throw new Error((await r.json()).error);
      setExportHash(r.headers.get("X-Manifest-SHA256") || "");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `sourcewatch-${source.id}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const visible = sources.filter(
    (s) =>
      (collection === "All collections" || s.collection === collection) &&
      `${s.name} ${s.url} ${s.collection}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const filteredHistory = captureMatches || history;
  return (
    <>
      <header className="top">
        <a href="/" className="brand">
          <img className="mark" src="/favicon.svg" alt="" width="42" height="42" />
          <span>
            SOURCEWATCH<small>The internet changes. Keep the receipts.</small>
          </span>
        </a>
        <div className="local">
          <i /> LOCAL WORKSPACE<span>No accounts. Your data stays here.</span>
        </div>
        <button
          className="inbox-button"
          data-count={unread}
          aria-label={`Change inbox (${unread} unread)`}
          onClick={() => setResearchOpen(true)}
        >
          Inbox {unread > 0 ? `(${unread})` : ""}
        </button>
        <button
          onClick={() => {
            setWorkspaceView("graph");
            setWorkspaceOpen(true);
          }}
        >
          Global Graph
        </button>
        <button
          onClick={() => {
            setWorkspaceView("overview");
            setWorkspaceOpen(true);
          }}
        >
          Research directory
        </button>
        <button
          className="workspace-launcher"
          onClick={() => {
            setWorkspaceView("vault");
            setWorkspaceOpen(true);
          }}
        >
          Workspace
        </button>
        <button onClick={() => setKnowledgeOpen(true)}>
          Research connections
        </button>
        <button
          className="search-button"
          aria-label="Search captures"
          onClick={() => setGlobalSearch(true)}
        >
          ⌕ Search captures
        </button>
        <button
          className="settings-button"
          aria-label="Application settings"
          onClick={async () => {
            try {
              setSettings(await api("/settings"));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          ⚙
        </button>
        <button
          className="primary"
          onClick={() => {
            setEditing(false);
            setShowAdd(true);
          }}
        >
          + Add source
        </button>
      </header>
      <div className="shell">
        <aside className="sidebar">
          <div className="eyebrow">YOUR RESEARCH</div>
          <button
            className={collection === "All collections" ? "nav active" : "nav"}
            onClick={() => setCollection("All collections")}
          >
            ◫ All sources <span>{sources.length}</span>
          </button>
          <div className="eyebrow space">COLLECTIONS</div>
          {collections.map((c) => (
            <button
              key={c}
              className={collection === c ? "nav active" : "nav"}
              onClick={() => setCollection(c)}
            >
              ▱ {c}
              <span>{sources.filter((s) => s.collection === c).length}</span>
            </button>
          ))}
          {!collections.length && (
            <p className="muted small">
              Collections appear when you add your first source.
            </p>
          )}
          <button
            className="nav space"
            onClick={async () => {
              try {
                setSettings(await api("/settings"));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            ⚙ Application settings
          </button>
          <label className="archive-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />{" "}
            Show archived sources
          </label>
          <div className="sidebar-note">
            <span className="seal">✓</span>
            <strong>Evidence, with context.</strong>
            <p>
              Every capture is hashed and linked to the one before it.
              Observation times come from your machine.
            </p>
            <a
              href="#integrity"
              onClick={(e) => {
                e.preventDefault();
                setNotice(
                  "Hash chains show consistency with a retained manifest. They do not prove website authenticity or certify publication times. Export and retain your manifest hash separately.",
                );
              }}
            >
              About tamper evidence ↗
            </a>
          </div>
        </aside>
        <main>
          <div className="page-heading">
            <div className="eyebrow">OBSERVE / COMPARE / PRESERVE</div>
            <h1>Your sources, on the record.</h1>
            <p className="muted">
              A durable history of the pages that matter to your research.
            </p>
          </div>
          <div className="stats">
            <div>
              <span>MONITORED SOURCES</span>
              <strong>{sources.length.toString().padStart(2, "0")}</strong>
            </div>
            <div>
              <span>PRESERVED CAPTURES</span>
              <strong>
                {sources
                  .reduce((n, s) => n + s.captureCount, 0)
                  .toString()
                  .padStart(2, "0")}
              </strong>
            </div>
            <div>
              <span>COLLECTIONS</span>
              <strong>{collections.length.toString().padStart(2, "0")}</strong>
            </div>
            <div className="stat-note">
              <i /> Local-first. Independently verifiable.
            </div>
          </div>
          {serverVersion && serverVersion !== VERSION && (
            <div role="alert" className="alert error">
              <span>
                Restart SOURCEWATCH to load this update. The browser interface
                is {VERSION}, but the running service is {serverVersion}. Stop
                the old terminal server, run start-sourcewatch.cmd, then refresh
                this page.
              </span>
            </div>
          )}
          {error && (
            <div role="alert" className="alert error">
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert">
              <span>{notice}</span>
              <button onClick={() => setNotice("")} aria-label="Dismiss notice">
                ×
              </button>
            </div>
          )}
          <section className="workspace">
            <div className="source-list">
              <div className="list-heading">
                <h2>
                  {collection === "All collections" ? "Sources" : collection}
                </h2>
                <span>{visible.length}</span>
              </div>
              <label className="search">
                <span>⌕</span>
                <input
                  aria-label="Search sources"
                  placeholder="Search sources or collections"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="sources">
                {visible.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelected(s.id)}
                    className={`source ${s.id === selected ? "selected" : ""}`}
                  >
                    <div className="source-top">
                      <span className="site-icon">
                        {s.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="source-name">
                        {s.name}
                        <small>{new URL(s.url).hostname}</small>
                      </span>
                      <span
                        className={
                          s.error ? "dot bad" : s.latest ? "dot" : "dot idle"
                        }
                      />
                    </div>
                    <div className="source-bottom">
                      <span>{s.collection}</span>
                      <span>
                        {s.archived
                          ? "Archived"
                          : s.paused
                            ? "Schedule paused"
                            : s.error
                              ? "Capture failed"
                              : s.latest
                                ? date(s.latest.observedAt)
                                : "Awaiting first capture"}
                      </span>
                    </div>
                  </button>
                ))}
                {!visible.length && (
                  <div className="empty small">
                    <strong>
                      {sources.length
                        ? "No matching sources"
                        : "Start a paper trail."}
                    </strong>
                    <p>Add a public page to preserve its first version.</p>
                    <button onClick={() => setShowAdd(true)}>
                      + Add your first source
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="source-detail">
              {source ? (
                <>
                  <div className="detail-heading">
                    <div>
                      <span className="tag">
                        {source.collection}
                        {source.archived ? " · Archived" : ""}
                      </span>
                      <h2>{source.name}</h2>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.url} ↗
                      </a>
                    </div>
                    <button
                      className="primary"
                      disabled={busy || !!source.archived}
                      onClick={captureNow}
                    >
                      {busy ? "Capturing…" : "+ Capture now"}
                    </button>
                  </div>
                  <div className="detail-meta">
                    <span>
                      {source.intervalMinutes
                        ? `Every ${source.intervalMinutes} minutes`
                        : "Manual captures"}
                    </span>
                    {source.intervalMinutes > 0 && (
                      <button
                        onClick={async () => {
                          try {
                            await api(`/sources/${source.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ paused: !source.paused }),
                            });
                            await refresh();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        {source.paused ? "Resume schedule" : "Pause schedule"}
                      </button>
                    )}
                    <span>{source.captureCount} receipts</span>
                    <button
                      onClick={() => {
                        setEditing(true);
                        setShowAdd(true);
                      }}
                    >
                      Edit source
                    </button>
                    <button
                      disabled={!history.length}
                      onClick={() => exportEvidence()}
                    >
                      ↓ Export evidence ZIP
                    </button>
                  </div>
                  {source.description && (
                    <p className="source-description">{source.description}</p>
                  )}
                  {!!source.archived && (
                    <p className="capture-error">
                      Archived source. Restore it in Edit source to resume
                      captures.
                    </p>
                  )}
                  {source.error && (
                    <p className="capture-error">
                      Last capture failed: {source.error}
                    </p>
                  )}
                  {source.latest?.screenshotInfo &&
                    !source.latest.screenshotInfo.complete && (
                      <p role="status" className="visual-warning">
                        Latest capture: HTML and text preserved; visual coverage
                        is incomplete. Inspect the capture for details.
                      </p>
                    )}
                  <div className="tabs">
                    <button
                      className={tab === "changes" ? "current" : ""}
                      onClick={() => setTab("changes")}
                    >
                      Changes
                    </button>
                    <button
                      className={tab === "history" ? "current" : ""}
                      onClick={() => setTab("history")}
                    >
                      Revision history
                    </button>
                    <button
                      className={tab === "inspect" ? "current" : ""}
                      onClick={() => setTab("inspect")}
                    >
                      Inspect capture
                    </button>
                  </div>
                  {tab === "changes" && (
                    <>
                      {history.length < 2 ? (
                        <div className="empty">
                          <span className="empty-symbol">◧</span>
                          <h3>
                            {history.length
                              ? "One receipt. A starting point."
                              : "Give this page a memory."}
                          </h3>
                          <p>
                            {history.length
                              ? "Capture again after the page changes to compare versions."
                              : "Capture the rendered page, readable text, metadata, and a full-page screenshot."}
                          </p>
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={captureNow}
                          >
                            {history.length
                              ? "Capture another version"
                              : "Capture first version"}
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="compare-controls">
                            <label>
                              EARLIER
                              <select
                                aria-label="Earlier capture"
                                value={before}
                                onChange={(e) => setBefore(e.target.value)}
                              >
                                {history.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {date(c.observedAt)} · {c.id.slice(0, 6)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <span>→</span>
                            <label>
                              LATER
                              <select
                                aria-label="Later capture"
                                value={after}
                                onChange={(e) => setAfter(e.target.value)}
                              >
                                {history.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {date(c.observedAt)} · {c.id.slice(0, 6)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <div className="research-view-controls">
                            <button
                              className={mode === "side" ? "chosen" : ""}
                              onClick={() => setMode("side")}
                            >
                              Side by side
                            </button>
                            <button
                              className={mode === "inline" ? "chosen" : ""}
                              onClick={() => setMode("inline")}
                            >
                              Inline
                            </button>
                            <button
                              className={mode === "visual" ? "chosen" : ""}
                              onClick={() => setMode("visual")}
                            >
                              Screenshots
                            </button>
                            <button
                              className={mode === "structure" ? "chosen" : ""}
                              onClick={() => setMode("structure")}
                            >
                              HTML structure
                            </button>
                          </div>
                          <div className="export-selection">
                            <button
                              onClick={() => exportEvidence([before, after])}
                            >
                              ↓ Export compared versions
                            </button>
                            <span>
                              Includes earlier chain records needed for
                              independent verification.
                            </span>
                          </div>
                          {before === after ? (
                            <div className="empty">
                              Choose two different captures.
                            </div>
                          ) : mode === "visual" ? (
                            <VisualComparison before={before} after={after} />
                          ) : mode === "structure" ? (
                            <StructureComparison
                              before={before}
                              after={after}
                            />
                          ) : comparison ? (
                            <>
                              {comparison.titleChanged && (
                                <p className="title-change">
                                  Title changed:{" "}
                                  <del>{comparison.beforeTitle}</del> →{" "}
                                  <ins>{comparison.afterTitle}</ins>
                                </p>
                              )}
                              <div className="diff-toolbar">
                                <span>
                                  <b className="addition">
                                    +{comparison.added} lines
                                  </b>
                                  <b className="deletion">
                                    −{comparison.removed} lines
                                  </b>
                                  {!comparison.changed &&
                                    "No text, title, or outbound-link changes"}
                                </span>
                              </div>
                              {mode === "side" ? (
                                <div className="diff-grid">
                                  <div>
                                    <div className="diff-label">
                                      EARLIER VERSION
                                    </div>
                                    <pre>
                                      {comparison.parts
                                        .filter((p) => !p.added)
                                        .map((p, i) => (
                                          <span
                                            key={i}
                                            className={
                                              p.removed ? "removed" : ""
                                            }
                                          >
                                            {p.value}
                                          </span>
                                        ))}
                                    </pre>
                                  </div>
                                  <div>
                                    <div className="diff-label">
                                      LATER VERSION
                                    </div>
                                    <pre>
                                      {comparison.parts
                                        .filter((p) => !p.removed)
                                        .map((p, i) => (
                                          <span
                                            key={i}
                                            className={p.added ? "added" : ""}
                                          >
                                            {p.value}
                                          </span>
                                        ))}
                                    </pre>
                                  </div>
                                </div>
                              ) : (
                                <pre className="inline-diff">
                                  {comparison.words.map((p, i) =>
                                    p.removed ? (
                                      <del key={i}>{p.value}</del>
                                    ) : p.added ? (
                                      <ins key={i}>{p.value}</ins>
                                    ) : (
                                      <span key={i}>{p.value}</span>
                                    ),
                                  )}
                                </pre>
                              )}

                              <div className="link-changes">
                                <h3>Outbound links</h3>
                                {!comparison.linksAdded.length &&
                                !comparison.linksRemoved.length ? (
                                  <p className="muted small">
                                    No outbound link changes.
                                  </p>
                                ) : (
                                  <>
                                    {comparison.linksRemoved.map((l) => (
                                      <p className="deletion" key={"r" + l}>
                                        − {l}
                                      </p>
                                    ))}
                                    {comparison.linksAdded.map((l) => (
                                      <p className="addition" key={"a" + l}>
                                        + {l}
                                      </p>
                                    ))}
                                  </>
                                )}
                              </div>
                              <p className="comparison-note">
                                Red marks deleted text; green marks additions.
                                Replacements appear as a deletion and an
                                addition. Ignored regions affect text and links
                                only.
                              </p>
                            </>
                          ) : (
                            <div
                              className="empty"
                              role={comparisonError ? "alert" : undefined}
                            >
                              {comparisonError || "Loading comparison…"}
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                  {tab === "history" && (
                    <div className="history">
                      <label className="search">
                        <input
                          aria-label="Search capture text"
                          placeholder="Search full capture text (press Enter)"
                          value={captureQuery}
                          onChange={(e) => setCaptureQuery(e.target.value)}
                          onKeyDown={async (e) => {
                            if (e.key === "Enter") {
                              try {
                                const rows = await api(
                                  `/sources/${selected}/captures?q=${encodeURIComponent(captureQuery)}`,
                                );
                                if (selectedRef.current === selected)
                                  setCaptureMatches(rows);
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            }
                          }}
                        />
                      </label>
                      <button
                        className="small"
                        onClick={() => {
                          setCaptureMatches(null);
                          setCaptureQuery("");
                        }}
                      >
                        Reset search
                      </button>
                      {filteredHistory.map((c) => (
                        <button
                          className="revision"
                          key={c.id}
                          onClick={() => {
                            setAfter(c.id);
                            setTab("inspect");
                          }}
                        >
                          <span className="receipt-icon">▤</span>
                          <span>
                            <strong>{c.title || "Untitled page"}</strong>
                            <small>
                              {date(c.observedAt)} · HTTP {c.status} ·{" "}
                              {c.id.slice(0, 8)}
                            </small>
                          </span>
                          <span className="tag">
                            {c.screenshotInfo && !c.screenshotInfo.complete
                              ? "Visual incomplete ↗"
                              : "Preserved ↗"}
                          </span>
                        </button>
                      ))}
                      {!history.length && (
                        <p className="empty">No captures found.</p>
                      )}
                    </div>
                  )}
                  {tab === "inspect" &&
                    (detail ? (
                      <div className="inspect">
                        <label>
                          CAPTURE
                          <select
                            aria-label="Inspect capture"
                            value={after}
                            onChange={(e) => setAfter(e.target.value)}
                          >
                            {history.map((c) => (
                              <option key={c.id} value={c.id}>
                                {date(c.observedAt)} · {c.id.slice(0, 8)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="small"
                          onClick={() => exportEvidence([after])}
                        >
                          ↓ Export evidence through this capture
                        </button>
                        <div className="artifact-links">
                          {[...Object.keys(detail.files), "metadata.json"].map(
                            (n) => (
                              <a
                                key={n}
                                href={`/api/captures/${after}/files/${n}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                ↓ {n}
                              </a>
                            ),
                          )}
                        </div>
                        <dl>
                          <dt>Observed locally</dt>
                          <dd>{new Date(detail.observedAt).toISOString()}</dd>
                          <dt>Final URL</dt>
                          <dd>{detail.finalUrl}</dd>
                          <dt>Chain SHA-256</dt>
                          <dd className="mono">{detail.chainHash}</dd>
                          <dt>Ignored selectors</dt>
                          <dd>
                            {detail.ignoredSelectors.join(", ") || "None"}
                          </dd>
                        </dl>
                        <ResearchNotes key={after} captureId={after} />
                        {detail.warnings.length > 0 && (
                          <details>
                            <summary>
                              {detail.warnings.length} capture warnings
                            </summary>
                            <pre>{detail.warnings.join("\n")}</pre>
                          </details>
                        )}
                        <details>
                          <summary>Response headers</summary>
                          <pre>{JSON.stringify(detail.headers, null, 2)}</pre>
                        </details>
                        <details>
                          <summary>Readable text</summary>
                          <pre>{detail.text}</pre>
                        </details>
                        <PreservedScreenshot
                          record={detail}
                          label={"Full-page capture of " + detail.title}
                        />
                      </div>
                    ) : (
                      <div className="empty">
                        {after
                          ? detailError || "Loading capture…"
                          : "Capture a page to inspect its artifacts."}
                        {detailError && (
                          <button onClick={() => setDetailRetry((n) => n + 1)}>
                            Retry capture details
                          </button>
                        )}
                      </div>
                    ))}
                </>
              ) : (
                <div className="empty welcome">
                  <span className="empty-symbol">▤</span>
                  <h2>The next version deserves a receipt.</h2>
                  <p>
                    Track public pages. See what changed.
                    <br />
                    Keep the evidence on your own machine.
                  </p>
                  <button className="primary" onClick={() => setShowAdd(true)}>
                    + Add a source
                  </button>
                </div>
              )}
            </div>
          </section>
          <footer>
            SOURCEWATCH{" "}
            <span>Local observations. Portable evidence. Open source.</span>
            <span>v{serverVersion || VERSION}</span>
          </footer>
        </main>
      </div>
      {showAdd && (
        <div
          className="overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAdd(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-title"
            className="modal"
          >
            <button
              className="close"
              aria-label="Close dialog"
              onClick={() => setShowAdd(false)}
            >
              ×
            </button>
            <div className="eyebrow">START KEEPING RECEIPTS</div>
            <h2 id="add-title">{editing ? "Edit source" : "Add a source"}</h2>
            <p className="muted">
              Public HTML pages only. No logins or access-control bypasses.
            </p>
            <form onSubmit={add}>
              <label>
                Website URL
                <input
                  autoFocus
                  name="url"
                  defaultValue={editing ? source?.url : ""}
                  disabled={editing}
                  type="url"
                  placeholder="https://example.org/news"
                  required
                  maxLength={2048}
                />
              </label>
              <div className="form-row">
                <label>
                  Source name
                  <input
                    name="name"
                    defaultValue={editing ? source?.name : ""}
                    placeholder="Company newsroom"
                    maxLength={120}
                  />
                </label>
                <label>
                  Collection
                  <input
                    name="collection"
                    defaultValue={editing ? source?.collection : ""}
                    placeholder="Research"
                    list="collections"
                    maxLength={80}
                  />
                  <datalist id="collections">
                    {collections.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </datalist>
                </label>
              </div>
              <label>
                Description
                <textarea
                  name="description"
                  defaultValue={editing ? source?.description : ""}
                  maxLength={2000}
                  rows={2}
                />
              </label>
              <label>
                Monitoring interval
                <select
                  name="interval"
                  defaultValue={editing ? source?.intervalMinutes : 0}
                >
                  <option value="0">Manual only</option>
                  <option value="5">Every 5 minutes</option>
                  <option value="60">Every hour</option>
                  <option value="360">Every 6 hours</option>
                  <option value="1440">Every day</option>
                </select>
              </label>
              <label>
                Ignore dynamic regions{" "}
                <small>
                  CSS selectors, one per line. Applied to text and link
                  comparison.
                </small>
                <textarea
                  name="selectors"
                  defaultValue={editing ? source?.selectors.join("\n") : ""}
                  placeholder={".live-clock\n#rotating-banner"}
                  rows={3}
                />
              </label>
              <p className="small muted">
                Scheduled captures run while the local service is open.
                Screenshots retain ignored regions.
              </p>
              {error && (
                <p role="alert" className="capture-error">
                  {error}
                </p>
              )}
              <button className="primary wide" disabled={busy}>
                {editing ? "Save source" : "Add source"}
              </button>
            </form>
            {editing && source && (
              <button
                className="archive-button"
                onClick={async () => {
                  try {
                    await api(`/sources/${source.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ archived: !source.archived }),
                    });
                    setShowAdd(false);
                    setSelected("");
                    await refresh();
                    setNotice(
                      source.archived
                        ? "Source restored."
                        : "Source removed from active monitoring. Historical evidence is retained; enable Show archived sources to find it.",
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {source.archived
                  ? "Restore source"
                  : "Remove source from monitoring (archive)"}
              </button>
            )}
          </section>
        </div>
      )}
      {exportHash && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
          >
            <button
              className="close"
              aria-label="Close export details"
              onClick={() => setExportHash("")}
            >
              ×
            </button>
            <div className="eyebrow">PORTABLE EVIDENCE</div>
            <h2 id="export-title">Your receipts are ready.</h2>
            <p>
              The ZIP includes the selected history and its earlier chain
              records, artifacts, a checksum manifest, and a standalone
              verifier.
            </p>
            <p>
              Extract the ZIP, open a terminal in the extracted folder, and run:
            </p>
            <pre>node verify.mjs .</pre>
            <p>Retain this manifest SHA-256 separately:</p>
            <pre className="hash">{exportHash}</pre>
            <p className="muted small">
              This checks integrity against a manifest. It does not
              independently certify timestamps or prove website authenticity.
            </p>
          </section>
        </div>
      )}
      {settings && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <button
              className="close"
              aria-label="Close settings"
              onClick={() => setSettings(null)}
            >
              ×
            </button>
            <div className="eyebrow">LOCAL WORKSPACE</div>
            <h2 id="settings-title">Application settings</h2>
            {error && (
              <p role="alert" className="capture-error">
                {error}
              </p>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api("/settings", {
                    method: "PATCH",
                    body: JSON.stringify({
                      screenshotMode: new FormData(e.currentTarget).get(
                        "screenshotMode",
                      ),
                      preserveTextOnScreenshotFailure:
                        new FormData(e.currentTarget).get(
                          "preserveTextOnScreenshotFailure",
                        ) === "on",
                      maxScreenshotHeight: Number(
                        new FormData(e.currentTarget).get(
                          "maxScreenshotHeight",
                        ),
                      ),
                      settleMs: Number(
                        new FormData(e.currentTarget).get("settleMs"),
                      ),
                    }),
                  });
                  setSettings(null);
                  setError("");
                  setNotice("Settings saved locally.");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <label>
                Render settle delay (milliseconds)
                <input
                  name="settleMs"
                  type="number"
                  min="0"
                  max="5000"
                  defaultValue={settings.settleMs}
                  required
                />
              </label>
              <p className="muted">
                Wait after the document loads to let dynamic content render.
                Range: 0–5000 milliseconds.
              </p>
              <label>
                Maximum screenshot height (pixels)
                <input
                  name="maxScreenshotHeight"
                  type="number"
                  min="1000"
                  max="200000"
                  step="1000"
                  defaultValue={settings.maxScreenshotHeight ?? 100000}
                  required
                />
              </label>
              <label>
                Screenshot format
                <select
                  aria-label="Screenshot format"
                  name="screenshotMode"
                  defaultValue={settings.screenshotMode || "single"}
                >
                  <option value="single">Single full-page PNG</option>
                  <option value="tiled">Tiled images for long pages</option>
                </select>
              </label>
              <label className="fallback-option">
                <input
                  type="checkbox"
                  name="preserveTextOnScreenshotFailure"
                  defaultChecked={
                    settings.preserveTextOnScreenshotFailure !== false
                  }
                />{" "}
                Preserve HTML and text if screenshots fail
              </label>
              <p className="small muted">
                Tiled mode captures up to 64 ordered images of 8,192px each
                (524,288px total), with a 64 MiB image budget. It bypasses the
                single-image height and area limits. Incomplete visual coverage
                is explicitly recorded. Infinite scrolling and off-screen lazy
                content are not automatically loaded.
              </p>
              <p className="screenshot-setting-note">
                Default 100,000px; configurable up to 200,000px. A separate
                160-million-pixel area limit and 4,096px width limit bound
                memory use.
              </p>
              <p>
                Capture limits: 45 seconds, 150 requests, 8 MiB per response, 32
                MiB total. One capture at a time.
              </p>
              <p className="small muted">
                Data is stored in the local data directory. No automatic
                deletion. Stop the service before backing up or removing its
                database and captures.
              </p>
              <button className="primary wide">Save settings</button>
            </form>
          </section>
        </div>
      )}
      {globalSearch && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="search-title"
          >
            <button
              className="close"
              aria-label="Close search"
              onClick={() => setGlobalSearch(false)}
            >
              ×
            </button>
            <h2 id="search-title">Search preserved text</h2>
            {error && (
              <p role="alert" className="capture-error">
                {error}
              </p>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  setSearchResults(
                    await api("/search?q=" + encodeURIComponent(searchText)),
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <label>
                Search every source
                <input
                  autoFocus
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  required
                  maxLength={200}
                />
              </label>
              <button className="primary wide">Search captures</button>
            </form>
            <p className="small muted">
              Up to 100 results, including archived sources.
            </p>
            {searchResults.map((r) => (
              <button
                className="search-result"
                key={r.id}
                onClick={() => {
                  if (r.archived) setShowArchived(true);
                  setSelected(r.sourceId);
                  setGlobalSearch(false);
                  setFocusCapture({
                    sourceId: r.sourceId,
                    after: r.id,
                    before: "",
                  });
                  setTab("inspect");
                }}
              >
                <strong>
                  {r.sourceName} · {date(r.observedAt)}
                </strong>
                <small>{r.snippet}</small>
              </button>
            ))}
          </section>
        </div>
      )}
      {workspaceOpen && (
        <IntegratedWorkspace
          initialView={workspaceView}
          onClose={() => setWorkspaceOpen(false)}
          onOpenSource={(sourceId, captureId) => {
            setWorkspaceOpen(false);
            setShowArchived(true);
            setSelected(sourceId);
            if (captureId)
              setFocusCapture({ sourceId, after: captureId, before: "" });
            else setTab("history");
          }}
        />
      )}
      {knowledgeOpen && (
        <KnowledgeWorkspace
          onClose={() => setKnowledgeOpen(false)}
          onOpenSource={(sourceId, captureId) => {
            setKnowledgeOpen(false);
            setShowArchived(true);
            setSelected(sourceId);
            if (captureId)
              setFocusCapture({ sourceId, after: captureId, before: "" });
            else setTab("history");
          }}
        />
      )}
      {researchOpen && (
        <Inbox
          onClose={() => setResearchOpen(false)}
          onOpen={openUpdate}
          onChanged={() => {
            api("/status")
              .then((s) => setUnread(s.unread || 0))
              .catch(() => {});
          }}
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
