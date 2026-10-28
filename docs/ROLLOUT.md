# Staged rollout

SOURCEWATCH should first earn confidence through a small local research pilot. This plan describes release acceptance and feedback collection; it does not claim users, adoption, completed features, or a published GitHub release. Public publication remains a separate gate requiring actual repository access and passing checks.

## Stage 1 — 1.1 local pilot

The 1.1 local release candidate implements a research inbox for changed sources and capture failures, researcher notes/tags, HTML structure comparison, a screenshot comparison slider, and Windows setup/launch scripts. A screenshot slider compares preserved images visually; it is not an automated pixel diff. These are locally implemented and tested features, not a public release or evidence of external adoption.

Use a small set of public pages that the researcher has permission to monitor, plus deterministic changing fixtures. Start with manual captures and conservative intervals. Keep data on the pilot machine. Avoid sensitive URLs and review exported material before sharing.

Accept the pilot when a researcher can:

1. Set up and launch from documented instructions on a clean supported machine.
2. Add a source, capture two revisions, and find a meaningful change or capture failure in the research inbox.
3. Add notes/tags and confirm they persist across a service restart.
4. Compare retained text, HTML structure, and screenshots, understanding each view's limitations.
5. Export evidence, independently verify an intact bundle, and detect a deliberately changed artifact.
6. Archive or pause an unwanted source without losing its retained history.

The candidate test run reported 32 tests: 31 passed, none failed, and one Windows symlink test skipped. The research UI test exercised notes/tags and notes export verification, rejection of tampered notes, HTML structure and screenshot comparison, height settings persisted across restart, and no mobile overflow. The launcher was exercised through `cmd.exe /c start-sourcewatch.cmd` on isolated port 3212: version 1.1.0, status/settings, and HTTP 200 were checked, then it was stopped. The setup script subsequently completed from a fresh source extraction, including dependency installation, Chromium download and build; the clean copy again passed 31 tests with one Windows privilege skip. Explorer double-click interaction was not tested.

Continue running automated build, lint, type-check, capture/comparison/export/verifier tests and real desktop/mobile UI checks. Exercise the Windows launchers from Command Prompt and separately by double-clicking before claiming both paths were tested. Check failures as well as successes: missing dependencies, old Node, capture rejection, and occupied ports. Record actual commands and outcomes.

Collect feedback manually with consent; no telemetry is required. Ask researchers which change mattered, whether a deleted section was easy to find, whether the inbox caused confusion, how notes/tags helped follow-up, and whether they could explain what verification establishes. Record reproducible defects without private page content. Prioritize broken evidence workflows and misleading interpretation before convenience features.

External email alerts are not implemented. The local research inbox is the notification surface in this candidate. Larger-page capture now defaults to a configurable 100,000px height ceiling (range 1,000–200,000), with fixed 4,096px width and 160-million-pixel area limits. The total capture deadline remains 45 seconds; increasing height does not guarantee capture of every large page.

## Stage 2 — Interoperability and archival depth

WARC/WACZ interoperability and complete offline replay are future work, not capabilities implied by the current ZIP format. Evaluate standards and replay behavior against representative sites, external resources, redirects, and dynamic content before selecting an implementation. Preserve the existing independently executable verification workflow through any evidence-format migration. Document archival completeness and unsupported cases honestly.

## Stage 3 — Optional multi-user operation

Shared hosting is optional future scope. It requires a separate review of authentication, authorization, tenant isolation, browser sandboxing, network egress, storage quotas, secret handling, and deployment operations. The current loopback service should not be exposed publicly as a shortcut. Proceed only with explicit hosting authorization and a security design appropriate to multiple users.

## Publication gate

A rollout plan is not a release. Publish only after documented checks pass and the actual repository/release is created. Review [RELEASE.md](RELEASE.md) and the final handoff for the current publication state, exact artifacts, and any outstanding authentication/tool restrictions.

## 1.2.0 local candidate

The next local candidate implements typed research connections, explicit labeled edges with evidence citations, backlinks/search/type filters, graph/list navigation, and separate JSON research-context export. It also adds bounded tiled screenshots and HTML/text fallback with explicit incomplete coverage. A 210,000px fixture produced 26 tiles; The full local suite completed 64 tests: 62 passed, zero failed, and two Windows symlink/junction permission cases skipped. Build, lint, and type checking passed; npm audit --audit-level=low reported zero vulnerabilities. Tiled settings controls and research export regression checks also passed. An independent clean source copy installed dependencies, built, and passed the same 62 tests with two skips, using the existing Chromium installation. See [1.2 validation](VALIDATION-1.2.md) for scope and environment limits. No external adoption or public release is claimed.

Pilot acceptance additionally requires exact cited-capture navigation, graph edits leaving capture hashes unchanged, honest distinction between user assertions and verified artifacts, and usable fallback when screenshot limits are reached. Tiling remains bounded and does not add full archival replay, WARC/WACZ compatibility, or infinite-scroll guarantees. The original reference review is in [RESEARCH_DESIGN.md](RESEARCH_DESIGN.md).
