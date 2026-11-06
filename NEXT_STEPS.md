# Windows desktop rollout — 2.0.0-beta.1

The Windows installer and portable application bundle the local engine and capture browser. See [desktop instructions](docs/DESKTOP.md) and [validation](docs/DESKTOP_VALIDATION.md). The research workspace now uses persistent sidebar navigation, a record directory and document inspection. Runtime data stays outside application files and is excluded from release artifacts.

Repository/release destination: DevCoast-web/sourcewatch. The latest explicit user instruction authorizes this rollout and push; earlier no-publication checkpoints below are historical. This remains a beta, not full master-directive or Obsidian parity completion. Signing, automatic updates, native macOS/Linux packages and remaining feature-matrix gaps are still future work.

## Historical expansion checkpoint — 2.0.0-alpha.1

Work is isolated on the dedicated SourceWatch branch `feature/visual-knowledge-workspace`. The integrated workspace is a tested local alpha, not full master-directive completion. No remote, public release, hosting or private-data upload has been created. Publication requires a separate explicit instruction; the historical commands below are not authorization to publish this alpha.

Read [workspace guide](docs/WORKSPACE_GUIDE.md), [validation](docs/WORKSPACE_VALIDATION.md), and the complete [feature matrix](docs/feature-parity.json). Next work prioritizes remaining advanced graph filters/community analysis, attachment interoperability and image exports, richer editor/Bases behavior, mobile acceptance, and recoverable backup imports. Sync and live publishing require separate privacy-preserving implementations and are not silently enabled.

# Historical release notes

SOURCEWATCH 1.2.0 is a locally implemented tested local candidate in its dedicated `sourcewatch` repository. Publication remains blocked: this session had no GitHub CLI, the authenticated connector lacked repository creation, and the browser required sign-in. No GitHub remote repository or public release was created. Do not reuse an unrelated repository.

Historical 1.1.0 validation: the candidate test run reported 32 tests: 31 passed, zero failed, one Windows symlink test skipped. The Windows start script was exercised through Command Prompt on isolated port 3212, served version 1.1.0 with working status/settings and HTTP 200, and was stopped afterward. The setup script subsequently ran successfully from a fresh ZIP extraction, including dependency/Chromium installation and build; clean-copy tests again passed 31 with one skip. Explorer double-click interaction was not tested.

Historical 1.1.1 patch checkpoint: build, lint, and type checking passed; the full suite completed 56 tests with 54 passed, zero failed, two Windows symlink/junction cases skipped. `npm audit --audit-level=low` reported zero vulnerabilities. An accelerated 12-cycle soak passed in 28,291ms, with 11 captures, one HTTP 403 failure, five change events, and successful persisted inspection/notes, chain, offline ZIP, and reopen checks. Do not equate accelerated cycles with twelve hours. No fresh-extraction install for 1.1.1 or Firefox/Edge UI pass is claimed. See [docs/AUDIT.md](docs/AUDIT.md).

Current 1.2.0: research connections and bounded tiled screenshots/fallback are implemented; a 210,000px fixture produced 26 tiles. The full local suite completed 64 tests: 62 passed, zero failed, and two Windows symlink/junction permission cases skipped. Build, lint, and type checking passed; npm audit --audit-level=low reported zero vulnerabilities. Tiled settings controls and research export regression checks also passed. An independent clean source copy installed dependencies, built, and passed the same 62 tests with two skips, using the existing Chromium installation. See [1.2 validation](docs/VALIDATION-1.2.md) for scope and environment limits. Older captures remain valid. No public release is claimed.

1. Review the final handoff and run any pending release gates: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, and `npm audit --audit-level=moderate`.
2. Confirm release packaging produced `../sourcewatch-v1.2.0.zip` and `../sourcewatch-v1.2.0.sha256`, review the contents, and verify the checksum. These packaged files are provided beside the repository.
3. Review `git status --short` and commit the final candidate if necessary. Exclude generated databases, personal captures, node_modules, and installed browsers.
4. Install/authenticate GitHub CLI, then run `gh repo create sourcewatch --public --source=. --remote=origin --push` from this dedicated repository.
5. Inspect hosted CI with `gh run list`; resolve any failure before tagging. Follow [docs/RELEASE.md](docs/RELEASE.md) to create `v1.2.0` and attach the verified archive/checksum after all gates pass.

To set up Windows: run `setup-sourcewatch.cmd`, then `start-sourcewatch.cmd`. Setup installs dependencies and project-local Chromium and builds the UI. After source updates, rerun setup or `npm.cmd run build` before launching so an existing UI build does not remain stale. Open the printed local address, normally http://127.0.0.1:3210.

External email alerts, WARC/WACZ interoperability, full archival replay, and multi-user hosting are not implemented. See [docs/ROLLOUT.md](docs/ROLLOUT.md) for the staged scope.
