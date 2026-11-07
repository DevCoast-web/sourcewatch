# SourceWatch native iPhone preview

This is a native SwiftUI iOS 17+ application, not a website or Home Screen shortcut. It does not need your desktop or a server while in use. No paid dependencies, account or analytics are built into SourceWatch.

## Free personal installation from Windows

The build produces **SourceWatch-iPhone-0.1.1-unsigned.ipa**. An unsigned IPA cannot install itself. Sign it for your own device using your own Apple ID with a compatible personal sideloading tool. SourceWatch never asks for your Apple password.

One documented option is **AltStore Classic / AltServer for Windows**:

1. Follow the official setup instructions: https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows
2. Connect and trust your iPhone, install AltStore Classic using AltServer, and enable Developer Mode if the device requests it.
3. Save the SourceWatch IPA in Files on your iPhone. Open AltStore Classic, choose My Apps → +, and select the IPA to sign/install it.
4. With a free Apple ID, apps expire after seven days and must be refreshed; see https://faq.altstore.io/altstore-classic/your-altstore. The computer is needed for this setup/renewal route, not for SourceWatch's offline research workflows between renewals.

Do not pay for random enterprise certificates or send anyone your Apple password. Follow the official tool documentation for your iOS version. Physical-device installation has not been verified by this project until explicitly recorded; compatibility with every device/tool is not promised. Free signing has Apple-imposed app/capability limits. Expiration does not provide a permanent independently installed app.

## Implemented preview scope

- Native source directory, collections and search, persisted with SwiftData (SQLite).
- User-imported text, Markdown, HTML, PDF and image artifacts; PDF selectable text extraction.
- Immutable revision folders, SHA-256 artifact checks and linked receipt histories.
- Added/deleted line comparison with bounded work; original text retained independently.
- Stored ZIP export and on-phone ZIP integrity/chain verification, with optional retained manifest checksum.
- Markdown note editing, explicit saves, saved note revisions, title-based `[[wikilinks]]`, backlinks and Markdown export.
- All work occurs in the app sandbox. Imported HTML is not executed, and URLs are references only.

Not yet implemented: direct rendered webpage capture, automated monitoring, Graph, Canvas, desktop database migration, note aliases/tags/link repair on rename, whole-library backup/restore, share extension, full desktop feature parity. Captures identify themselves as user-imported files or supplied text; no HTTP headers, final URLs or remote-response claims are fabricated. No accounts or network fetching are used in this preview. Saving a URL does not capture the page.

Export important sources and notes regularly. Deleting the app may delete its data; phone backups depend on iOS settings. The export format is **sourcewatch-mobile-evidence-v1**, distinct from desktop evidence bundles. Use `python scripts/verify-mobile.py bundle.zip` for independent verification. Desktop `verify.mjs` does not yet understand this mobile format.

## Reproducible build without owning a Mac

The public repository's **Native iPhone** GitHub workflow uses a hosted macOS runner to generate the Xcode project, run simulator tests, build a device app with signing disabled, and package the IPA. No signing secrets or paid developer membership are required for that build. GitHub account/runner usage policies still apply; no paid service has been subscribed to. Download its `sourcewatch-native-iphone-unsigned` artifact after a successful run.

On a Mac with Xcode and XcodeGen:

```sh
cd ios
xcodegen generate
xcodebuild -project SourceWatch.xcodeproj -scheme SourceWatch -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO test
```

Choose an installed simulator name. Personal device signing through Xcode is also available with a free Personal Team, with renewal restrictions: https://developer.apple.com/help/account/basics/about-your-developer-account.

Hashes demonstrate file consistency, not website authenticity, factual truth or independently certified timestamps. An attacker can replace the entire bundle and its manifest; retain the manifest checksum separately.
