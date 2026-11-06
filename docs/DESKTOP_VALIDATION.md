# Desktop beta validation

Version: 2.0.0-beta.1. Environment: Windows x64, Node 24, Electron 45.2.3 and the pinned Playwright headless browser. This is local engineering verification, not independent security certification.

The final local regression completed **104 tests: 103 passed, zero failed, one Windows privilege skip**. Build/TypeScript and ESLint passed. The directory test checks search, document preview, record navigation, dark-theme switching and mobile width. GitHub Linux CI also passed for the desktop implementation.

The actual packaged `SourceWatch.exe` opened the research overview and used the bundled Node engine. Its renderer reported Node integration disabled, context isolation enabled and sandboxing enabled. Requests to its local API without the desktop session header returned 403. It saved/indexed a note, restarted and reopened it successfully.

With isolated test data, the packaged app captured the real public `https://example.com/` page using its bundled capture browser, exported its evidence ZIP, and successfully verified the extracted evidence with the native File-menu command and the trusted bundled verifier. The automated test supplied the native folder selection and inspected the result dialog; capture, export and verification themselves ran normally. Synthetic screenshot records were added only to that isolated test database.

Release artifacts contain only packaged app/runtime/browser resources. The build excludes user data, captures, local profiles and browser logs, includes exact-version Node and browser licenses, and uses pinned runtime dependencies. `npm audit` at the rollout checkpoint reports zero vulnerabilities; this is not a guarantee of absence of vulnerabilities.

The Windows installer is built; an automated native install/uninstall interaction pass is not claimed. Portable extraction/startup is tested separately. No Windows signing certificate was configured, so the beta is unsigned. No native macOS/Linux or automatic-update pass is claimed. Existing master/Module J feature gaps remain documented in feature-parity.json.

## Packaging isolation check

A separate copy outside the development repository was blocked from starting by this machine's Device Guard policy. This is not recorded as a successful launch, and no security policy was changed. The earlier packaged workflow above ran inside the repository; an isolated Windows CI test and a portable extraction/startup test are required separately. The packaging guard now verifies that every runtime JavaScript, JSON, native-module and WASM dependency is included, including dependencies previously omitted by the builder default.

## Final portable and engine results

The final portable EXE extracted and launched successfully with isolated data in 79.8 seconds on this machine. The packaged renderer had sandboxing and context isolation enabled and Node integration disabled; shutdown removed the engine lock. See portable-validation.json. This successful portable test is distinct from the policy-blocked relocated executable.

The final bundled Node engine and capture browser were also exercised from a copy outside the repository, with no ancestor development dependencies. They captured https://example.com/, exported a 40,622-byte evidence ZIP, and the bundled offline verifier returned ok=true, captures=1, errors=[]. The builder completeness guard passed. The separate GitHub Windows workflow additionally runs isolated desktop and portable tests; its current status is available in Actions.
