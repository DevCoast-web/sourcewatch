# Workspace validation — 2.0.0-alpha.1

Validated locally on Windows with Node.js 24 and real Playwright Chromium. This is engineering regression coverage, not an independent security audit or full Obsidian parity certification.

## Results

- Production build, TypeScript and ESLint passed.
- Final fresh-source validation: **98 tests, 95 passed, 0 failed, 3 skipped**. Skips concern Windows symlink/junction privileges. The full suite retains the original capture/compare/export/offline-verification workflow, tall-page/tiled fallback, DNS/private-network restrictions, request races and storage failure checks.
- The integrated browser journey passed in the final suite: entity lookup → documented network neighborhood → add to canvas → embed another entity, linked note and attachment → draw hypothesis → propose review → explicitly review preserved evidence → restart service → restore canvas → export references and relationship metadata.
- Follow-up workspace/tools tests passed, including missing/modified/unexpected-file verification, revision export, actual CLI requests and importable repository samples.
- PDF browser test passed with the bundled worker, actual rendered pixels and extracted text, and no external requests.
- Audio browser test passed using actual Chromium MediaRecorder and a synthetic microphone, saving nonempty bytes and a SHA-256 attachment record. Physical microphones and iPhone hardware remain untested.
- `npm audit --audit-level=moderate`: **0 vulnerabilities** at this checkpoint. This does not guarantee absence of vulnerabilities.

## Clean-source package validation

A source ZIP from commit 9fab96a was extracted into a new isolated directory. A normal `npm ci` installed dependencies, then lint, production build/TypeScript and the complete 98-test suite passed. The existing project-local Chromium installation was reused via PLAYWRIGHT_BROWSERS_PATH; a new browser download and Explorer double-click were not tested. An initial offline-cache-only install failed because one cached package was absent; the ordinary documented installation succeeded. Final documentation-only updates do not change the tested application code.

## What the browser tests actually exercise

`canvas-ui.test.ts` creates and moves real cards, resizes/aligns selections, draws labeled hypothetical connections, embeds/removes references, runs undo/redo and read-only controls, checks saved records, revision conflicts, generated export bytes and mobile width. The managed Windows browser cancels native disk downloads; the test observes the actual application-generated Blob bytes and native download intent instead of claiming that OS file saving passed.

`vault.test.ts` exercises Markdown editing, escaped reading, links/backlinks, history restore, import, reload persistence, slash insertions and slides. Engine tests cover note composer atomic rollback, merge provenance and independent revisions.

`intelligence.test.ts` exercises real entity creation, cited relationships, explicit local review, graph navigation/zoom and export intent. Unsaved intelligence drafts survive attempted workspace closure until discarded or saved. Engine tests cover imports, original currencies/null values, bounded graphs/paths, review history and portable research verification.

`workspace-journey.test.ts` crosses module boundaries in one browser session and restarts the application against its isolated database. `workspace-media.test.ts` covers real PDF rendering and attachment database-failure cleanup. `workspace-tools.test.ts` covers property formulas, declarative extension permissions, clipping labels, sample imports, loopback CLI and actual recorded audio. `workspace.test.ts` verifies shared revision/CAS semantics, soft-delete recovery, append-only triggers, workspace ZIP contents, standalone verification failures, publication selection/escaping and canvas proposal evidence integrity.

All generated screenshots and evidence examples use explicitly synthetic local fixtures. Production transport does not gain permission to capture private-network URLs. Tests create isolated temporary roots; the user's live data is not used or modified.

## Benchmark

The repeatable `npm run benchmark:network` seeds **10,000 synthetic entities and 12,000 relationships**. The recorded concurrent-regression run measured 14,015 ms seed, 21 ms search, 116 ms local graph, 420 ms bounded path and approximately 94 MiB process RSS. See `network-benchmark.json`. These are local backend measurements, not an all-nodes browser-render or mobile performance guarantee. Normal graph results are bounded.

## Scope still requiring work

The complete master directive and Module J remain partial. In particular: advanced graph community analysis and some requested filters, full editor/transclusion/math parity, arbitrary layout panes, complete attachment/path interoperability and media pixels in image exports, drag-editable kanban, full `.base` compatibility, full restore imports, cloud/encrypted sync/conflict reconciliation, native/offline mobile parity, executable plugin compatibility and live hosted publishing remain unfinished. Browser testing of installed clipper extensions, physical microphones, iPhone/Safari, Firefox and Edge is pending. See `feature-parity.json` and `WORKSPACE_GUIDE.md`.

The independent graph and canvas work together; local reviewed status is not independent certification, and hashes establish file consistency rather than website authenticity or publication time. No public repository, hosted service or publication was created during this expansion.
