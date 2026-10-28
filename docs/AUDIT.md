# 1.1.1 engineering audit

This is a local engineering audit and regression patch, not an independent security assessment or certification. SOURCEWATCH remains unpublished. Its dedicated local repository is separate from unrelated projects.

## Fixes and coverage

Source inspection and new deterministic tests cover:

- Capture identity under delayed/failed UI requests: old metadata is hidden while another capture loads, annotation-load failures cannot copy an earlier note, and saving is disabled until the selected annotation is available. Unsaved note state is visible.
- Late history/search responses cannot silently replace the active selection; search opens the exact matching capture. Backend-version warnings help identify an outdated running service.
- Text comparison failure does not prevent screenshot or HTML structure review.
- Source PATCH validation happens before mutation; related updates use a transaction.
- Shutdown stops scheduling, rejects new captures, and waits for an active capture before closing SQLite.
- Failed capture commits remove newly published artifact directories instead of leaving ordinary error-path orphans. Abrupt process/power failure still requires separate recovery consideration.
- Selected exports contain the required chain prefix and corresponding annotations; migration preserves existing capture bytes and hash links.
- Network tests cover pinned DNS callback forms, mixed/private DNS rejection, credential exclusion, per-response and shared byte limits, compressed-response rejection, and stalled-request deadlines.
- Offline verifier coverage includes directory junction handling, subject to platform permissions.

These are tests of specific behaviors, not proof that every website or malicious input is safe.

## Validation checkpoint

Build, lint, and type checking passed. The full suite completed with 56 tests: 54 passed, zero failed, and two Windows symlink/junction cases skipped. `npm audit --audit-level=low` reported zero vulnerabilities. The accelerated soak completed 12 cycles in 28,291ms: 11 captures, one HTTP 403 capture failure, and five change events. It checked preserved older-capture inspection and unsaved notes, verified the 11-capture chain and offline ZIP, and reopened persisted storage. The machine-readable report is [soak-report.json](soak-report.json).

An accelerated cycle exercise is not a twelve-hour soak and does not establish overnight reliability. Earlier 1.1.0 clean-extraction setup and tests remain historical evidence for 1.1.0 only; a fresh-install test of 1.1.1 is not claimed here.

Chromium UI tests ran in the managed Windows environment. Firefox and Edge could not complete UI validation because browser launch was restricted. A sandbox-enabled Chromium launch also could not run there. Playwright Chromium's OS sandbox is disabled by default: contexts, intercepted requests, and the proxy are application controls, not OS isolation. Use an isolated VM for hostile pages. No Firefox/Edge pass, OS sandbox validation, public hosting suitability, or independent penetration test is claimed.

## Remaining gates

The 1.1.1 source ZIP and SHA-256 checksum were generated; archive entries were decompressed and checked for version and exclusion of runtime data, dependencies, browsers, and Git internals. Fresh-extraction setup for this patch remains optional and untested. Complete GitHub publication and hosted CI only when authenticated repository-creation access is available. See [RELEASE.md](RELEASE.md).


## Reproduce focused checks

```sh
npm run test:audit
npm run test:soak
```

These supplement `npm test`; the soak command runs accelerated cycles and is not a twelve-hour duration test. Screenshots were regenerated from the actual Chromium interface and the research workspace was visually inspected.
