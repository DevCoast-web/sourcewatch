# Changelog

## 2.0.0-beta.2 / iPhone 0.1.1 — Aperture Eye

Rebuild Windows installer/portable and the native iPhone preview with the selected Aperture Eye logo. Apply the same vector master to the app headers, favicon, repository wordmark, Windows ICO and iOS app icon. Updated downloads retain unsigned beta/personal-signing limitations; no additional mobile feature parity is claimed.

## Native iPhone 0.1.0 — Offline preview

Add a standalone SwiftUI iOS 17+ target with SQLite-backed sources/notes, imported artifacts and pasted-text receipts, linked revision histories, bounded added/deleted text comparison, stored-ZIP evidence export, on-phone verification, an independent Python verifier, note histories and title-based wikilinks/backlinks. The hosted macOS workflow builds an unsigned ARM64 IPA without signing secrets; personal signing is a separate installation step. Direct website capture, monitoring, Graph, Canvas and desktop database migration are not included in this preview. See `ios/INSTALL.md` and `docs/IOS_VALIDATION.md` for tested scope and free-signing renewal limits.

## 1.2.0 — Connections and tall-page candidate

Typed research nodes, explicit labeled relationships, source/capture citations, exact evidence navigation, searchable graph/list views, backlinks, and separate JSON context export. Optional bounded tiled screenshots and default HTML/text fallback preserve usable observations when screenshots fail; incomplete/partial coverage is explicit and retained tiles are checksummed/exported/verifiable. Existing capture chains and single-image inspection remain compatible. A real 210,000px fixture produced 26 tiles. Full integration checks are underway; no fresh-install or public-release claim.

## 1.1.1 — Audit patch candidate

- Prevent stale capture metadata and annotations from following a newly selected capture; disable note saving until its annotation has loaded and surface unsaved-note state.
- Keep screenshot/structure inspection available when text comparison fails and improve delayed/failed request handling.
- Validate source updates before applying them and commit their changes in a transaction.
- Drain active captures before closing storage on shutdown; reject new captures while closing.
- Remove newly published artifacts when a capture database commit fails.
- Expand deterministic backend/network/UI audit coverage and document disabled Chromium OS sandbox and uncompleted Firefox/Edge validation.

Local audit candidate, not a published release. Final suite, dependency audit, and accelerated soak results are recorded in the handoff; no twelve-hour soak or fresh 1.1.1 installation is implied.

## 1.1.0 — Research workspace

Local change/failure inbox, editable capture notes/tags and note search, checksummed annotation exports, screenshot overlay slider, bounded inert HTML structure comparison, Windows .cmd setup/launchers, and default screenshot height raised to 100,000px with configurable limits. Existing capture chains remain unchanged. Local release candidate; public publication remains pending.

## 1.0.0 — release candidate

Initial local-first implementation: Playwright rendered-page capture, SQLite source/history storage, text and outbound-link comparison, responsive React dashboard, editable source metadata, archive/restore, collections and local scheduling, global text search, local settings, explicit title changes, append-only hash-linked capture metadata, full-source and selected-history ZIP evidence export with chain ancestors, and standalone offline verification.

This entry describes the source tree, not a claim of publication. See README and SECURITY for limits, the release handoff for executed checks, and repository tags/releases for actual publication status.

## 2.0.0-alpha.1 — integrated knowledge preview

Added a shared versioned workspace, persistent Markdown vault/backlinks/history, editable JSON Canvas, an entity/relationship database and separate network graph, evidence-reviewed hypotheses, investigations, attachments and local PDF previews. Added workspace/Markdown/graph exports and standalone workspace verification, property views, clip import, declarative navigation extensions, audio recording and loopback CLI. Browser tests exercise actual persisted edits, conflicts and generated export bytes.

This is a dedicated feature-branch preview. Full master expansion and Module J acceptance remain partial; automatic sync, advanced editor/plugin/base parity, complete mobile/offline behavior and advanced graph analysis are unfinished. See the feature matrix and validation report.

## 2.0.0-alpha.2 — Global Graph audit and implementation

Added a derived live ecosystem index and discoverable Global Graph workspace, force-worker/Canvas renderer, category/hub styling, typed stored edges, global/local/investigation perspectives, cluster navigation, record inspector and revision-checked investigation layouts. Added a memory-only labeled 10k/12k demo and actual SQLite index/browser performance benchmarks. Retained the existing Network and editable Canvas. Audit and limits: docs/GLOBAL_GRAPH_AUDIT.md.

## 2.0.0-beta.1 — Windows desktop research desk

- Added Windows installer and portable EXE with bundled Node and capture browser.
- Added a sandboxed desktop window and per-launch authenticated local service, graceful shutdown and single-instance behavior.
- Added native data-folder selection and evidence verification without a separate Node installation.
- Added a searchable record directory, current research metrics, investigation summaries, persistent workspace sidebar and document previews.
- Preserved existing source monitoring, capture/comparison, linked notes, Canvas, Global Graph and evidence exports.
- Patched dependency advisories and added desktop authentication/UI tests and an actual packaged-app smoke workflow.

Unsigned Windows x64 beta. Complete master-expansion parity, native macOS/Linux packages, code signing and automatic updates remain unfinished.
