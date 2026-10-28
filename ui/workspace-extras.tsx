import React, { useEffect, useRef, useState } from "react";
async function api(path: string, body?: unknown) {
  const r = await fetch(
    "/api" + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await r.json();
  if (!r.ok) throw Error(result.error || "Request failed");
  return result;
}
export function BasesView({
  onOpenReference,
}: {
  onOpenReference: (ref: string) => void;
}) {
  const [saved, setSaved] = useState<any[]>([]),
    [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [config, setConfig] = useState({
      title: "Research table",
      view: "table",
      kind: "note",
      query: "",
      sort: "title",
      groupBy: "status",
      formula: "",
    });
  useEffect(() => {
    api("/workspace/bases")
      .then(setSaved)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let live = true;
    api("/workspace/bases/query", config)
      .then((r) => {
        if (live) {
          setRows(r);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [config]);
  const group = (r: any) =>
    String(
      r.data.properties?.[config.groupBy] ??
        r.data[config.groupBy] ??
        "Unassigned",
    );
  const open = (r: any) => onOpenReference(r.kind + ":" + r.id);
  return (
    <section className="sw-bases">
      <h2>Property databases</h2>
      <p>
        Saved views over existing notes and entities. Views reference the same
        records.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="sw-controls">
        <label>
          Saved view
          <select
            aria-label="Saved base"
            onChange={(e) => {
              const s = saved.find((r) => r.id === e.target.value);
              if (s) setConfig(s.data);
            }}
          >
            <option value="">Choose a view</option>
            {saved.map((s) => (
              <option key={s.id} value={s.id}>
                {s.data.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          View name
          <input
            value={config.title}
            onChange={(e) => setConfig({ ...config, title: e.target.value })}
          />
        </label>
        <label>
          Display
          <select
            aria-label="Base display"
            value={config.view}
            onChange={(e) => setConfig({ ...config, view: e.target.value })}
          >
            {["table", "list", "cards", "kanban", "map"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Record kind
          <select
            aria-label="Base record kind"
            value={config.kind}
            onChange={(e) => setConfig({ ...config, kind: e.target.value })}
          >
            <option>note</option>
            <option>entity</option>
          </select>
        </label>
        <label>
          Filter
          <input
            value={config.query}
            onChange={(e) => setConfig({ ...config, query: e.target.value })}
          />
        </label>
        <label>
          Sort property
          <input
            value={config.sort}
            onChange={(e) => setConfig({ ...config, sort: e.target.value })}
          />
        </label>
        <label>
          Group property
          <input
            value={config.groupBy}
            onChange={(e) => setConfig({ ...config, groupBy: e.target.value })}
          />
        </label>
        <label>
          Formula
          <input
            placeholder="wordCount or cost * 2"
            value={config.formula}
            onChange={(e) => setConfig({ ...config, formula: e.target.value })}
          />
        </label>
        <button
          onClick={async () => {
            try {
              await api("/workspace/bases", config);
              setSaved(await api("/workspace/bases"));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Save database view
        </button>
      </div>
      <p>{rows.length} matching records (up to 1,000).</p>
      {config.view === "table" ? (
        <div className="sw-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Tags</th>
                <th>Properties</th>
                <th>Computed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button onClick={() => open(r)}>{r.data.title}</button>
                  </td>
                  <td>{(r.data.tags || []).join(", ")}</td>
                  <td>{JSON.stringify(r.data.properties || {})}</td>
                  <td>{String(r.computed ?? "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : config.view === "map" ? (
        <>
          <p>
            Offline equirectangular coordinate plot. Add numeric
            latitude/longitude properties; no remote map tiles are loaded.
          </p>
          <svg
            viewBox="0 0 900 450"
            className="sw-map"
            role="img"
            aria-label="Record locations"
          >
            {[0, 90, 180, 270, 360, 450].map((y) => (
              <line
                key={"y" + y}
                x1="0"
                x2="900"
                y1={y}
                y2={y}
                stroke="#a0b7a5"
              />
            ))}
            {[0, 150, 300, 450, 600, 750, 900].map((x) => (
              <line key={x} x1={x} x2={x} y1="0" y2="450" stroke="#a0b7a5" />
            ))}
            {rows
              .filter(
                (r) =>
                  r.data.properties?.latitude !== null &&
                  r.data.properties?.latitude !== "" &&
                  r.data.properties?.longitude !== null &&
                  r.data.properties?.longitude !== "" &&
                  Number.isFinite(Number(r.data.properties?.latitude)) &&
                  Number.isFinite(Number(r.data.properties?.longitude)) &&
                  Math.abs(Number(r.data.properties.latitude)) <= 90 &&
                  Math.abs(Number(r.data.properties.longitude)) <= 180,
              )
              .map((r) => (
                <g
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => open(r)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") open(r);
                  }}
                >
                  <circle
                    cx={(Number(r.data.properties.longitude) + 180) * 2.5}
                    cy={(90 - Number(r.data.properties.latitude)) * 2.5}
                    r="6"
                    fill="#5d488c"
                  />
                  <title>{r.data.title}</title>
                </g>
              ))}
          </svg>
        </>
      ) : config.view === "kanban" ? (
        <div className="sw-kanban">
          {[...new Set(rows.map(group))].map((g) => (
            <section key={g}>
              <h3>{g}</h3>
              {rows
                .filter((r) => group(r) === g)
                .map((r) => (
                  <button key={r.id} onClick={() => open(r)}>
                    {r.data.title}
                  </button>
                ))}
            </section>
          ))}
        </div>
      ) : (
        <div className={config.view === "cards" ? "sw-cards" : "sw-list"}>
          {rows.map((r) => (
            <button key={r.id} onClick={() => open(r)}>
              <strong>{r.data.title}</strong>
              <small>{(r.data.tags || []).join(" · ")}</small>
              <p>{String(r.data.body || "").slice(0, 140)}</p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
export function ToolsView({
  onOpenReference,
}: {
  onOpenReference: (ref: string) => void;
}) {
  const [notes, setNotes] = useState<any[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [recording, setRecording] = useState(false),
    [audio, setAudio] = useState<Blob | null>(null),
    [recorder, setRecorder] = useState<MediaRecorder | null>(null),
    [clip, setClip] = useState({ url: "", title: "", text: "" }),
    [extension, setExtension] = useState(""),
    [extensions, setExtensions] = useState<any[]>([]);
  useEffect(() => {
    api("/vault/notes")
      .then(setNotes)
      .catch((e) => setError(e.message));
    api("/workspace/extensions")
      .then(setExtensions)
      .catch((e) => setError(e.message));
  }, []);
  const recordingRef = useRef<MediaRecorder | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  useEffect(() => {
    if (!audio) return;
    const url = URL.createObjectURL(audio);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audio]);
  useEffect(
    () => () => {
      const r = recordingRef.current;
      if (r) {
        if (r.state !== "inactive") r.stop();
        r.stream.getTracks().forEach((t) => t.stop());
      }
    },
    [],
  );
  async function upload(file: File | Blob, name: string) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024) throw Error("Attachment exceeds 8 MiB");
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return api("/workspace/attachments", {
      filename: name,
      mime: file.type,
      base64: btoa(binary),
    });
  }
  return (
    <section className="sw-tools">
      <h2>Workspace tools</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="sw-cards">
        <section>
          <h3>Local attachments</h3>
          <p>
            Images, PDF, audio and video. Up to 8 MiB each. Uploaded files stay
            on this machine.
          </p>
          <input
            aria-label="Upload workspace attachment"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,audio/*,video/mp4,video/webm"
            onChange={async (e) => {
              try {
                const file = e.target.files?.[0];
                if (file) {
                  const result = await upload(file, file.name);
                  setNotice(
                    "Attachment saved: " +
                      result.id +
                      " — add it to a canvas from the reference picker.",
                  );
                }
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        </section>
        <section>
          <h3>Audio recorder</h3>
          <p>
            Recording starts only after you press Record and grant microphone
            access.
          </p>
          <button
            disabled={recording}
            onClick={async () => {
              try {
                const stream = await navigator.mediaDevices.getUserMedia({
                  audio: true,
                });
                const r = new MediaRecorder(stream),
                  chunks: BlobPart[] = [];
                let totalBytes = 0;
                r.ondataavailable = (e) => {
                  chunks.push(e.data);
                  totalBytes += e.data.size;
                  if (totalBytes > 7 * 1024 * 1024 && r.state !== "inactive")
                    r.stop();
                };
                r.onstop = () => {
                  setAudio(new Blob(chunks, { type: r.mimeType }));
                  stream.getTracks().forEach((t) => t.stop());
                  setRecording(false);
                };
                recordingRef.current = r;
                setRecorder(r);
                setRecording(true);
                r.start(1000);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Record audio
          </button>
          <button disabled={!recording} onClick={() => recorder?.stop()}>
            Stop recording
          </button>
          {audio && (
            <>
              <audio controls src={audioUrl} />
              <button
                onClick={async () => {
                  try {
                    const a = await upload(
                      audio,
                      "recording-" +
                        new Date().toISOString().replaceAll(":", "-") +
                        ".webm",
                    );
                    setNotice("Audio saved: " + a.id);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Save recording locally
              </button>
            </>
          )}
        </section>
        <section>
          <h3>Portable workspace backup</h3>
          <p>
            Includes notes, canvas layouts, attachments and referenced evidence
            bundles. A backup is not automatic synchronization.
          </p>
          <a href="/api/workspace/export">Export complete workspace ZIP</a>
          <p>
            Verify using its included standalone verify-workspace.mjs command.
          </p>
        </section>
      </div>
      <section>
        <h3>Web clipping import</h3>
        <p>
          Import the companion clipper JSON or paste selected text. A clip is
          not an archived observation.
        </p>
        <input
          type="file"
          aria-label="Import clipper JSON"
          accept=".json"
          onChange={async (e) => {
            try {
              const f = e.target.files?.[0];
              if (f) setClip(JSON.parse(await f.text()));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
        <label>
          Public source URL
          <input
            value={clip.url}
            onChange={(e) => setClip({ ...clip, url: e.target.value })}
          />
        </label>
        <label>
          Clip title
          <input
            value={clip.title}
            onChange={(e) => setClip({ ...clip, title: e.target.value })}
          />
        </label>
        <label>
          Selected text
          <textarea
            value={clip.text}
            onChange={(e) => setClip({ ...clip, text: e.target.value })}
          />
        </label>
        <button
          onClick={async () => {
            try {
              const r = await api("/workspace/clip", clip);
              onOpenReference("note:" + r.id);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Save clip as note
        </button>
      </section>
      <section>
        <h3>Static publication export</h3>
        <p>
          Select notes explicitly. This creates a local website ZIP; it does not
          upload or host anything. Notes marked private are refused.
        </p>
        {notes.map((n) => (
          <label key={n.id} className="sw-check">
            <input
              type="checkbox"
              checked={selected.includes(n.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, n.id]
                    : selected.filter((id) => id !== n.id),
                )
              }
            />
            {n.data.title}
          </label>
        ))}
        <button
          disabled={!selected.length}
          onClick={async () => {
            try {
              const r = await fetch("/api/workspace/publish-export", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  title: "Research collection",
                  noteIds: selected,
                }),
              });
              if (!r.ok) throw Error((await r.json()).error);
              const url = URL.createObjectURL(await r.blob()),
                a = document.createElement("a");
              a.href = url;
              a.download = "sourcewatch-publication.zip";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 30000);
              setNotice(
                "Static publication export prepared locally. No hosting was performed.",
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Export selected publication
        </button>
      </section>
      <section>
        <h3>Declarative extensions (API v1)</h3>
        <p>
          Local navigation commands only. No arbitrary JavaScript, Obsidian
          plugin execution or privileged permissions.
        </p>
        <textarea
          aria-label="Extension manifest"
          placeholder={
            '{"apiVersion":1,"id":"my-navigation","name":"My navigation","permissions":[],"commands":[{"title":"Open notes","action":"vault"}]}'
          }
          value={extension}
          onChange={(e) => setExtension(e.target.value)}
        />
        <button
          onClick={async () => {
            try {
              await api("/workspace/extensions", JSON.parse(extension));
              setExtensions(await api("/workspace/extensions"));
              setNotice(
                "Declarative extension installed. Reopen the command palette to use its commands.",
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Install local manifest
        </button>
        {extensions.map((ex) => (
          <p key={ex.id}>
            {ex.data.name} · {ex.data.enabled ? "Enabled" : "Disabled"}{" "}
            <button
              onClick={async () => {
                try {
                  await fetch("/api/workspace/extensions/" + ex.id, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ enabled: !ex.data.enabled }),
                  });
                  setExtensions(await api("/workspace/extensions"));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Toggle extension
            </button>
          </p>
        ))}
      </section>
    </section>
  );
}
