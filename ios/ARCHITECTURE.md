# Native iPhone architecture

The iOS target is a standalone SwiftUI application, not an Electron wrapper, WKWebView shell, PWA or remote client. It has no runtime dependency on Node, a desktop service or a capture server. SwiftData supplies SQLite-backed source/note persistence. The existing desktop implementation and evidence format are preserved unchanged.

## Modules

- `App/ResearchDesk.swift`: native source directory, file/pasted-text preservation, timeline, comparison and export/share UI. PDFKit extracts selectable PDF text. Imported HTML is stored as bytes, never executed.
- `App/NotesAndTools.swift`: notes, backlinks/outgoing links, note revisions, Markdown sharing and evidence verification. Links currently resolve by title, so rename repair and aliases are future work.
- `Core/Library.swift`: immutable capture directories and local note histories, atomic staging/rename, chain reconstruction, per-process capture serialization, bounded line diff. Opening an artifact checks its checksum.
- `Core/Evidence.swift`: SHA-256 receipt/file integrity, evidence manifests and a bounded stored-ZIP encoder/reader. No archive extraction, downloaded verifier execution or third-party archive dependency.
- `scripts/verify-mobile.py`: independent offline implementation using Python's standard library. CI tests a Swift-generated ZIP with this verifier.

## Mobile evidence format, version 1

The ZIP contains `manifest.json` and `captures/<UUID>/receipt.json`, `text.txt`, and optional `original.<extension>`. Every non-manifest file is listed in the manifest with a SHA-256. Each receipt lists its own artifact checksums and records `previousHash`, which is the SHA-256 of the exact previous receipt file bytes. The first receipt omits `previousHash`. Captures are ordered by the chain rather than potentially inaccurate wall-clock ordering. Receipt bytes are never re-encoded for verification.

The manifest has `format: sourcewatch-mobile-evidence-v1`, `sourceID`, ordered `captures`, `files` and `timestampNotice`. Receipt properties are `id`, `sourceID`, `observedAt`, `originalURL`, `title`, `method`, optional `previousHash` and `files`. Methods distinguish researcher-imported files and pasted text. A URL is a researcher-supplied reference, not a verified origin. This is deliberately a distinct format from desktop captures because it does not observe HTTP responses or rendered pages.

ZIP uses method 0 (no compression), CRC32, UTF-8 file names and standard central/end records. Exports are capped at 128 MiB, 5,000 files and 1,000 captures per source. Each attachment is capped at 32 MiB and text at 512 KiB. Inline diffs cap combined input at 128 KiB/4,000 lines. Exceeding a limit produces an error; it does not silently truncate the preserved artifact. The on-phone verifier accepts SourceWatch Mobile ZIPs, not arbitrary compressed archives or desktop bundles.

## Threat model and limits

Checksums detect modification against a manifest; receipt links expose breaks in the bundled chain. Neither protects against an attacker replacing the entire bundle and all hashes. Retain the manifest hash separately. Local timestamps are supplied by the device, and imported evidence is not proof of a website's authenticity or publication time.

The app's filesystem protection is the iOS sandbox and device protection. No claim of independent certification, forensic write-once hardware or encrypted exports is made. A person with access to the app's sandbox may alter data; the verifier detects inconsistencies but is not an access-control system. ZIPs and Markdown exports contain plaintext research. iOS backups follow device settings. Removing the app can remove local research.

All URL/network capture is currently absent, so the preview cannot be used as a private-network proxy. Any future fetcher must implement public-network enforcement and resource limits before it is enabled. No login, paywall, CAPTCHA or access-control bypass is implemented.

## Validation

XCTest covers capture/restart/export/verification, deletion/modification detection, reordered chains, retained manifest hashes, malformed ZIPs, input limits and note revision persistence. XCUITest exercises the real native source/revision/compare/relaunch workflow. Python tests exercise the independent verifier, which also checks an archive produced by Swift in the simulator. Hosted simulator tests do not prove signing or successful installation on a physical phone; that remains a separate explicit check.
