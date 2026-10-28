import React, { useEffect, useRef, useState } from "react";
import "./vault.css";
type NoteData = {
  title: string;
  body: string;
  aliases: string[];
  tags: string[];
  properties: Record<string, unknown>;
  vaultId: string;
  folder: string;
  refs: string[];
};
type Row = {
  id: string;
  kind: string;
  data: NoteData;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
type Link = {
  raw: string;
  target: string;
  label: string;
  heading: string;
  start: number;
  end: number;
  targetRef: string | null;
  status: string;
};
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/vault" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Vault request failed");
  return result;
}
function inline(
  value: string,
  links: Link[],
  open: (ref: string) => void,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex =
    /(\[\[[^\]\n]+\]\]|\[[^\]\n]+\]\([^\s)]+\)|\*\*[^*]+\*\*|`[^`]+`|\[\^[^\]]+\])/g;
  let last = 0;
  for (const match of value.matchAll(regex)) {
    parts.push(value.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("[[")) {
      const link = links.find(
        (item) => item.raw === token || item.raw === `!${token}`,
      );
      parts.push(
        <button
          type="button"
          className="vault-wikilink"
          key={match.index}
          disabled={!link?.targetRef}
          title={link?.targetRef || link?.status || "Unresolved note"}
          onClick={() => link?.targetRef && open(link.targetRef)}
        >
          {link?.label || token.slice(2, -2)}
        </button>,
      );
    } else if (token.startsWith("**"))
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`"))
      parts.push(<code key={match.index}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("[^"))
      parts.push(
        <a key={match.index} href={`#footnote-${token.slice(2, -1)}`}>
          {token}
        </a>,
      );
    else {
      const parsed = /^\[([^]+)\]\(([^]+)\)$/.exec(token)!;
      parts.push(
        /^https?:\/\//i.test(parsed[2]) ? (
          <a
            key={match.index}
            href={parsed[2]}
            target="_blank"
            rel="noreferrer noopener"
          >
            {parsed[1]} ↗
          </a>
        ) : (
          <span key={match.index}>
            {parsed[1]} ({parsed[2]})
          </span>
        ),
      );
    }
    last = match.index! + token.length;
  }
  parts.push(value.slice(last));
  return parts;
}
export function MarkdownReading({
  body,
  links = [],
  onOpenReference,
}: {
  body: string;
  links?: Link[];
  onOpenReference: (ref: string) => void;
}) {
  const blocks: React.ReactNode[] = [];
  const lines = body.split("\n");
  let heading = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      fence = /^\s*(```|~~~)(.*)$/.exec(line);
    if (fence) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trim().startsWith(fence[1]))
        code.push(lines[i]);
      blocks.push(
        <pre key={i}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      const Tag = `h${h[1].length}` as keyof React.JSX.IntrinsicElements;
      blocks.push(
        <Tag id={`heading-${heading++}`} key={i}>
          {inline(h[2], links, onOpenReference)}
        </Tag>,
      );
      continue;
    }
    const foot = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(line);
    if (foot) {
      blocks.push(
        <p id={`footnote-${foot[1]}`} className="vault-footnote" key={i}>
          <sup>{foot[1]}</sup> {inline(foot[2], links, onOpenReference)}
        </p>,
      );
      continue;
    }
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) {
      blocks.push(<hr key={i} />);
      continue;
    }
    const item = /^\s*(?:[-*+]|\d+\.)\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
    if (item) {
      blocks.push(
        <div className="vault-listitem" key={i}>
          {item[1] !== undefined ? (
            <input
              type="checkbox"
              checked={item[1].toLowerCase() === "x"}
              readOnly
              aria-label={item[2]}
            />
          ) : (
            <span aria-hidden="true">• </span>
          )}
          {inline(item[2], links, onOpenReference)}
        </div>,
      );
      continue;
    }
    if (line.startsWith(">")) {
      blocks.push(
        <blockquote key={i}>
          {inline(line.replace(/^>\s?/, ""), links, onOpenReference)}
        </blockquote>,
      );
      continue;
    }
    if (
      line.startsWith("|") &&
      i + 1 < lines.length &&
      /^\|?[ :|-]+\|?$/.test(lines[i + 1])
    ) {
      const table: string[][] = [
        line
          .split("|")
          .slice(1, -1)
          .map((v) => v.trim()),
      ];
      i++;
      while (i + 1 < lines.length && lines[i + 1].startsWith("|"))
        table.push(
          lines[++i]
            .split("|")
            .slice(1, -1)
            .map((v) => v.trim()),
        );
      blocks.push(
        <div className="vault-table-scroll" key={i}>
          <table>
            <thead>
              <tr>
                {table[0].map((cell, n) => (
                  <th key={n}>{inline(cell, links, onOpenReference)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.slice(1).map((row, n) => (
                <tr key={n}>
                  {row.map((cell, c) => (
                    <td key={c}>{inline(cell, links, onOpenReference)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    blocks.push(
      line ? (
        <p key={i}>{inline(line, links, onOpenReference)}</p>
      ) : (
        <br key={i} />
      ),
    );
  }
  return <article className="vault-reading">{blocks}</article>;
}
export function VaultView({
  initialRef,
  onOpenReference,
  onAddToCanvas,
}: {
  initialRef?: string;
  onOpenReference: (ref: string) => void;
  onAddToCanvas: (ref: string) => void;
}) {
  const [state, setState] = useState<any>({
      vaults: [],
      notes: [],
      deleted: [],
      templates: [],
      bookmarks: [],
    }),
    [selected, setSelected] = useState(""),
    [note, setNote] = useState<Row | null>(null),
    [draft, setDraft] = useState<NoteData | null>(null),
    [detail, setDetail] = useState<any>(null),
    [vaultId, setVaultId] = useState(""),
    [query, setQuery] = useState(""),
    [folder, setFolder] = useState(""),
    [mode, setMode] = useState("split"),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [history, setHistory] = useState<Row[]>([]),
    [showRecovery, setShowRecovery] = useState(false),
    [propertiesText, setPropertiesText] = useState("{}"),
    [propsError, setPropsError] = useState(""),
    [selectionCount, setSelectionCount] = useState(0),
    [preview, setPreview] = useState<any>(null),
    [savingNow, setSavingNow] = useState(false),
    [saveBlocked, setSaveBlocked] = useState(false),
    [reload, setReload] = useState(0),
    [tagsText, setTagsText] = useState(""),
    [aliasesText, setAliasesText] = useState(""),
    [refsText, setRefsText] = useState(""),
    [searchResults, setSearchResults] = useState<Row[] | null>(null),
    [slashOpen, setSlashOpen] = useState(false),
    [mergeChoice, setMergeChoice] = useState(""),
    [slide, setSlide] = useState(0);
  const current = useRef({ note, draft }),
    loading = useRef(0),
    saving = useRef(false),
    mounted = useRef(true);
  const editorRef = useRef<HTMLTextAreaElement>(null),
    selectionRange = useRef({ start: 0, end: 0 });
  current.current = { note, draft };
  async function refresh() {
    const result = await api("/state");
    if (mounted.current) {
      setState(result);
      setVaultId((prev) => prev || result.vaults[0]?.id || "");
    }
    return result;
  }
  useEffect(() => {
    mounted.current = true;
    refresh().catch((e) => setError(e.message));
    return () => {
      mounted.current = false;
      loading.current++;
    };
  }, []);
  useEffect(() => {
    if (initialRef?.startsWith("note:")) void choose(initialRef.slice(5));
  }, [initialRef]);
  useEffect(() => {
    const token = ++loading.current;
    setError("");
    setHistory([]);
    setNote(null);
    setDraft(null);
    setDetail(null);
    setPreview(null);
    if (!selected) return;
    api(`/notes/${selected}`)
      .then((result) => {
        if (mounted.current && token === loading.current) {
          let recovered: any;
          try {
            recovered = JSON.parse(
              sessionStorage.getItem("sourcewatch-draft:" + selected) || "null",
            );
          } catch {
            /* A corrupt browser draft must not prevent opening the saved note. */
          }
          const hasDraft =
            recovered?.data &&
            JSON.stringify(recovered.data) !== JSON.stringify(result.note.data);
          setNote(
            hasDraft
              ? { ...result.note, revision: recovered.revision }
              : result.note,
          );
          setDraft(hasDraft ? recovered.data : result.note.data);
          setSaveBlocked(!!hasDraft);
          const loaded = hasDraft ? recovered.data : result.note.data;
          setTagsText(loaded.tags.join(", "));
          setAliasesText(loaded.aliases.join(", "));
          setRefsText(loaded.refs.join("\n"));
          if (hasDraft)
            setError(
              "Recovered a local draft. Review it, then Save now; if the saved revision changed, copy your draft before reloading.",
            );

          setPropertiesText(
            JSON.stringify(
              hasDraft
                ? recovered.data.properties
                : result.note.data.properties,
              null,
              2,
            ),
          );
          setPropsError("");
          setDetail(result);
          setVaultId(result.note.data.vaultId);
          setStatus("Saved locally");
        }
      })
      .catch((e) => {
        if (mounted.current && token === loading.current) setError(e.message);
      });
  }, [selected, reload]);
  const dirty =
    !!note && !!draft && JSON.stringify(note.data) !== JSON.stringify(draft);
  async function save() {
    const { note: base, draft: value } = current.current;
    if (!base || !value || JSON.stringify(base.data) === JSON.stringify(value))
      return true;
    if (saving.current) return false;
    saving.current = true;
    setSavingNow(true);
    const token = loading.current;
    setStatus("Saving…");
    try {
      const result = await api(`/notes/${base.id}`, "PUT", {
        data: value,
        expectedRevision: base.revision,
      });
      if (mounted.current && token === loading.current) {
        setSaveBlocked(false);
        setNote(result);
        setDraft((currentDraft) =>
          JSON.stringify(currentDraft) === JSON.stringify(value)
            ? result.data
            : currentDraft,
        );
        setStatus(result.mirrorWarning || "Saved locally");
        setError("");
        const info = await api(`/notes/${base.id}`);
        if (token === loading.current) setDetail(info);
        await refresh();
      }
      return true;
    } catch (e) {
      if (token === loading.current) {
        setError((e as Error).message);
        setSaveBlocked(true);
        setStatus("Draft retained here — not saved");
      }
      return false;
    } finally {
      saving.current = false;
      if (mounted.current) setSavingNow(false);
    }
  }
  useEffect(() => {
    if (!dirty || propsError || savingNow || saveBlocked) return;
    const timer = setTimeout(() => {
      void save();
    }, 1000);
    return () => clearTimeout(timer);
  }, [draft, dirty, propsError, savingNow, saveBlocked, note?.revision]);
  useEffect(() => {
    if (!note || !draft) return;
    try {
      const key = "sourcewatch-draft:" + note.id;
      if (dirty)
        sessionStorage.setItem(
          key,
          JSON.stringify({ data: draft, revision: note.revision }),
        );
      else sessionStorage.removeItem(key);
    } catch {
      /* Browser storage can be unavailable; the in-memory draft remains. */
    }
  }, [note, draft, dirty]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("sourcewatch-dirty", {
        detail: { kind: "vault", dirty: dirty || !!propsError || savingNow },
      }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("sourcewatch-dirty", {
          detail: { kind: "vault", dirty: false },
        }),
      );
    };
  }, [dirty, propsError, savingNow]);
  async function choose(id: string) {
    if (propsError) {
      setError("Correct the properties JSON before switching notes.");
      return;
    }
    if (await save()) setSelected(id);
  }
  async function action(run: () => Promise<void>) {
    try {
      setError("");
      await run();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function create() {
    if (!(await save())) return;
    const row = await api("/notes", "POST", {
      title: `Untitled ${new Date().toLocaleTimeString()}`,
      body: "",
      vaultId,
      folder,
      aliases: [],
      tags: [],
      properties: {},
      refs: [],
    });
    await refresh();
    setSelected(row.id);
  }
  function open(ref: string) {
    if (ref.startsWith("note:")) void choose(ref.slice(5));
    else onOpenReference(ref);
  }
  function change(patch: Partial<NoteData>) {
    setDraft((value) => (value ? { ...value, ...patch } : value));
    setStatus("Unsaved draft");
  }
  function insertText(value: string) {
    const data = current.current.draft;
    if (!data) return;
    const { start, end } = selectionRange.current;
    change({ body: data.body.slice(0, start) + value + data.body.slice(end) });
    setSlashOpen(false);
    if (mode === "reading" || mode === "slides") setMode("source");
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange(
        start + value.length,
        start + value.length,
      );
    });
  }
  async function extractSelection() {
    const id = note?.id;
    if (!id) return;
    const range = { ...selectionRange.current };
    if (!(await save())) return;
    const title = prompt("Title for extracted note", "Extracted section");
    if (!title) return;
    const currentNote = (await api(`/notes/${id}`)).note;
    const result = await api(`/notes/${id}/extract`, "POST", {
      ...range,
      title,
      expectedRevision: currentNote.revision,
    });
    setNote(result.note);
    setDraft(result.note.data);
    setDetail(await api(`/notes/${id}`));
    await refresh();
    setSelectionCount(0);
    setStatus(
      "Selection extracted; original text remains in revision history.",
    );
  }
  async function mergeSelected() {
    if (!note || !mergeChoice || !(await save())) return;
    const id = note.id,
      source = (state.notes as Row[]).find((row) => row.id === mergeChoice);
    if (!source) return;
    const currentNote = (await api(`/notes/${id}`)).note;
    const result = await api(`/notes/${id}/merge`, "POST", {
      sourceId: source.id,
      sourceRevision: source.revision,
      expectedRevision: currentNote.revision,
    });
    setNote(result);
    setDraft(result.data);
    setDetail(await api(`/notes/${id}`));
    await refresh();
    setMergeChoice("");
    setStatus(
      "Merged a copy with a stable source link. Both notes and their histories remain.",
    );
  }
  const shown = ((searchResults || state.notes) as Row[]).filter(
    (row) =>
      (!vaultId || row.data.vaultId === vaultId) &&
      (!folder || row.data.folder === folder),
  );
  useEffect(() => {
    let live = true;
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(() => {
      api(
        `/notes?q=${encodeURIComponent(query)}${vaultId ? `&vaultId=${vaultId}` : ""}`,
      )
        .then((rows) => {
          if (live) setSearchResults(rows);
        })
        .catch((error) => {
          if (live) setError(error.message);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, vaultId, state.notes]);
  const folders = [
    ...new Set(
      (state.notes as Row[])
        .filter((row) => row.data.vaultId === vaultId)
        .map((row) => row.data.folder),
    ),
  ].sort();
  const body = draft?.body || "",
    words = (body.match(/[\p{L}\p{N}_]+/gu) || []).length;
  return (
    <section className="vault-workspace" aria-label="Knowledge vault">
      <div className="vault-title">
        <div>
          <div className="eyebrow">PRIVATE WORKING NOTES</div>
          <h1>Knowledge vault</h1>
          <p>
            Markdown, stable links, local revisions. Notes are researcher
            context, separate from preserved evidence.
          </p>
        </div>
        <div className="vault-actions">
          <button onClick={() => void action(create)}>+ New note</button>
          <button
            onClick={() =>
              void action(async () => {
                if (!(await save())) return;
                const row = await api("/unique", "POST", { vaultId, folder });
                await refresh();
                setSelected(row.id);
              })
            }
          >
            Unique note
          </button>
          <button
            onClick={() =>
              void action(async () => {
                const title = prompt("Vault name");
                if (title) {
                  const row = await api("/vaults", "POST", { title });
                  await refresh();
                  setVaultId(row.id);
                  setFolder("");
                }
              })
            }
          >
            New vault
          </button>
          <a
            className="vault-export"
            href={`/api/vault/export${vaultId ? `?vaultId=${vaultId}` : ""}`}
          >
            Export vault ZIP
          </a>
          <label className="vault-import">
            Import Markdown / JSON
            <input
              aria-label="Import Markdown or JSON"
              type="file"
              accept=".md,.json"
              multiple
              onChange={(e) => {
                const files = Array.from(e.currentTarget.files || []);
                void action(async () => {
                  const result = await api("/import", "POST", {
                    vaultId,
                    files: await Promise.all(
                      files.map(async (file) => ({
                        name: file.name,
                        content: await file.text(),
                      })),
                    ),
                  });
                  await refresh();
                  setStatus(
                    `Imported ${result.imported.length}; rejected ${result.rejected.length}. ${result.warnings.join(" ")}`,
                  );
                  if (result.rejected.length)
                    setError(
                      result.rejected
                        .map((v: any) => `${v.name}: ${v.error}`)
                        .join("; "),
                    );
                });
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      </div>
      {error && (
        <p role="alert" className="capture-error vault-error">
          {error} <button onClick={() => setError("")}>Dismiss</button>
        </p>
      )}
      <div className="vault-grid">
        <aside className="vault-explorer">
          <label>
            Vault
            <select
              aria-label="Selected vault"
              value={vaultId}
              onChange={(e) => {
                setVaultId(e.target.value);
                setFolder("");
              }}
            >
              {state.vaults.map((row: any) => (
                <option key={row.id} value={row.id}>
                  {row.data.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quick search
            <input
              aria-label="Search vault notes"
              placeholder="Text, tag:policy, folder:Cases"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            Folder
            <select
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              aria-label="Filter note folder"
            >
              <option value="">All folders</option>
              {folders.filter(Boolean).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <div className="vault-small-actions">
            <button
              onClick={() =>
                void action(async () => {
                  if (!(await save())) return;
                  const date = new Date();
                  const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                  const row = await api("/daily", "POST", {
                    date: local,
                    vaultId,
                  });
                  await refresh();
                  setSelected(row.id);
                })
              }
            >
              Today's note
            </button>
            <button
              disabled={!shown.length}
              onClick={() =>
                void choose(shown[Math.floor(Math.random() * shown.length)].id)
              }
            >
              Random note
            </button>
          </div>
          <div className="vault-notelist">
            {shown.map((row) => (
              <button
                key={row.id}
                className={selected === row.id ? "active" : ""}
                onClick={() => void choose(row.id)}
              >
                <strong>{row.data.title}</strong>
                <small>
                  {row.data.folder || "/"} ·{" "}
                  {row.data.tags.map((tag) => `#${tag}`).join(" ")}
                </small>
              </button>
            ))}
            {!shown.length && (
              <p>No matching notes. Create a note or import Markdown.</p>
            )}
          </div>
          <details>
            <summary>Bookmarks ({state.bookmarks.length})</summary>
            {state.bookmarks.map((row: any) => (
              <div className="vault-bookmark" key={row.id}>
                {/^https?:/.test(row.data.target) ? (
                  <a href={row.data.target} target="_blank" rel="noreferrer">
                    {row.data.title} ↗
                  </a>
                ) : (
                  <button onClick={() => open(row.data.target)}>
                    {row.data.title}
                  </button>
                )}
                <button
                  aria-label={`Remove bookmark ${row.data.title}`}
                  onClick={() =>
                    void action(async () => {
                      await api(`/bookmarks/${row.id}`, "DELETE");
                      await refresh();
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </details>
          <button onClick={() => setShowRecovery(!showRecovery)}>
            Deleted notes ({state.deleted.length})
          </button>
          {showRecovery &&
            state.deleted.map((row: Row) => (
              <button
                key={row.id}
                onClick={() =>
                  void action(async () => {
                    const revisions = await api(`/notes/${row.id}/history`);
                    const active = revisions.find((r: Row) => !r.deletedAt);
                    await api(`/notes/${row.id}/restore`, "POST", {
                      revision: active.revision,
                      expectedRevision: row.revision,
                    });
                    await refresh();
                    setSelected(row.id);
                  })
                }
              >
                Recover {row.data.title}
              </button>
            ))}
        </aside>
        <div className="vault-document">
          {draft && note ? (
            <>
              <div className="vault-document-toolbar">
                <div className="segmented">
                  {["source", "reading", "split", "slides"].map((value) => (
                    <button
                      key={value}
                      className={mode === value ? "chosen" : ""}
                      onClick={() => setMode(value)}
                    >
                      {value === "source"
                        ? "Source"
                        : value === "reading"
                          ? "Reading"
                          : value === "slides"
                            ? "Slides"
                            : "Split"}
                    </button>
                  ))}
                </div>
                <button
                  disabled={!dirty || !!propsError}
                  onClick={() => void save()}
                >
                  Save now
                </button>
                <button onClick={() => setSlashOpen((value) => !value)}>
                  Insert / command
                </button>
                <button
                  disabled={!selectionCount}
                  onClick={() => void action(extractSelection)}
                >
                  Extract selection
                </button>
                {saveBlocked && (
                  <>
                    <button
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(draft.body)
                          .then(() => setStatus("Draft copied to clipboard"))
                          .catch((error) => setError(error.message));
                      }}
                    >
                      Copy draft
                    </button>
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            "Discard the local draft and reload the saved note?",
                          )
                        ) {
                          sessionStorage.removeItem(
                            "sourcewatch-draft:" + note.id,
                          );
                          setReload((value) => value + 1);
                        }
                      }}
                    >
                      Reload saved note
                    </button>
                  </>
                )}
                <button onClick={() => onAddToCanvas(`note:${note.id}`)}>
                  Add to Canvas
                </button>
                <button
                  onClick={() =>
                    void action(async () => {
                      await api("/bookmarks", "POST", {
                        title: draft.title,
                        target: `note:${note.id}`,
                      });
                      await refresh();
                    })
                  }
                >
                  Bookmark
                </button>
                <button
                  onClick={() =>
                    void action(async () => {
                      if (!(await save())) return;
                      if (
                        !confirm(
                          "Move this note to recovery? Its revisions remain available.",
                        )
                      )
                        return;
                      await api(`/notes/${note.id}`, "DELETE", {
                        expectedRevision: current.current.note?.revision,
                      });
                      setSelected("");
                      await refresh();
                    })
                  }
                >
                  Delete
                </button>
              </div>
              <label>
                Title
                <input
                  aria-label="Note title"
                  value={draft.title}
                  maxLength={120}
                  onChange={(e) => change({ title: e.target.value })}
                />
              </label>
              <div className="vault-meta">
                <label>
                  Folder
                  <input
                    aria-label="Note folder"
                    value={draft.folder}
                    onChange={(e) => change({ folder: e.target.value })}
                  />
                </label>
                <label>
                  Tags
                  <input
                    aria-label="Note tags"
                    value={tagsText}
                    onChange={(e) =>
                      change({
                        tags: (setTagsText(e.target.value), e.target.value)
                          .split(",")
                          .map((v) => v.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
                <label>
                  Aliases
                  <input
                    aria-label="Note aliases"
                    value={aliasesText}
                    onChange={(e) =>
                      change({
                        aliases: (setAliasesText(e.target.value),
                        e.target.value)
                          .split(",")
                          .map((v) => v.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              </div>
              <details>
                <summary>Compose notes</summary>
                <p>
                  Merge appends a copy and a stable source link. The source note
                  is retained.
                </p>
                <select
                  aria-label="Note to merge"
                  value={mergeChoice}
                  onChange={(e) => setMergeChoice(e.target.value)}
                >
                  <option value="">Choose a note in this vault</option>
                  {(state.notes as Row[])
                    .filter(
                      (row) =>
                        row.id !== note.id &&
                        row.data.vaultId === draft.vaultId,
                    )
                    .map((row) => (
                      <option value={row.id} key={row.id}>
                        {row.data.title}
                      </option>
                    ))}
                </select>
                <button
                  disabled={!mergeChoice}
                  onClick={() => void action(mergeSelected)}
                >
                  Merge selected note
                </button>
              </details>
              {slashOpen && (
                <div
                  className="vault-slash"
                  role="menu"
                  aria-label="Insert Markdown command"
                >
                  {[
                    { title: "Heading", value: "## Heading\n" },
                    { title: "Task", value: "- [ ] Task\n" },
                    {
                      title: "Table",
                      value:
                        "| Column | Value |\n| --- | --- |\n| Item | Detail |\n",
                    },
                    { title: "Code block", value: "```\nCode\n```\n" },
                    { title: "Link", value: "[[Note title]]" },
                    ...state.templates.map((row: any) => ({
                      title: `Template: ${row.data.title}`,
                      value: row.data.body,
                    })),
                  ].map((command) => (
                    <button
                      role="menuitem"
                      key={command.title}
                      onClick={() => insertText(command.value)}
                    >
                      {command.title}
                    </button>
                  ))}
                  <button role="menuitem" onClick={() => setSlashOpen(false)}>
                    Cancel
                  </button>
                </div>
              )}
              {mode === "slides" && (
                <section
                  className="vault-slides"
                  tabIndex={0}
                  aria-label="Markdown presentation"
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight")
                      setSlide((index) =>
                        Math.min(
                          index + 1,
                          Math.min(
                            199,
                            draft.body.split(/^---\s*$/m).length - 1,
                          ),
                        ),
                      );
                    if (e.key === "ArrowLeft")
                      setSlide((index) => Math.max(0, index - 1));
                  }}
                >
                  <div className="vault-actions">
                    <button
                      disabled={slide === 0}
                      onClick={() =>
                        setSlide((index) => Math.max(0, index - 1))
                      }
                    >
                      Previous slide
                    </button>
                    <span>
                      Slide{" "}
                      {Math.min(
                        slide,
                        draft.body.split(/^---\s*$/m).length - 1,
                      ) + 1}{" "}
                      of {Math.min(200, draft.body.split(/^---\s*$/m).length)}
                      {draft.body.split(/^---\s*$/m).length > 200
                        ? " (first 200 shown)"
                        : ""}
                    </span>
                    <button
                      disabled={
                        slide >=
                        Math.min(199, draft.body.split(/^---\s*$/m).length - 1)
                      }
                      onClick={() =>
                        setSlide((index) =>
                          Math.min(
                            index + 1,
                            Math.min(
                              199,
                              draft.body.split(/^---\s*$/m).length - 1,
                            ),
                          ),
                        )
                      }
                    >
                      Next slide
                    </button>
                  </div>
                  <MarkdownReading
                    body={
                      draft.body.split(/^---\s*$/m)[
                        Math.min(
                          slide,
                          draft.body.split(/^---\s*$/m).length - 1,
                        )
                      ] || ""
                    }
                    links={detail?.outgoing || []}
                    onOpenReference={open}
                  />
                </section>
              )}
              <div className={`vault-editor-area mode-${mode}`}>
                {mode !== "reading" && mode !== "slides" && (
                  <textarea
                    aria-label="Markdown note editor"
                    ref={editorRef}
                    className="vault-editor"
                    value={draft.body}
                    spellCheck
                    onChange={(e) => change({ body: e.target.value })}
                    onSelect={(e) => {
                      selectionRange.current = {
                        start: e.currentTarget.selectionStart,
                        end: e.currentTarget.selectionEnd,
                      };
                      setSelectionCount(
                        e.currentTarget.selectionEnd -
                          e.currentTarget.selectionStart,
                      );
                    }}
                    onKeyDown={(e) => {
                      if (
                        e.key === "/" &&
                        e.currentTarget.selectionStart ===
                          e.currentTarget.selectionEnd &&
                        (e.currentTarget.selectionStart === 0 ||
                          e.currentTarget.value[
                            e.currentTarget.selectionStart - 1
                          ] === "\n")
                      ) {
                        e.preventDefault();
                        selectionRange.current = {
                          start: e.currentTarget.selectionStart,
                          end: e.currentTarget.selectionEnd,
                        };
                        setSlashOpen(true);
                      }
                      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                        e.preventDefault();
                        void save();
                      }
                    }}
                  />
                )}{" "}
                {mode !== "source" && mode !== "slides" && (
                  <MarkdownReading
                    body={draft.body}
                    links={detail?.outgoing || []}
                    onOpenReference={open}
                  />
                )}
              </div>
              <div role="status" className="vault-status">
                {status} · revision {note.revision} · {words} words ·{" "}
                {body.length} characters
                {selectionCount
                  ? ` · ${selectionCount} selected characters`
                  : ""}
              </div>
              <details>
                <summary>Properties and explicit references</summary>
                <p>
                  JSON values: strings, numbers, booleans, null, or lists.
                  References use kind:UUID.
                </p>
                <textarea
                  aria-label="Note properties JSON"
                  value={propertiesText}
                  onChange={(e) => {
                    setPropertiesText(e.target.value);
                    try {
                      const value = JSON.parse(e.target.value);
                      if (
                        !value ||
                        typeof value !== "object" ||
                        Array.isArray(value)
                      )
                        throw new Error("Use a JSON object");
                      change({ properties: value });
                      setPropsError("");
                    } catch {
                      setPropsError(
                        "Properties must be a valid JSON object; autosave is paused.",
                      );
                    }
                  }}
                />
                {propsError && <p role="alert">{propsError}</p>}
                <label>
                  References (one per line)
                  <textarea
                    aria-label="Note references"
                    value={refsText}
                    onChange={(e) =>
                      change({
                        refs: (setRefsText(e.target.value), e.target.value)
                          .split("\n")
                          .map((v) => v.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              </details>
              <details>
                <summary>Templates</summary>
                <div className="vault-actions">
                  <button
                    onClick={() =>
                      void action(async () => {
                        await api("/templates", "POST", {
                          title: draft.title,
                          body: draft.body,
                          properties: draft.properties,
                          folder: draft.folder,
                        });
                        await refresh();
                      })
                    }
                  >
                    Save as template
                  </button>
                  {state.templates.map((row: any) => (
                    <button
                      key={row.id}
                      onClick={() =>
                        change({
                          body:
                            draft.body +
                            "\n" +
                            row.data.body
                              .replace(/\{\{title\}\}/g, draft.title)
                              .replace(
                                /\{\{date\}\}/g,
                                new Date().toLocaleDateString(),
                              ),
                        })
                      }
                    >
                      Insert {row.data.title}
                    </button>
                  ))}
                </div>
              </details>
              <details>
                <summary
                  onClick={() =>
                    void action(async () =>
                      setHistory(await api(`/notes/${note.id}/history`)),
                    )
                  }
                >
                  Revision history &amp; recovery
                </summary>
                {history.map((row) => (
                  <article className="vault-revision" key={row.revision}>
                    <strong>Revision {row.revision}</strong> ·{" "}
                    {new Date(row.updatedAt).toLocaleString()}{" "}
                    {row.deletedAt ? "(deleted)" : ""}
                    <details>
                      <summary>Preview snapshot</summary>
                      <pre>{row.data.body}</pre>
                    </details>
                    {!row.deletedAt && (
                      <button
                        onClick={() =>
                          void action(async () => {
                            if (
                              dirty &&
                              !confirm(
                                "Replace this draft with the selected revision?",
                              )
                            )
                              return;
                            const restored = await api(
                              `/notes/${note.id}/restore`,
                              "POST",
                              {
                                revision: row.revision,
                                expectedRevision:
                                  current.current.note?.revision,
                              },
                            );
                            setNote(restored);
                            setDraft(restored.data);
                            setPropertiesText(
                              JSON.stringify(restored.data.properties, null, 2),
                            );
                            setDetail(await api(`/notes/${note.id}`));
                            await refresh();
                            setStatus(
                              `Restored revision ${row.revision} as a new revision`,
                            );
                          })
                        }
                      >
                        Restore this revision
                      </button>
                    )}
                  </article>
                ))}
              </details>
            </>
          ) : (
            <div className="empty">
              <h2>Write beside the evidence.</h2>
              <p>
                Choose a note, create one, or import Markdown. Existing capture
                history remains independent.
              </p>
            </div>
          )}
        </div>
        <aside className="vault-context">
          <h3>Outline</h3>
          {(detail?.outline || []).map((item: any) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={() => {
                if (mode === "source") setMode("split");
              }}
            >
              {"› ".repeat(item.level - 1)}
              {item.text}
            </a>
          ))}
          <h3>Outgoing links</h3>
          {(detail?.outgoing || []).map((link: Link, i: number) => (
            <button
              key={i}
              disabled={!link.targetRef}
              onClick={() => link.targetRef && open(link.targetRef)}
              onFocus={() => {
                if (link.targetRef?.startsWith("note:"))
                  api(`/notes/${link.targetRef.slice(5)}`)
                    .then(setPreview)
                    .catch(() => {});
              }}
            >
              {link.label} <small>{link.status}</small>
            </button>
          ))}
          {(detail?.externalLinks || []).map((url: string) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              {url} ↗
            </a>
          ))}
          {preview && (
            <section className="vault-preview">
              <h4>{preview.note.data.title}</h4>
              <p>{preview.note.data.body.slice(0, 220)}</p>
              <button onClick={() => open(`note:${preview.note.id}`)}>
                Open previewed note
              </button>
            </section>
          )}
          <h3>Backlinks</h3>
          {(detail?.backlinks || []).map((link: any) => (
            <button key={link.ref} onClick={() => open(link.ref)}>
              {link.title}
              <small>{link.excerpt}</small>
            </button>
          ))}
          <h3>Unlinked mentions</h3>
          {(detail?.unlinkedMentions || []).map((link: any) => (
            <button key={link.ref} onClick={() => open(link.ref)}>
              {link.title}
              <small>{link.excerpt}</small>
            </button>
          ))}
          <p className="muted small">
            Links are navigation and researcher interpretation. They do not
            establish verified relationships.
          </p>
        </aside>
      </div>
    </section>
  );
}
