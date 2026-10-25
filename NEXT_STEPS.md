# Next steps

SOURCEWATCH 1.1 is a locally implemented and tested release candidate in its dedicated `sourcewatch` repository. Publication remains blocked: this session had no GitHub CLI, the authenticated connector lacked repository creation, and the browser required sign-in. No GitHub remote repository or public release was created. Do not reuse an unrelated repository.

The candidate test run reported 32 tests: 31 passed, zero failed, one Windows symlink test skipped. The Windows start script was exercised through Command Prompt on isolated port 3212, served version 1.1.0 with working status/settings and HTTP 200, and was stopped afterward. The setup script subsequently ran successfully from a fresh ZIP extraction, including dependency/Chromium installation and build; clean-copy tests again passed 31 with one skip. Explorer double-click interaction was not tested.

1. Review the final handoff and run any pending release gates: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, and `npm audit --audit-level=moderate`.
2. Confirm release packaging produced `../sourcewatch-v1.1.0.zip` and `../sourcewatch-v1.1.0.sha256`, review the contents, and verify the checksum. These packaged files are present beside the repository.
3. Review `git status --short` and commit the final candidate if necessary. Exclude generated databases, personal captures, node_modules, and installed browsers.
4. Install/authenticate GitHub CLI, then run `gh repo create sourcewatch --public --source=. --remote=origin --push` from this dedicated repository.
5. Inspect hosted CI with `gh run list`; resolve any failure before tagging. Follow [docs/RELEASE.md](docs/RELEASE.md) to create `v1.1.0` and attach the verified archive/checksum after all gates pass.

To set up Windows: run `setup-sourcewatch.cmd`, then `start-sourcewatch.cmd`. Setup installs dependencies and project-local Chromium and builds the UI. After source updates, rerun setup or `npm.cmd run build` before launching so an existing UI build does not remain stale. Open the printed local address, normally http://127.0.0.1:3210.

External email alerts, WARC/WACZ interoperability, full archival replay, and multi-user hosting are not implemented. See [docs/ROLLOUT.md](docs/ROLLOUT.md) for the staged scope.
