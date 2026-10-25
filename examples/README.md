# Example evidence

`fixture-evidence.zip` is a genuine export made by the browser integration test after capturing two versions of a changing local fixture. It includes real HTML, normalized text, screenshots, metadata, hashes, and the standalone verifier. The fixture is labeled test content and is not a historical claim about an external publisher. Production SOURCEWATCH blocks private-network URLs; tests inject a narrowly scoped transport.

Extract the ZIP to a new directory. Run a trusted verifier from the source repository:

```sh
node scripts/verify.mjs /path/to/extracted-fixture --expect HASH_FROM_fixture-manifest.sha256
```

`fixture-verification.json` records the successful standalone verifier result. The separately stored manifest fingerprint is `fixture-manifest.sha256`. Changing any artifact causes verification to fail. Checksums and local timestamps do not independently establish authenticity or publication time.

`public-evidence.zip`, when present, is an actual production-transport capture of https://example.com/. It is a single observation, not a changing fixture. Its verification result and separately retained manifest fingerprint are alongside it.

`research-evidence.zip` is a real 1.1 integration-test export of two changed fixture captures with researcher notes/tags. The supplemental `research-notes.json` is labeled editable research commentary, hashed by the export manifest, and kept separate from immutable capture metadata. `research-verification.json` and `research-manifest.sha256` record its successful standalone verification.
