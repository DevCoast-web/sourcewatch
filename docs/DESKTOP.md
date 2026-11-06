# SourceWatch for Windows

The desktop beta bundles the application, Node.js and the Playwright capture browser. Users do not need npm, Node, an API key or a terminal.

## Start

Download the **portable EXE** to run without installation, or the **setup EXE** for a per-user installation and Start menu shortcut. Both are Windows x64 builds. The portable file extracts its bundled runtime before opening; its first launch can take longer than later launches. Keep SourceWatch open for scheduled captures.

This beta is **not Authenticode signed**. Windows may show an unknown-publisher/SmartScreen notice. A checksum verifies consistency with the published release artifact; it is not publisher certification. Do not disable Windows security protections. Automatic updating is not enabled in this beta.

## Your existing research

Desktop data is stored in the per-user SourceWatch application-data folder, outside the program installation. Upgrading or uninstalling the application does not deliberately remove the research directory. **File → Open data folder** shows its location.

To use captures from the earlier browser-based version:

1. Stop that version's local service and back up its data directory.
2. In the desktop app choose **File → Use existing data folder…**.
3. Select the folder containing `sourcewatch.sqlite` and `captures` (normally the old project's `data` directory).
4. Confirm the restart. SourceWatch uses that selected folder directly; it does not silently move or merge research data.

Do not run browser and desktop services against the same data directory simultaneously. The desktop service uses an exclusive lock to prevent duplicate desktop use; the older browser service does not participate in that lock. Capture histories remain append-only. Notes and layouts retain their independent revision histories.

## Workflow

The app opens to **Overview**, with live counts, a searchable research directory, investigations and monitored sources. The persistent sidebar connects Overview, Global Graph, Notes & vault, Canvas, Database & network, Property views and Tools & exports. **Source monitor** returns to capture and comparison. Existing detailed editors and graph/canvas workflows remain in place.

**File → Verify extracted evidence…** verifies an extracted capture or workspace ZIP using the trusted verifier bundled with the app. It does not execute a verifier taken from the selected folder. No separate Node installation is needed for this command. Verification checks consistency, not website authenticity, factual truth or independently certified observation times.

## Desktop boundary

The renderer uses context isolation and Chromium sandboxing, with Node integration disabled. It connects to a private loopback service on an automatically assigned port. A per-launch secret is attached by the desktop session and checked by the service; it is not put in URLs or exposed through a preload bridge. Navigation to external pages is blocked, and external-browser openings require an explicit choice. Captured websites continue to run through the separate Playwright capture engine and public-network policy, not in the privileged app window.

Microphone access requires a user action and native confirmation. Other unneeded permissions are denied. The capture engine's existing resource limits and security limitations still apply; the desktop wrapper does not provide independent security certification or OS isolation for the capture engine.

## Build from source

Use Windows x64 and Node.js 24+:

```powershell
npm.cmd ci
node node_modules/electron/install.js
$env:PLAYWRIGHT_BROWSERS_PATH="$PWD\.browsers"
npx.cmd playwright install chromium
npm.cmd run desktop:build
```

The build stages an allowlisted runtime under ignored `work/desktop-runtime`, copies the build machine's Node executable and its exact-version license, installs pinned runtime dependencies, and includes the matching headless capture browser. Personal databases, captures, browser profiles, logs and installed development browsers are excluded. Installer and portable outputs appear under ignored `release/`.

`npm.cmd run desktop:dir` creates an unpacked executable for testing. `scripts/smoke-desktop.ts` exercises the actual Electron application against isolated data; set `SOURCEWATCH_TEST_EXECUTABLE` to test the packaged EXE. Set `SOURCEWATCH_DESKTOP_CAPTURE=1` to additionally capture example.com, export evidence and exercise the native verifier. The standard regression suite is separate and uses deterministic local fixtures.

Platform and code-signing work for macOS/Linux, automatic updates, tray/background scheduling while closed, and a fully automated native installer-interaction pass are outside this beta's completed scope. The app itself and a Windows public capture/export/verification/restart workflow have been tested; see DESKTOP_VALIDATION.md for final results.
