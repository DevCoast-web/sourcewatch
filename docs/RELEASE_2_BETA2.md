# Aperture Eye rebuilt downloads

Release: [v2.0.0-beta.2](https://github.com/DevCoast-web/sourcewatch/releases/tag/v2.0.0-beta.2). Build source: `d809d52139e1805e419ac5d4f3899781d3c3eecd`. Windows version: **2.0.0-beta.2**. Native iPhone version: **0.1.1**, iOS 17+.

Both platforms are rebuilt from the same tag, with the selected Aperture Eye icon. The earlier beta.1 download files are retained unchanged. No additional mobile feature parity is claimed.

## Passed checks

- [Source CI](https://github.com/DevCoast-web/sourcewatch/actions/runs/42322118552): lint, typecheck, build, regression tests and dependency audit.
- [Windows desktop](https://github.com/DevCoast-web/sourcewatch/actions/runs/42322123573): installer/portable build, isolated packaged-app workflow, note save/restart and portable extraction/startup checks.
- [Native iPhone](https://github.com/DevCoast-web/sourcewatch/actions/runs/42322118336): eight XCTest core tests, one native UI workflow, eight Python verifier tests, verification of a Swift-produced evidence ZIP, and an unsigned ARM64 device build.
- Downloaded binaries checked against build/published checksums. Both Windows EXEs report product version `2.0.0-beta.2`. The IPA reports `0.1.1`, iPhoneOS/ARM64 and the app-icon asset. The actual embedded installer and iPhone icons were inspected as Aperture Eye.
- Tagged source ZIP checked for integrity, matching platform logo assets and absence of local research/development-data directories.

The release includes `SHA256SUMS.txt` and `BUILD-INFO.json`. File hashes demonstrate consistency, not website authenticity or independently certified timestamps.

## Installation limits

Windows builds remain unsigned. The iPhone IPA requires personal signing; physical installation/renewal on the user's phone has not been verified. The documented free Windows/AltStore Classic route requires periodic renewal. No TestFlight, paid Apple membership or paid runtime service is added by this build. Do not disable security protections.

The native preview still preserves imported files/pasted text and provides notes, revision comparisons, exports and verification. Direct website fetching, monitoring, Graph/Canvas and desktop database migration are not implemented on iOS. See [native setup and scope](../ios/INSTALL.md).
