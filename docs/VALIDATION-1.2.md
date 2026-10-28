# SOURCEWATCH 1.2.0 validation

Executed locally on Windows with Node.js 24.22.1 and Playwright Chromium. This is an engineering validation record, not an independent security audit or a public release.

- Full suite: **64 tests, 62 passed, zero failed, two Windows link-permission skips**. The same totals passed in an independent clean source copy after dependency installation and build.
- `npm.cmd run build`, `npm.cmd run lint`, and `npm.cmd run typecheck`: passed. `npm.cmd audit --audit-level=low`: zero vulnerabilities. The application version changed; dependency versions did not.
- Clean-copy `npm.cmd ci` installed 186 packages and the production build passed. An initial offline installation lacked cached packages; normal registry installation then succeeded. Tests reused the already installed project-local Chromium. A fresh browser download and Explorer double-click launch were not repeated for 1.2.0.
- Real capture of a 210,000px fixture saved 26 ordered PNG tiles. Every image's PNG dimensions and contiguous coverage were checked. This exceeds the single-image height and area limits without requesting one enormous PNG.
- A two-version 24,000px/26,000px fixture exercised tiled browser comparison, exact bottom-image pixels, Settings mode/fallback controls, artifact access, ZIP export, standalone offline verification, and missing-tile detection. An over-wide fixture preserved HTML/text with an explicit visual warning; strict mode rejected it. [Example bundle](../examples/tiled-evidence.zip), [manifest fingerprint](../examples/tiled-manifest.sha256), [verification result](../examples/tiled-verification.json).
- Research tests covered node/relationship CRUD, tags, search, kind filters, backlinks, source and exact-capture navigation, context export, persistence, input validation, and capacity limits. Graph edits left capture metadata and chains unchanged. The JSON export excludes the unrelated capture-picker choices.
- Desktop and 390px mobile browser checks passed. Actual fixture screenshots were regenerated; the connections layouts were visually inspected. [Desktop](screenshots/connections.png), [mobile](screenshots/connections-mobile.png).
- The managed Chromium environment canceled native JSON downloads, including a standalone data-URL control. The graph test checked the download filename/intent and the successful HTTP attachment payload instead. A completed native file-save operation is not claimed for this environment.

## Remaining limits

Tiled capture is bounded: 4,096px width, 8,192px per tile, 64 tiles/524,288px, 64 MiB image bytes, a 25-second screenshot budget with five seconds per tile, inside the 45-second overall capture deadline. The single-image height setting applies to single-image mode. Tiles are sequential observations, so dynamic content can change between images. Infinite scrolling and off-screen lazy content are not automatically loaded. Fallback is available after HTML/text extraction; an earlier navigation or overall deadline failure still rejects the capture. Inspect explicit coverage metadata and warnings.

Research relationships are mutable user interpretations. A linked capture supports inspection of a cited document; the link does not establish the truth of a claim, identity, or causation. Research JSON is separate from integrity-verifiable evidence ZIPs. No import, Obsidian vault synchronization, automated entity extraction, or inferred relationships are implemented.

Chromium OS-sandbox limitations, Firefox/Edge launch restrictions, and pending GitHub publication/hosted CI remain as documented in [SECURITY](../SECURITY.md) and [release status](RELEASE.md). No overnight endurance claim is made by these short regression tests.
