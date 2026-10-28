import { readAttachment } from "./workspace-routes.js";
import { WorkspaceStore } from "./workspace-store.js";
import { sha256 } from "./storage.js";
export function verifyPreservedReference(
  workspace: WorkspaceStore,
  ref: string,
) {
  const [kind, id] = ref.split(":");
  if (kind === "attachment") {
    readAttachment(workspace, id);
    return;
  }
  if (kind !== "capture")
    throw Error(
      "Preserved evidence must reference a capture or local attachment",
    );
  const record = workspace.store.get(id);
  if (!record) throw Error("Capture not found");
  let previous: string | null = null;
  for (const r of workspace.store.history(record.sourceId)) {
    const { chainHash, ...base } = r;
    if (
      r.previousHash !== previous ||
      sha256(JSON.stringify(base)) !== chainHash
    )
      throw Error("Evidence capture chain integrity failed");
    previous = chainHash;
    if (r.id === id) break;
  }
  const metadata = JSON.parse(
    workspace.store.file(id, "metadata.json").toString(),
  );
  if (JSON.stringify(metadata) !== JSON.stringify(record))
    throw Error("Evidence metadata integrity failed");
  for (const [name, digest] of Object.entries(record.files))
    if (sha256(workspace.store.file(id, name)) !== digest)
      throw Error("Evidence artifact integrity failed: " + name);
}
