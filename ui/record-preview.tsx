import React, { useEffect, useState } from "react";
import PDFPreview from "./pdf-preview.js";
export function RecordPreview({
  reference,
  onClose,
}: {
  reference: string;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    fetch("/api/ecosystem/record?ref=" + encodeURIComponent(reference))
      .then(async (response) => {
        if (!response.ok) throw Error("The record is unavailable");
        return response.json();
      })
      .then((data) => {
        if (live) setRecord(data);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [reference]);
  const file =
      "/api/workspace/attachments/" + reference.split(":")[1] + "/file",
    mime = record?.data?.mime;
  return (
    <div className="record-preview-backdrop">
      <section
        role="dialog"
        aria-label="Record details"
        className="record-preview"
      >
        <header>
          <span className="eyebrow">PRESERVED RECORD</span>
          <button aria-label="Close record details" onClick={onClose}>
            ×
          </button>
        </header>
        {error && <p role="alert">{error}</p>}
        {record && (
          <>
            <h2>{record.title}</h2>
            <p className="muted">
              {mime || record.kind}
              {record.data?.size
                ? " · " + Number(record.data.size).toLocaleString() + " bytes"
                : ""}
            </p>
            {mime?.startsWith("image/") && (
              <img src={file} alt={record.title} />
            )}{" "}
            {mime === "application/pdf" && (
              <PDFPreview title={record.title} url={file} />
            )}{" "}
            {mime?.startsWith("audio/") && <audio src={file} controls />}
            {mime?.startsWith("video/") && <video src={file} controls />}
            {record.data?.body && (
              <p className="record-preview-body">{record.data.body}</p>
            )}
            {record.data?.sha256 && (
              <label>
                SHA-256<code>{record.data.sha256}</code>
              </label>
            )}
            {reference.startsWith("attachment:") && (
              <a href={file} target="_blank" rel="noreferrer">
                Open original document →
              </a>
            )}
          </>
        )}
      </section>
    </div>
  );
}
