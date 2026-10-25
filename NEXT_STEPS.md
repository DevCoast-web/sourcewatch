# Next steps

The remaining publication step requires GitHub repository-creation access. This build session had no `gh` CLI, the connector lacked repository creation, and the browser required sign-in. No public remote or release was created.

1. Confirm the final build handoff's checks pass. From this directory run `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, and `npm audit --audit-level=moderate` if any check remains pending.
2. Review `git status --short` and commit the final release candidate if not already committed. Do not add generated databases or node_modules.
3. Install/authenticate GitHub CLI, then run `gh repo create sourcewatch --public --source=. --remote=origin --push` from this dedicated repository.
4. Inspect the actual hosted CI run using `gh run list`; resolve any failure before tagging.
5. Follow [docs/RELEASE.md](docs/RELEASE.md) to create `v1.0.0` and attach the actual archive/checksum artifacts after all gates pass.

To run locally now: `npm ci`, `npx playwright install chromium`, `npm run build`, `npm start`, then open http://127.0.0.1:3210.
