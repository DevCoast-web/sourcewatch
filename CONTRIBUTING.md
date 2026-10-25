# Contributing

Use Node.js 24 or newer. Install dependencies with `npm ci`, install Chromium with `npx playwright install chromium`, and run `npm run lint`, `npm run typecheck`, `npm run build`, and `npm test`. On Linux, `npx playwright install --with-deps chromium` installs the browser's system requirements. See [docs/TESTING.md](docs/TESTING.md).

Keep capture, storage, comparison, export, and verification independently understandable. Preserve the local-first boundary: no accounts, commercial APIs, telemetry, or cloud uploads are required for normal use. Changes to network policy must include tests for private destinations, DNS answers, redirects, and subresources. Never introduce a production private-network bypass for test convenience.

Use an explicit test transport for deterministic fixtures. Do not depend on an unrelated public website's availability in the automated suite. Add regression coverage for meaningful behavior and keep screenshots from the actual running UI. Clearly label fixture content.

Do not commit databases, captures of personal material, node_modules, installed browsers, credentials, or environment-specific configuration. Synthetic fixture evidence may be shared if clearly identified. Use focused commits and describe the behavior changed, how it was checked, and remaining limitations in pull requests.

Evidence-format changes must update both export and the standalone verifier. Test intact verification, changed/missing files, and a separately retained manifest hash. Never describe hashes as proof of website authenticity or certified timestamps.

Before a release, run the documented checks on a clean checkout, review dependency audit output, inspect real desktop/mobile screenshots, and verify an exported bundle independently. Hosted CI and public publication should be reported only after they actually happen.

