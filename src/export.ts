import { zipSync } from "fflate";
import { readFileSync } from "node:fs";
import { Store, sha256 } from "./storage.js";
export function exportBundle(
  store: Store,
  sourceId: string,
  selectedIds?: string[],
  annotations: Array<{
    captureId: string;
    note: string;
    tags: string[];
    updatedAt: string | null;
  }> = [],
) {
  let history = store.history(sourceId);
  if (selectedIds?.length) {
    if (selectedIds.some((id) => !history.some((r) => r.id === id)))
      throw new Error("Selected capture not found in this source");
    const last = Math.max(
      ...selectedIds.map((id) => history.findIndex((r) => r.id === id)),
    );
    history = history.slice(0, last + 1);
  }
  if (!history.length) throw new Error("No captures to export");
  const files: Record<string, Uint8Array> = {};
  let previous: string | null = null;
  let total = 0;
  for (const record of history) {
    const { chainHash, ...base } = record;
    if (
      record.previousHash !== previous ||
      sha256(JSON.stringify(base)) !== chainHash
    )
      throw new Error("Stored hash chain failed verification");
    for (const name of [...Object.keys(record.files), "metadata.json"]) {
      const data = store.file(record.id, name);
      total += data.length;
      if (total > 256 * 1024 * 1024)
        throw new Error(
          "Export exceeds 256 MiB; use filesystem archival for this source",
        );
      if (name === "metadata.json") {
        if (
          JSON.stringify(JSON.parse(data.toString())) !== JSON.stringify(record)
        )
          throw new Error("Stored metadata modified");
      } else if (sha256(data) !== record.files[name])
        throw new Error(`Stored artifact modified: ${record.id}/${name}`);
      files[`captures/${record.id}/${name}`] = data;
    }
    previous = chainHash;
  }
  const includedNotes = annotations.filter(
    (a) =>
      history.some((r) => r.id === a.captureId) && (a.note || a.tags.length),
  );
  if (includedNotes.length) {
    const notes = Buffer.from(
      JSON.stringify(
        {
          type: "researcher-annotations",
          description:
            "Editable researcher notes and tags at export time. These are not part of the original capture hash chain.",
          annotations: includedNotes,
        },
        null,
        2,
      ),
    );
    if (total + notes.length > 256 * 1024 * 1024)
      throw new Error("Export exceeds 256 MiB");
    files["research-notes.json"] = notes;
  }
  files["verify.mjs"] = readFileSync(
    new URL("../scripts/verify.mjs", import.meta.url),
  );
  files["READ-ME.txt"] = Buffer.from(
    "SOURCEWATCH evidence bundle\nExtract the ZIP, then run: node verify.mjs .\nRequires Node.js 24+. No dependencies or network required.\nTimestamps are local observations, not independently certified timestamps. Hashes detect changes relative to this manifest; they do not establish website authenticity. Retain the manifest SHA-256 separately to detect replacement of the entire bundle.\nHTML is untrusted active content. Inspect as text; do not open it in a privileged browser. Screenshots and rendered HTML are preserved; external assets are not archived separately.\n",
  );
  const manifest = {
    format: "sourcewatch-evidence-v1",
    sourceId,
    requestedCaptures: selectedIds || history.map((r) => r.id),
    exportedAt: new Date().toISOString(),
    captures: history.map((r) => r.id),
    chainTip: previous,
    files: Object.fromEntries(
      Object.entries(files).map(([n, b]) => [n, sha256(b)]),
    ),
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
  files["manifest.json"] = manifestBytes;
  return {
    zip: Buffer.from(zipSync(files, { level: 6 })),
    manifestSha256: sha256(manifestBytes),
  };
}
