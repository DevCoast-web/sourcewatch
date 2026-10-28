# Next steps

SOURCEWATCH 1.1.1 is a locally implemented and tested release candidate in its dedicated `sourcewatch` repository. Publication remains blocked: this session had no GitHub CLI, the authenticated connector lacked repository creation, and the browser required sign-in. No GitHub remote repository or public release was created. Do not reuse an unrelated repository.

Historical 1.1.0 validation: the candidate test run reported 32 tests: 31 passed, zero failed, one Windows symlink test skipped. The Windows start script was exercised through Command Prompt on isolated port 3212, served version 1.1.0 with working status/settings and HTTP 200, and was stopped afterward. The setup script subsequently ran successfully from a fresh ZIP extraction, including dependency/Chromium installation and build; clean-copy tests again passed 31 with one skip. Explorer double-click interaction was not tested.

Current patch checkpoint: build, lint, and type checking passed; the full suite completed 56 tests with 54 passed, zero failed, two Windows symlink/junction cases skipped. `npm audit --audit-level=low` reported zero vulnerabilities. An accelerated 12-cycle soak passed in 28,291ms, with 11 captures, one HTTP 403 failure, five change events, and successful persisted inspection/notes, chain, offline ZIP, and reopen checks. Do not equate accelerated cycles with twelve hours. No fresh-extraction install for 1.1.1 or Firefox/Edge UI pass is claimed. See [docs/AUDIT.md](docs/AUDIT.md).

1. Review the final handoff and run any pending release gates: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, and `npm audit --audit-level=moderate`.
2. Confirm release packaging produced `../sourcewatch-v1.1.1.zip` and `../sourcewatch-v1.1.1.sha256`, review the contents, and verify the checksum. These are targets until the 1.1.1 packaging step confirms actual files.
3. Review `git status --short` and commit the final candidate if necessary. Exclude generated databases, personal captures, node_modules, and installed browsers.
4. Install/authenticate GitHub CLI, then run `gh repo create sourcewatch --public --source=. --remote=origin --push` from this dedicated repository.
5. Inspect hosted CI with `gh run list`; resolve any failure before tagging. Follow [docs/RELEASE.md](docs/RELEASE.md) to create `v1.1.1` and attach the verified archive/checksum after all gates pass.

To set up Windows: run `setup-sourcewatch.cmd`, then `start-sourcewatch.cmd`. Setup installs dependencies and project-local Chromium and builds the UI. After source updates, rerun setup or `npm.cmd run build` before launching so an existing UI build does not remain stale. Open the printed local address, normally http://127.0.0.1:3210.

External email alerts, WARC/WACZ interoperability, full archival replay, and multi-user hosting are not implemented. See [docs/ROLLOUT.md](docs/ROLLOUT.md) for the staged scope.
