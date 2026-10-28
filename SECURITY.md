# Security policy

SOURCEWATCH is intended for a single user on a trusted machine, bound to loopback. Do not expose the API through port forwarding, a reverse proxy, a LAN bind, or public hosting. There is no user authentication or authorization model.

## Reporting

Do not include sensitive capture contents, tokens, or exploitable details in a public issue. If the published repository provides a private security advisory channel, use it. Until such a channel exists, arrange a private report with the repository maintainer before sharing sensitive details. This project does not advertise a response-time guarantee or a completed independent security audit.

## Controls

- Only standard-port HTTP(S) URLs without embedded credentials are accepted.
- Loopback, private, link-local, metadata, reserved, and other non-public IP ranges are rejected, including mapped and normalized address forms.
- DNS answers are validated and the chosen address is pinned for the actual socket. Redirect destinations and browser subresources are checked too.
- Isolated Chromium contexts use intercepted requests, blocked service workers/WebSockets/downloads, and an application-owned deny-all proxy to prevent direct browser network fallback.
- Only GET/HEAD requests are forwarded. Browser cookies and authorization headers are not forwarded; response `Set-Cookie` headers are excluded.
- Request, byte, time, page-height, and concurrency limits constrain resource usage.
- Local Host/Origin checks and a content security policy protect the UI boundary. Captured HTML is downloaded as text rather than rendered inside the application.
- Artifact paths use generated UUIDs and an explicit filename allowlist. The offline verifier rejects unsafe paths and symlinks.
- Export rechecks stored hashes before packaging evidence. Capture rows reject updates/deletes through database triggers.

## Remaining risks

Remote HTML still executes JavaScript in Chromium during rendering. Keep Node.js, Chromium, and dependencies updated. Playwright Chromium is launched with its operating-system sandbox disabled by default. Fresh contexts, request interception, and the deny-all proxy are application controls, not OS isolation. A sandbox-enabled Chromium launch could not run under this managed Windows execution environment. Use an isolated VM for hostile or untrusted pages; this release has not had an independent penetration test. Some sites make requests that are blocked or depend on third-party scripts; review capture warnings and results.

Captured files may contain personal information, secret query parameters, malicious scripts, copyrighted material, or misleading content. Data is not encrypted at rest. Review exports before redistribution. Do not open untrusted HTML files directly in a privileged browser; use a text editor or the preserved screenshot. Run a trusted verifier rather than executing arbitrary JavaScript from someone else's evidence bundle.

Local timestamps come from the machine clock. Hashes and chains cannot prove authenticity, authorship, publication time, completeness, or independently certified observation time. A person controlling all files can recompute a consistent history. Retain the manifest hash separately if later replacement detection matters. This is not a signed archive or trusted timestamping service.

The scheduler runs only while the process runs. There is no automatic retention or secure erase facility. Archive only what you need, choose reasonable intervals, and stop the service before backing up or deliberately removing its data directory.

### Additional resource bounds

Production transport permits at most six simultaneous resource requests inside the single active capture. All resource streams share a 32 MiB byte budget; individual responses are limited to 8 MiB. Responses compressed despite an identity-encoding request are rejected to prevent decompression bombs. Rendered HTML is limited to 16 MiB after serialization. Screenshot width is limited to 4096px and total area to 160 million pixels. Screenshot height defaults to 100,000px and is configurable from 1,000 to 200,000px. The 45-second deadline begins after browser startup (startup itself has a 10-second timeout). These bounds do not replace OS-level memory/CPU isolation: hostile page scripts can still consume resources before measurement.

## Audit checkpoint — 1.1.1

The local engineering audit added regression coverage for network address pinning, credential exclusion, shared byte budgets, compressed-response rejection, request deadlines, atomic source updates, shutdown during capture, storage failure cleanup, selected export prefixes, schema migration, verifier junction handling, and stale/failed UI requests. See [docs/AUDIT.md](docs/AUDIT.md) for scope and pending checks. Chromium UI behavior was validated; Firefox and Edge launch restrictions prevented completed UI passes. No cross-browser pass or independent security certification is claimed.

## 1.2.0 screenshot and knowledge limits

Screenshot failure now defaults to preserving HTML/text with explicit incomplete metadata; Settings can require strict screenshot success instead. Tiled mode is bounded to 64 tiles of up to 8,192px height, 64 MiB image bytes, 25 seconds of screenshot work, and five seconds per tile, within the overall 45-second capture deadline. Partial tiles can remain as evidence with an incomplete reason. These limits do not provide OS isolation or guarantee infinite-scroll/lazy-loading completeness. Existing single-image bounds remain applicable in single-image mode.

Research connections contain editable user assertions, not verified facts or immutable evidence. Source/capture citations aid provenance; they do not certify a relationship. JSON graph exports are separate research context. Avoid sensitive personal material and review exports before sharing. Node/relationship and displayed-graph limits constrain normal UI work; they do not replace an operating-system sandbox. The documented disabled Chromium OS sandbox and recommendation to use an isolated VM remain unchanged.
