# Visual research workspace — 2.0.0-alpha.1

This is an integrated local workspace inside SourceWatch. Open **Workspace** from the dashboard. The automated **Database & network** graph and freeform **Canvas** are separate views of shared references. This preview implements substantial parts of Module J; it does not implement the complete master directive or Obsidian parity. Consult [feature-parity.json](feature-parity.json) for every requested core category and remaining gaps.

## Start safely

Install Node.js 24+, run the documented setup, and rebuild the UI after updates. Stop the service and copy the entire data directory before upgrading an existing installation. The additive SQLite migration preserves existing sources and captures. Do not run two service instances against one data directory. Tests use isolated temporary directories and never seed your live database.

Windows PowerShell:

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run build
npm.cmd start
```

Open http://127.0.0.1:3210. Keep the service running for monitoring. This branch is a local preview; nothing is uploaded or published.

## Notes and backlinks

In **Notes & vault**, create a vault and notes, choose source/reading/split mode, and save Markdown. Link notes with `[[Title]]`, aliases, or stable UUID links. The details panel shows outgoing links, backlinks, unlinked mentions, tags, properties and evidence references. Ambiguous titles are not guessed. Renaming retains previous titles as aliases; stable references survive renaming. Search supports the documented query controls in the view.

Daily notes, templates, bookmarks, outline navigation, word counts, random notes, unique notes, slash insertions and simple slides are available. Select text to extract a linked note; merge copies retain source notes and revision provenance. History restores create new revisions. Deleting a note is recoverable and does not rewrite its old snapshots. Imported Markdown is escaped in reading mode; arbitrary HTML is not executed. Advanced transclusion, math/Mermaid, rich editor parity and arbitrary YAML are incomplete.

Notes are stored canonically in SQLite with atomic UUID-named Markdown mirrors under `data/workspace/notes`. External edits to mirrors are not watched or synchronized into the database. Use the import workflow, rather than editing a mirror and expecting automatic reconciliation.

## Entity → graph → canvas → review

1. Open **Database & network**. Create an entity or search the table. Entity type, jurisdiction, aliases and provenance remain explicit; equal names are not automatically merged.
2. Create documented relationships between stable references. Unknown amounts stay null; currencies retain their original code. Choose the network view to inspect selected records, local hops, bounded paths and linked notes. Filters and graph limits apply.
3. Use **Add to canvas** to place a record in the freeform workspace. Alternatively, pick a record in the canvas reference selector and select **Embed record**.
4. Add Markdown cards, note references, named colored groups or nested canvas references. Upload images, PDFs, audio or video in **Tools & exports**, then embed their attachment references. PDF previews load on demand, use the bundled local PDF.js worker, and provide page navigation and extracted text. Link cards show safe URLs and metadata rather than executing arbitrary external websites.
5. Drag a card by its header, resize using its handle or numeric controls, multiselect cards, align/distribute, toggle the grid, pan, zoom and fit. Undo/redo applies within the open editing session. Autosave persists the canvas and viewport; **Save now** provides an explicit checkpoint. Named workspace layouts retain the active view and reference; they are not arbitrary split-pane layouts.
6. Choose connection endpoints, direction, label, color, creator and explanation. Connections are annotations or hypotheses. They do not become facts simply because they appear on a canvas.
7. Save the canvas, select a connection between two durable record references, and choose **Propose evidence review**. This creates a hypothesis relationship in the database. Attach preserved capture or attachment evidence and explicitly record a reviewer and explanation before setting reviewed/verified status. Integrity checks reject modified evidence. This is a local research review, not independent certification of the claim.
8. Open linked notes and backlinks, attach investigation references, save, close the workspace, restart SourceWatch and reopen the canvas. Removing a card removes its placement, not its underlying note, entity, evidence or relationship.

Concurrent edits use revision checks. Conflicts retain the draft and offer reload/export; they do not silently overwrite the other writer. Leaving a workspace with pending note/canvas/database edits is guarded. Browser drafts can aid recovery but are not a substitute for saved data and backups.

## Export and verify

Canvas exports provide `.canvas`, SVG and PNG. JSON Canvas preserves compatible node/edge fields and SourceWatch relationship metadata; portable file references need their companion notes and attachments. Arbitrary imported filesystem paths are never read. Exported images represent the current view, not an unlimited-resolution rendering of the whole workspace. Embedded video/PDF canvas pixels may not be reproduced in image exports; preserve the attachment bytes and JSON layout for evidence.

**Notes & vault** exports Markdown and metadata. **Tools & exports → Export complete workspace ZIP** includes current objects, independent revision snapshots, Markdown, canvas documents, attachments, recent audit context and referenced original capture evidence ZIPs. It is an export, not a one-click complete restore implementation. For complete operational recovery, stop the service and back up the entire data directory. Audit context in the portable ZIP is capped at the latest 10,000 events; the database retains the complete append-only audit table.

Extract a workspace ZIP and run:

```sh
node verify-workspace.mjs .
node verify-workspace.mjs . --expect SEPARATELY_RETAINED_MANIFEST_SHA256
```

The verifier uses Node built-ins and checks missing, changed, unexpected and unsafe files. Nested original evidence ZIPs have their own capture-chain verifiers; extract and verify them separately. Hashes establish consistency with a retained manifest, not authenticity, truth or independently certified timestamps. Use a trusted verifier when receiving untrusted bundles.

**Static publication export** includes only explicitly selected notes, refuses notes with boolean `private: true`, and creates local escaped HTML with search and theme controls. It does not host, upload, revoke, authenticate or synchronize a publication. Review all selected notes and their metadata before distributing the ZIP.

## Other integrated tools

- Property views: saved table, list, cards, grouped kanban and offline coordinate map views; simple bounded formulas. Kanban grouping is currently read-only. These are not full Obsidian `.base` compatibility.
- Clipper: `extensions/clipper` contains a user-triggered browser extension that downloads selected text as JSON. Import it in Tools. Clipped text is explicitly unarchived; capture the public source separately for preserved evidence. Browser installation remains manual.
- Audio: explicit microphone permission, recording, playback and local attachment saving. Automated testing uses a synthetic Chromium microphone; physical microphones and iPhone recording still require manual checks.
- Extensions: API v1 declarative navigation commands only, with no permissions or executable plugin code. Not compatible with arbitrary Obsidian plugins.
- Command palette: Ctrl+K / Ctrl+P, local record search and navigation. Themes provide light/dark workspace colors. Mobile is responsive browser UI, not native/offline/sync parity.
- CLI: while the service runs, `npm.cmd run cli -- status`, `npm.cmd run cli -- notes "query"`, `npm.cmd run cli -- create "Title" path-to-note.md`, `npm.cmd run cli -- read UUID`, and `npm.cmd run cli -- canvases`. Set `PORT` to target a different loopback port. CLI errors return nonzero status.

## Resource and scope boundaries

Each attachment is limited to 8 MiB; workspace attachments have a 512 MiB budget. Portable workspace exports are limited to 128 MiB and reject oversized object/history payloads before ZIP creation. Canvas validation limits a document to 4 MiB, 2,000 cards and 5,000 edges. PDF previews cap documents at 500 pages and render one bounded page at a time. Global/local graph queries and paths are bounded; the benchmark is a backend 10,000-entity/12,000-relationship test, not proof of simultaneously rendering 22,000 items in a browser.

Missing items include automatic sync and encrypted conflict reconciliation, full mobile/offline support, native executable plugin compatibility, live hosted publishing, complete advanced editor and `.base` parity, advanced community analysis and some graph filters, full attachment/file interop and drag-editable kanban. These are tracked in the matrix rather than represented as completed functionality.
