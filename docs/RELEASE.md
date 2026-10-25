# Release status and publication

Status: **not published**. SOURCEWATCH has a dedicated local repository. No GitHub remote repository or tagged public release has been created by this build session. Local checks and artifacts must be distinguished from hosted CI results.

The GitHub connector was authenticated as `DevCoast-web` but did not expose repository creation. The `gh` CLI was absent, and opening GitHub's new-repository page led to sign-in. These are actual publication blockers, not a request for a new implementation decision. Existing unrelated repositories must not be used for this project.

## Release gates

From the repository root, execute:

```sh
npm ci
npx playwright install chromium
npm run lint
npm run typecheck
npm run build
npm test
npm audit --audit-level=moderate
```

On Linux use `npx playwright install --with-deps chromium`. Review all output, real desktop/mobile screenshots, saved capture artifacts, and an independently verified evidence export before tagging. A configured Actions workflow is not a completed remote run. Consult the final build handoff for results actually executed; this document does not assert that pending checks passed.

Use a trusted verifier from the source checkout for evidence supplied by another party:

```sh
node scripts/verify.mjs /path/to/extracted-evidence --expect SEPARATELY_RETAINED_MANIFEST_SHA256
```

## Publish when authentication and tooling are available

Install the official GitHub CLI and authenticate with an account authorized to create the new `sourcewatch` repository. From this repository's root, after all release gates pass and the release candidate is committed:

```sh
git status --short
gh auth login
gh repo create sourcewatch --public --source=. --remote=origin --push
gh run list
```

Review the actual GitHub Actions run and resolve failures before the release. If the repository already exists, inspect its ownership and contents, then configure its verified URL as `origin` rather than creating another repository or overwriting an unrelated remote.

After local checks and hosted CI pass, publish a tag and attach the packaged source archive and checksum manifest. The archive is prepared beside the repository in `../sourcewatch-v1.0.0.zip`; its checksum file is `../sourcewatch-v1.0.0.sha256`:

```sh
git tag -a v1.0.0 -m "SOURCEWATCH v1.0.0"
git push origin v1.0.0
gh release create v1.0.0 ../sourcewatch-v1.0.0.zip ../sourcewatch-v1.0.0.sha256 --title "SOURCEWATCH v1.0.0" --generate-notes
```

Verify the supplied checksum before uploading. Do not include local databases, personal captures, installed browsers, or node_modules in a release package. Publication commands are documented recovery steps; they have not been executed here.
