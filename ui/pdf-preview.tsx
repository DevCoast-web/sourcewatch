import React, { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
export default function PDFPreview({
  url,
  title,
}: {
  url: string;
  title: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [text, setText] = useState(""),
    [loading, setLoading] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let task: { destroy: () => Promise<void> } | undefined;
    setDocument(null);
    setPage(1);
    setText("");
    setError("");
    setLoading(true);
    (async () => {
      try {
        if (!url.startsWith("/api/workspace/attachments/"))
          throw Error("PDF must reference a local attachment");
        const pdf = await import("pdfjs-dist");
        if (!live) return;
        pdf.GlobalWorkerOptions.workerSrc = workerUrl;
        const loadingTask = pdf.getDocument({
          url,
          disableFontFace: true,
          enableXfa: false,
          stopAtErrors: true,
        });
        task = loadingTask;
        const doc = await loadingTask.promise;
        if (doc.numPages > 500) {
          await loadingTask.destroy();
          throw Error("PDF preview is limited to 500 pages");
        }
        if (live) {
          setDocument(doc);
          setLoading(false);
        }
      } catch (e) {
        if (live) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    })();
    return () => {
      live = false;
      void task?.destroy().catch(() => {});
    };
  }, [url, enabled]);
  useEffect(() => {
    if (!document) return;
    let live = true;
    let render: { cancel: () => void } | undefined;
    setLoading(true);
    (async () => {
      try {
        const p = await document.getPage(page);
        if (!live) return;
        const base = p.getViewport({ scale: 1 }),
          scale = Math.min(1.5, 1600 / base.width, 2400 / base.height),
          viewport = p.getViewport({ scale });
        const target = canvas.current;
        if (!target) return;
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        const draw = p.render({ canvas: target, viewport });
        render = draw;
        await draw.promise;
        const content = await p.getTextContent();
        if (live) {
          setText(
            content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" ")
              .slice(0, 50000),
          );
          setLoading(false);
        }
      } catch (e) {
        if (live) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    })();
    return () => {
      live = false;
      render?.cancel();
    };
  }, [document, page]);
  return (
    <section className="sw-pdf" aria-label={"PDF preview " + title}>
      {!enabled ? (
        <button onClick={() => setEnabled(true)}>Load local PDF preview</button>
      ) : (
        <button
          onClick={() => {
            setEnabled(false);
            setDocument(null);
          }}
        >
          Unload PDF preview
        </button>
      )}
      <div>
        <button
          disabled={!document || page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous PDF page
        </button>
        <span>
          Page {page} / {document?.numPages || "…"}
        </span>
        <button
          disabled={!document || page >= document.numPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next PDF page
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {enabled && loading && <p role="status">Rendering local PDF…</p>}
      <canvas ref={canvas} aria-label={"Rendered PDF page " + page} />
      <details>
        <summary>PDF text alternative</summary>
        <p>{text || "No extractable text on this page."}</p>
      </details>
      <a href={url} target="_blank" rel="noreferrer">
        Open original PDF attachment
      </a>
    </section>
  );
}
