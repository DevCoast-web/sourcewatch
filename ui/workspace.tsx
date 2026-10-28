import React, { useEffect, useRef, useState } from "react";
import { VaultView } from "./vault.js";
import { CanvasView } from "./canvas.js";
import { IntelligenceView } from "./intelligence.js";
import { BasesView, ToolsView } from "./workspace-extras.js";
import "./workspace.css";
export function IntegratedWorkspace({
  onClose,
  onOpenSource,
}: {
  onClose: () => void;
  onOpenSource: (sourceId: string, captureId?: string) => void;
}) {
  const [view, setView] = useState("vault"),
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="sw-workspace-title"
      >
        <header className="sw-heading">
          <div>
            <span className="eyebrow">
              SOURCEWATCH · CONNECT / RESEARCH / PRESERVE
            </span>
            <h1 id="sw-workspace-title">Research workspace</h1>
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
          <button onClick={safeClose} aria-label="Close research workspace">
            ×
          </button>
        </header>
        <nav className="sw-nav" aria-label="Workspace sections">
          {[
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
              {title}
            </button>
          ))}
        </nav>
        <div className="sw-layouts">
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
          <div hidden={view !== "vault"}>
            <VaultView
              initialRef={activeRef}
              onOpenReference={open}
              onAddToCanvas={add}
            />
          </div>
          <div hidden={view !== "canvas"}>
            <CanvasView
              initialRef={activeRef}
              addReference={addRef}
              onReferenceAdded={() => setAddRef("")}
              onOpenReference={open}
            />
          </div>
          <div hidden={view !== "intelligence"}>
            <IntelligenceView
              initialRef={activeRef}
              onOpenReference={open}
              onAddToCanvas={add}
            />
          </div>
          {view === "bases" && <BasesView onOpenReference={open} />}{" "}
          {view === "tools" && <ToolsView onOpenReference={open} />}
        </main>
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
