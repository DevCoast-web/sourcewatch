# Local validation

Executed on Windows with Node.js 24.22.1 and Playwright Chromium. This is local validation, not a hosted CI or independent security audit.

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; TypeScript check and Vite production output generated.
- `npm test`: 19 tests; 18 passed, 0 failed, 1 skipped. The skipped test creates symbolic links and cannot run without additional Windows privileges. Its verifier path logic is covered by other malicious-path tests; the actual symlink branch remains unverified on this host.
- `npm audit --audit-level=moderate`: zero vulnerabilities in the installed dependency graph at execution time.
- `npx tsx scripts/public-smoke.ts`: actual production transport captured https://example.com/ with HTTP 200, preserved HTML/text/PNG, and exported an evidence ZIP. No capture warnings.
- The bundled standalone Node verifier independently verified the public example: `ok: true`, one capture, no errors. See `examples/public-verification.json` and its separately retained manifest fingerprint.
- The browser integration test preserved two deliberately different fixture revisions, confirmed removed/added text and changed outbound links, displayed both diff modes, inspected real PNG files, exported ZIPs, and ran the verifier as a separate Node process. Modified and missing artifacts both caused failure.
- Browser tests also exercised settings, source editing, schedule due/paused behavior, concurrency conflicts, failure status without fabricated captures, global and source-local search, archive/restore, selected-history exports, and a 390px mobile viewport without horizontal overflow.
- Resource tests exercised 403 rejection, non-HTML documents, network failure, navigation and total deadlines, an oversized document, excessive screenshot height, six active resource transports, and the 150-request cap.
- Security tests cover private/reserved/mapped/obfuscated address rejection, mixed public/private DNS answers, private redirects and subresources, unsafe Host/Origin headers, traversal paths, externally retained manifest mismatch, modified chain metadata, unexpected files, append-only SQL triggers, unchanged but unique observations, and SQLite persistence after reopen.

Limits: no external penetration test, multi-user hosting review, complete adversarial JavaScript memory isolation, or hosted Linux CI run was performed. Semantic HTML structure diff, pixel diff, notifications, an OS background service, and automatic retention are not implemented. Public publication is blocked by missing repository-creation authentication/tooling; see RELEASE.md.
## Fresh release extraction

The committed source ZIP was extracted into a separate clean directory. `npm ci` installed 184 packages, production build and lint passed, and `npm test` again reported 18 passed, 0 failed, 1 Windows symlink privilege skip. Browser binaries from the previously verified Chromium installation were reused through `PLAYWRIGHT_BROWSERS_PATH`.

The extracted application's actual `npm start` server was launched on loopback port 3211. Its production HTTP API registered https://example.com, captured HTTP 200 with zero warnings, exported a 40,246-byte ZIP, and the ZIP's bundled verifier returned `ok: true`, one capture, no errors. The smoke server was stopped afterward.

The source archive passed Python `zipfile.testzip()` and a filename audit excluding node_modules, runtime data, installed browsers, Git internals, and test scratch directories. PNG dimensions were checked from file headers: comparison 1536×1261, inspector 1536×1685, mobile 390×1498. Original SVG assets declare icon 64×64 and wordmark 720×120.
