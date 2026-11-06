# Desktop beta validation

Version: 2.0.0-beta.1. Environment: Windows x64, Node 24, Electron 45.2.3 and the pinned Playwright headless browser. This is local engineering verification, not independent security certification.

The standard regression checkpoint completed 103 tests: **102 passed, zero failed, one Windows privilege skip**. Build/TypeScript and ESLint passed. A subsequent directory test checks search, document preview, record navigation, dark-theme switching and mobile width. The final consolidated result is recorded below when all release checks finish.

The actual packaged `SourceWatch.exe` opened the research overview and used the bundled Node engine. Its renderer reported Node integration disabled, context isolation enabled and sandboxing enabled. Requests to its local API without the desktop session header returned 403. It saved/indexed a note, restarted and reopened it successfully.

With isolated test data, the packaged app captured the real public `https://example.com/` page using its bundled capture browser, exported its evidence ZIP, and successfully verified the extracted evidence with the native File-menu command and the trusted bundled verifier. The automated test supplied the native folder selection and inspected the result dialog; capture, export and verification themselves ran normally. Synthetic screenshot records were added only to that isolated test database.

Release artifacts contain only packaged app/runtime/browser resources. The build excludes user data, captures, local profiles and browser logs, includes exact-version Node and browser licenses, and uses pinned runtime dependencies. `npm audit` at the rollout checkpoint reports zero vulnerabilities; this is not a guarantee of absence of vulnerabilities.

The Windows installer is built; an automated native install/uninstall interaction pass is not claimed. Portable extraction/startup is tested separately. No Windows signing certificate was configured, so the beta is unsigned. No native macOS/Linux or automatic-update pass is claimed. Existing master/Module J feature gaps remain documented in feature-parity.json.
