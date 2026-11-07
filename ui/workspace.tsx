import { RecordPreview } from "./record-preview.js";
import { ResearchOverview } from "./overview.js";
import { VERSION } from "../src/version.js";
import { GlobalGraph } from "./ecosystem.js";
import React, { useEffect, useRef, useState } from "react";
import { VaultView } from "./vault.js";
import { CanvasView } from "./canvas.js";
import { IntelligenceView } from "./intelligence.js";
import { BasesView, ToolsView } from "./workspace-extras.js";
import "./workspace.css";
import "./desktop-workspace.css";
import "./usability.css";
export function IntegratedWorkspace({
  onClose,
  onOpenSource,
  initialView = "vault",
  sourceMonitor,
  onAddSource,
  onSettings,
  onLegacyConnections,
  onViewChange,
  onSearchCaptures,
  onInbox,
  unread = 0,
}: {
  initialView?: string;
  sourceMonitor?: React.ReactNode;
  onAddSource?: () => void;
  onSettings?: () => void;
  onLegacyConnections?: () => void;
  onViewChange?: (view: string) => void;
  onSearchCaptures?: () => void;
  onInbox?: () => void;
  unread?: number;
  onClose: () => void;
  onOpenSource: (sourceId: string, captureId?: string) => void;
}) {
  const [previewRef, setPreviewRef] = useState("");
  const [view, setView] = useState(initialView),
    [activeRef, setActiveRef] = useState(""),
    [addRef, setAddRef] = useState(""),
    [palette, setPalette] = useState(false),
    [query, setQuery] = useState(""),
    [catalog, setCatalog] = useState<any[]>([]),
    [layouts, setLayouts] = useState<any[]>([]),
    [layoutName, setLayoutName] = useState("My workspace"),
    [theme, setTheme] = useState(
      () => localStorage.getItem("sourcewatch-workspace-theme") || "light",
    ),
    [error, setError] = useState(""),
    [extensions, setExtensions] = useState<any[]>([]);
  useEffect(() => {
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
    };
  }, []);
  const [helpOpen, setHelpOpen] = useState(false);
  const [visited, setVisited] = useState(() => new Set([initialView]));
  useEffect(() => setView(initialView), [initialView]);
  useEffect(() => {
    setVisited((previous) => previous.has(view) ? previous : new Set([...previous, view]));
    onViewChange?.(view);
    const url = new URL(location.href);
    url.searchParams.set("workspace", view);
    window.history.replaceState(null, "", url);
  }, [view, onViewChange]);
  const names: Record<string, string> = { overview: "Research home", monitor: "Sources & captures", graph: "Global Graph", vault: "Notes & vault", canvas: "Canvas", intelligence: "Database & network", bases: "Property views", tools: "Tools & exports" };
  function addSource() { setView("monitor"); onAddSource?.(); }
  const dirty = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.kind) dirty.current[detail.kind] = Boolean(detail.dirty);
    };
    window.addEventListener("sourcewatch-dirty", changed);
    return () => window.removeEventListener("sourcewatch-dirty", changed);
  }, []);
  function safeClose() {
    if (Object.values(dirty.current).some(Boolean)) {
      setError(
        "Wait for autosave, or recover/export the unsaved draft before closing the workspace.",
      );
      return;
    }
    onClose();
  }
  async function load() {
    const [c, l, x] = await Promise.all(
      [
        "/api/workspace/catalog",
        "/api/workspace/layouts",
        "/api/workspace/extensions",
      ].map(async (p) => {
        const r = await fetch(p);
        if (!r.ok) throw Error("Workspace could not load");
        return r.json();
      }),
    );
    setCatalog(c.items);
    setLayouts(l);
    setExtensions(x);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (palette) load().catch((e) => setError(e.message));
  }, [palette]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "p")) {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (e.key === "Escape" && palette) {
        e.stopPropagation();
        setPalette(false);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [palette]);
  function open(ref: string) {
    const kind = ref.split(":")[0];
    if (kind === "attachment" || kind === "node") {
      setPreviewRef(ref);
      return;
    }
    setActiveRef(ref);
    if (["source", "capture"].includes(kind)) {
      fetch("/api/workspace/resolve?ref=" + encodeURIComponent(ref))
        .then((r) => r.json())
        .then((r) => {
          if (!r.sourceId) throw Error("Source reference unavailable");
          if (Object.values(dirty.current).some(Boolean))
            throw Error(
              "Save your workspace draft before opening the source archive.",
            );
          if (sourceMonitor) setView("monitor");
          onOpenSource(r.sourceId, r.captureId);
        })
        .catch((e) => setError(e.message));
      return;
    }
    setView(
      kind === "note" || kind === "vault"
        ? "vault"
        : kind === "canvas"
          ? "canvas"
          : "intelligence",
    );
    setPalette(false);
  }
  function add(ref: string) {
    setAddRef(ref);
    setView("canvas");
  }
  const commands = [
    { title: "Open sources and captures", action: "monitor" },
    { title: "Open research overview", action: "overview" },
    { title: "Open Global Graph", action: "graph" },
    { title: "Open Markdown vault", action: "vault" },
    { title: "Open visual canvas", action: "canvas" },
    { title: "Open entity database and network", action: "intelligence" },
    { title: "Open saved property databases", action: "bases" },
    { title: "Open attachments and workspace tools", action: "tools" },
    ...extensions.filter((e) => e.data.enabled).flatMap((e) => e.data.commands),
  ];
  return (
    <div className="sw-overlay">
      <section
        className={"sw-shell sw-theme-" + theme}
        role={sourceMonitor ? "region" : "dialog"}
        aria-modal={sourceMonitor ? undefined : true}
        aria-labelledby="sw-workspace-title"
      >
        <header className="sw-heading">
          <img className="sw-brand-icon" src="/favicon.svg" alt="" width="40" height="40" />
          <div>
            <span className="eyebrow">
              SOURCEWATCH · CONNECT / RESEARCH / PRESERVE
            </span>
            <h1 id="sw-workspace-title">{names[view] || "Research workspace"}</h1>
          </div>
          <button
            onClick={() => setPalette(true)}
            aria-label="Open command palette"
          >
            Commands · Ctrl K
          </button>
          <button
            onClick={() => {
              const t = theme === "light" ? "dark" : "light";
              setTheme(t);
              localStorage.setItem("sourcewatch-workspace-theme", t);
            }}
          >
            Switch {theme === "light" ? "dark" : "light"} theme
          </button>
          {sourceMonitor ? <>
            <button onClick={() => setHelpOpen((open) => !open)} aria-expanded={helpOpen}>How to use</button>
            <button onClick={onSettings} aria-label="Application settings">Settings</button>
            <button className="primary" onClick={addSource}>+ Add source</button>
          </> : <button onClick={safeClose} aria-label="Close research workspace">×</button>}
        </header>
        <nav className="sw-nav" aria-label="Workspace sections">
          <div className="sw-nav-label">YOUR RESEARCH</div>
          {[
            ["overview", "Overview"],
            ...(sourceMonitor ? [["monitor", "Sources & captures"]] : []),
            ["graph", "Global Graph"],
            ["vault", "Notes & vault"],
            ["canvas", "Canvas"],
            ["intelligence", "Database & network"],
            ["bases", "Property views"],
            ["tools", "Tools & exports"],
          ].map(([id, title]) => (
            <button
              key={id}
              aria-pressed={view === id}
              onClick={() => setView(id)}
            >
              <span aria-hidden="true">
                {
                  {
                    overview: "◫",
                    monitor: "▣",
                    graph: "⌘",
                    vault: "▤",
                    canvas: "◇",
                    intelligence: "▦",
                    bases: "▥",
                    tools: "↓",
                  }[id]
                }
              </span>
              <span>{title}</span>
            </button>
          ))}
          {!sourceMonitor && <><div className="sw-nav-label">MONITOR & PRESERVE</div><button onClick={safeClose}>↙ Source monitor</button></>}
          {onSearchCaptures && <button onClick={onSearchCaptures} aria-label="Search captures"><span aria-hidden="true">⌕</span><span>Search captures</span></button>}
          {onInbox && <button onClick={onInbox} aria-label={`Change inbox (${unread} unread)`}><span aria-hidden="true">◷</span><span>Capture activity{unread ? ` (${unread})` : ""}</span></button>}
          {onLegacyConnections && <details className="sw-advanced"><summary>Additional tools</summary><button onClick={onLegacyConnections}>Research connections</button></details>}
          <div className="sw-nav-foot">
            Local workspace
            <br />
            Your data stays on this device.
            <br />
            SourceWatch {VERSION}
          </div>
        </nav>
        <div className="sw-layouts" hidden={!!sourceMonitor && ["overview", "monitor"].includes(view)}>
          <label>
            Workspace layout
            <select
              aria-label="Saved workspace layout"
              onChange={(e) => {
                const l = layouts.find((l) => l.id === e.target.value);
                if (l) {
                  setView(l.data.view);
                  setActiveRef(l.data.ref || "");
                }
              }}
            >
              <option value="">Restore a layout</option>
              {layouts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.data.title}
                </option>
              ))}
            </select>
          </label>
          <input
            aria-label="Workspace layout name"
            value={layoutName}
            onChange={(e) => setLayoutName(e.target.value)}
          />
          <button
            onClick={async () => {
              try {
                const r = await fetch("/api/workspace/layouts", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    title: layoutName,
                    view,
                    ref: activeRef,
                  }),
                });
                if (!r.ok) throw Error((await r.json()).error);
                await load();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Save workspace layout
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        <main className="sw-content">
          {new URLSearchParams(location.search).get("preview") === "1" && <p className="sw-preview-notice" role="status"><strong>Separate preview workspace.</strong> Your original research has not been moved here. New records are saved locally in a separate preview folder.</p>}
          {helpOpen && <section className="sw-quick-start" aria-label="Quick start"><h2>From website to evidence</h2><ol><li><strong>Add a public website.</strong> Give it a name and collection.</li><li><strong>Capture a version.</strong> SourceWatch saves HTML, readable text and screenshots on this computer. Capture again later to compare.</li><li><strong>Export the evidence ZIP.</strong> Open a source to inspect its captures, export its history and find verification instructions.</li></ol><button onClick={addSource}>Add a website</button><button onClick={() => setHelpOpen(false)}>Got it</button></section>}
          {sourceMonitor && <div hidden={view !== "monitor"} className="sw-monitor-panel">{sourceMonitor}</div>}
          {view === "overview" && (
            <ResearchOverview onOpen={open} onNavigate={setView} onAddSource={addSource} />
          )}
          {(view === "graph" || visited.has("graph")) && <div hidden={view !== "graph"}>
            <GlobalGraph
              active={view === "graph"}
              onOpenReference={open}
              appearance={theme}
            />
          </div>}
          {(view === "vault" || visited.has("vault")) && <div hidden={view !== "vault"}>
            <VaultView
              initialRef={activeRef}
              onOpenReference={open}
              onAddToCanvas={add}
            />
          </div>}
          {(view === "canvas" || visited.has("canvas")) && <div hidden={view !== "canvas"}>
            <CanvasView
              initialRef={activeRef}
              addReference={addRef}
              onReferenceAdded={() => setAddRef("")}
              onOpenReference={open}
            />
          </div>}
          {(view === "intelligence" || visited.has("intelligence")) && <div hidden={view !== "intelligence"}>
            <IntelligenceView
              initialRef={activeRef}
              onOpenReference={open}
              onAddToCanvas={add}
            />
          </div>}
          {view === "bases" && <BasesView onOpenReference={open} />}{" "}
          {view === "tools" && <ToolsView onOpenReference={open} />}
        </main>
        {previewRef && (
          <RecordPreview
            reference={previewRef}
            onClose={() => setPreviewRef("")}
          />
        )}
        {palette && (
          <div className="sw-command-overlay">
            <section
              role="dialog"
              aria-label="Command palette"
              className="sw-command"
            >
              <button
                onClick={() => setPalette(false)}
                aria-label="Close command palette"
              >
                ×
              </button>
              <h2>Go anywhere</h2>
              <input
                autoFocus
                aria-label="Search workspace commands and records"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a command, note, canvas or entity…"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setPalette(false);
                }}
              />
              {commands
                .filter((c) =>
                  c.title.toLowerCase().includes(query.toLowerCase()),
                )
                .map((c, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setView(c.action);
                      setPalette(false);
                    }}
                  >
                    {c.title}
                  </button>
                ))}
              {catalog
                .filter((c) =>
                  c.title.toLowerCase().includes(query.toLowerCase()),
                )
                .slice(0, 30)
                .map((c) => (
                  <button key={c.ref} onClick={() => open(c.ref)}>
                    {c.title}
                    <small>{c.kind}</small>
                  </button>
                ))}
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
