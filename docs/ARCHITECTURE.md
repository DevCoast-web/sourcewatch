# Architecture

SOURCEWATCH uses one local Node.js 24 process, a Fastify HTTP API, a Vite-built React interface, Playwright Chromium, and Node's built-in SQLite implementation. The compact `src/` and `ui/` layout replaces a multi-package monorepo because this release has one deployable application and no independent packages.

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `src/network.ts` | URL normalization, public-address classification, DNS validation, address-pinned HTTP(S) requests, response limits |
| `src/barrier.ts` | Owned deny-all Chromium fallback proxy |
| `src/scheduler.ts` | Select eligible sources from persisted attempt times |
| `src/capture.ts` | Isolated browser lifecycle, interception of requests, bounded rendering, HTML/text/link extraction, screenshot |
| `src/storage.ts` | SQLite schema, source settings, append-only capture rows, artifact writes, SHA-256 chain |
| `src/compare.ts` | Bounded line/word diffs and outbound link set changes |
| `src/export.ts` | Verify stored artifacts and history before constructing a portable ZIP |
| `scripts/verify.mjs` | Offline verification using only Node built-ins |
| `src/server.ts` | Loopback API, input validation, capture serialization, scheduler, artifact downloads, built UI hosting |
| `ui/main.tsx` | Source dashboard, timeline, inspector, comparison, source creation, export workflow |

## Capture and persistence

Each successful capture receives a UUID, ISO local-system observation time, source URL, final URL, status, response headers, title, description, warnings, ignored selectors, and outbound links. HTML is the rendered DOM at capture time, not the original HTTP response body. Text normalizes the cloned document body after removing scripts/styles and configured exclusions. Screenshots retain ignored regions.

Capture artifacts live at `data/captures/<uuid>/`. The SQLite database stores source settings, archive state, local render settle settings, and ordered capture metadata. Artifact files are written to a unique staging directory and renamed before inserting the capture row. Database triggers reject updates and deletes to capture rows. There is no claim of atomicity across the filesystem and SQLite: an interruption between rename and database insert can leave an unreferenced artifact directory. Existing captures remain independently inspectable.

Every record hashes its artifacts and links to the previous capture's chain hash for the same source. The record chain hash is SHA-256 over `JSON.stringify` of the record fields excluding `chainHash`; property order therefore forms part of this versioned format. This is tamper evidence relative to a retained trusted reference, not immutable storage. A user controlling the database and filesystem can rewrite a complete history.

## Network boundary

The browser's requests are intercepted and fulfilled using an HTTP(S) transport that validates DNS answers and pins the selected public address to the actual connection. Redirect destinations and subresources pass through the same policy. The browser is configured with an application-owned deny-all proxy to deny direct network fallback. Fresh contexts block service workers, WebSockets, and downloads. Only GET/HEAD requests and standard HTTP(S) ports are accepted. Outbound browser cookies and authorization headers are not forwarded; `Set-Cookie` is not retained in metadata.

Production does not expose a local-network opt-out. Integration tests explicitly inject a transport constrained to a fixture URL. This seam is a programmatic test facility, not an environment flag or API option.

The API binds to `127.0.0.1`, validates the Host header, rejects foreign Origin headers, applies a content security policy, and serves captured HTML as a text attachment. It is not a multi-user hosting security design.

## Scheduling and comparison

A 15-second timer chooses a due, unpaused, unarchived source while no capture is running. Intervals use the last attempt, including failures. Missed executions are not backfilled while the process is stopped. There is one capture slot; concurrent manual requests receive a conflict response.

Comparison works on retained normalized text, with line-level additions/deletions and word-level inline differences. Replacements appear as removed plus added text. Outbound links are compared as sets and page-title changes are reported explicitly. The additional HTML structure view compares bounded element outlines with selected semantic attributes. Screenshot review overlays saved images; it does not compute a pixel-difference score.

## Portable evidence

An export contains all captures for one source, or a selected history prefix including earlier ancestors needed for chain verification, artifacts, metadata, `manifest.json`, usage notes, and a copy of `verify.mjs`. Export first checks local hashes and chain links. The manifest hashes every other bundle file. Its SHA-256 is displayed separately in the UI and available in the export response header. The verifier checks file hashes, chain ordering, manifest membership, unsafe paths/symlinks, and unexpected files. Verification never fetches the original website.

External site assets are not packaged separately. The bundle preserves evidence files for inspection, not a complete offline website replay. ZIP assembly is in memory and bounded to 256 MiB of capture artifacts.


### Additional resource bounds

Production transport permits at most six simultaneous resource requests inside the single active capture. All resource streams share a 32 MiB byte budget; individual responses are limited to 8 MiB. Responses compressed despite an identity-encoding request are rejected to prevent decompression bombs. Rendered HTML is limited to 16 MiB after serialization. Screenshot width is limited to 4096px and total area to 160 million pixels. Screenshot height defaults to 100,000px and is configurable from 1,000 to 200,000px. The 45-second deadline begins after browser startup (startup itself has a 10-second timeout). These bounds do not replace OS-level memory/CPU isolation: hostile page scripts can still consume resources before measurement.

Capture persistence uses `BEGIN IMMEDIATE` through the chain read, file publication, and database insert, so writers serialize when using the same SQLite database. A database rollback can leave an unreferenced capture directory if a process fails after rename; it does not overwrite prior observations.

## Research layer

`src/research.ts` adds independent `research_annotations` and `research_events` tables with foreign keys to existing sources/captures. Capture success records one changed event only when subsequent text/title/links differ; initial and unchanged captures do not create alerts. Failures create failure notices. `readAt` provides local triage state. Notes are editable, not original evidence or immutable audit entries. Source-history export includes notes only for included captures and hashes the supplemental JSON in the manifest.

`src/structure.ts` parses inert HTML through parse5 into bounded element outlines; it never executes scripts or fetches remote assets. `ui/research.tsx` provides inbox, notes, screenshot overlay, and structure views. Overlay clips are drawn using static CSS classes, preserving the dashboard CSP without inline-style exceptions.

## 1.2.0 additions

The knowledge workspace stores editable typed nodes and labeled directional relationships separately from capture history. Nodes hold title/body/tags and source/capture references; relationships can cite an exact evidence capture. Incoming saved edges derive backlinks. Search/type filters serve graph and list navigation. Limits are 1,000 nodes, 5,000 edges, 60 displayed graph nodes, and the latest 1,000 capture choices with truncation indicated. Graph JSON is an export of mutable researcher context, not a capture-chain extension or certification.

Screenshot settings select single-image or tiled mode, with HTML/text fallback enabled by default and a strict option. Single-image bounds remain 100,000px default height (up to 200,000px), 4,096px width, and 160 million pixels. Tiled mode captures ordered tiles up to 8,192px high, capped at 64 tiles/524,288px coverage and 64 MiB image data. Screenshot work is bounded to 25 seconds and five seconds per tile; the overall 45-second deadline still applies. `screenshotInfo` describes coverage and incomplete reasons. Partial files remain inventoried, hashed, exported, and verified. Failure may therefore yield a valid HTML/text observation without a complete screenshot rather than a fabricated visual success. Existing capture hashes and single-image views remain compatible.
