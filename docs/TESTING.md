# Testing

## Commands

```sh
npm ci
npx playwright install chromium
npm run lint
npm run typecheck
npm run build
npm test
npm audit --audit-level=moderate
```

Use `npx playwright install --with-deps chromium` on Linux when browser system libraries are absent. Tests expect the built UI in `dist/`, so build first. `npm run build` performs TypeScript checking and the Vite production build. Tests use the Node.js test runner through `tsx`; Playwright drives a real Chromium instance. No external website is required for deterministic fixture tests.

## What the suite exercises

`tests/workflow.test.ts` includes network-policy and comparison unit tests plus a browser-driven integration workflow. The fixture changes its retention policy and replaces a section and outbound link between captures. It also inserts text through JavaScript and includes a dynamic clock excluded from text comparison.

The workflow creates a source through the UI, captures both fixture versions, checks saved HTML/text/PNG artifacts, inspects hash links, displays inline and side-by-side deletion highlights, searches retained text, downloads the evidence ZIP, extracts its contents, and executes the included standalone verifier in a separate Node process. It then modifies a file and removes a screenshot to confirm verification fails. It checks database append-only triggers and refuses export of corrupted local artifacts. Desktop and 390px mobile screenshots come from the actual app.

Private-address tests include reserved/mapped/obfuscated addresses, prohibited schemes/ports, mixed public/private DNS answers, forbidden browser subresources, and a redirect to a forbidden endpoint. The production loopback restriction is preserved: a constrained transport is explicitly injected only by test code.

Tests write disposable data under `.test-data/` and screenshots under `docs/screenshots/`. Screenshots show synthetic research-fixture data, not an observed public website.

## Interpretation

A successful fixture test verifies the tested workflow, not universal compatibility with every website or a complete security audit. Public-network smoke tests and hosted CI results must be reported separately with the commands actually executed. Network outages, bot protection, lazy loading, very large pages, and unsupported content can cause legitimate capture failures.

Review test output rather than assuming that a workflow configuration has run. See the release handoff for the exact checks executed on the release candidate.

