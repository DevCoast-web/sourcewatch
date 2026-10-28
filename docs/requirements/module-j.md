# Module J integration and acceptance map

Module J extends the existing SourceWatch engine and remains additional to Module C's automated intelligence graph. Both use the same local SQLite reference registry; neither is a separate application. The user-provided master and network directives are preserved alongside this file.

| Requirement | Implemented behavior | Acceptance evidence | Remaining scope |
| --- | --- | --- | --- |
| J1 Infinite visual canvas | Multiple persistent canvases; movable/resizable/duplicated/deleted cards; labeled/color/directed edges; groups; multiselect/alignment/grid; pan/zoom; session undo/redo; autosave/CAS; nested references; text/note/source/image/PDF/audio/video cards | Canvas engine/API and real browser tests; local PDF worker test | Bounded documents; full open-ended media interoperability and exported PDF/video pixels incomplete; web previews show safe metadata rather than arbitrary active sites |
| J2 Linked knowledge vault | Markdown, wikilinks/aliases/headings, incoming/outgoing/unlinked mentions, tags/properties/search, stable references, independent history, Markdown exports | Vault engine/API/browser tests, composer rollback tests, restart journey | Advanced editor/transclusion/math/YAML and external filesystem watching incomplete |
| J3 Global/local graphs | Separate automated network explorer, configurable bounded hops, type/status/query filters, selected records, paths and saved graph boards; canvas remains manually arranged | Intelligence engine/browser tests and 10k/12k backend benchmark | Advanced community highlighting and some category/date/tag filter combinations remain incomplete; manually arranged graph boards are not full force-layout parity |
| J4 Researcher connections | Annotation/hypothesis lines retain creator/time/explanation; bridge creates a hypothesis; verified local review requires explicit reviewer/explanation and intact preserved evidence; reviews/revisions retained; styling differs | Workspace proposal/tamper tests; integrated browser review journey | Researcher identity is user-entered, not authenticated certification; integrity is checked at review/export, not continuous attestation |
| J5 Interoperability | Markdown/metadata import/export; compatible JSON Canvas roundtrip; stable references; placement deletion does not delete records; SVG/PNG graph/canvas exports; workspace ZIP | Canvas roundtrip/browser Blob tests; independent ZIP verifier and tamper/missing/unexpected-file tests | Full foreign attachment/path roundtrip and backup restore imports incomplete; image exports reflect current view and have embedded-media limitations |
| J6 Unified investigation | Find entity, inspect neighborhood, add to canvas, attach notes/evidence, propose hypothesis, explicitly review, restart and restore, export relationship references/metadata | `tests/workspace-journey.test.ts` plus vault backlinks, PDF and independent verifier tests | Remaining J1–J5 gaps and cross-browser/hardware acceptance prevent claiming the complete module is finished |

## Development sequence

1. Preserve the working capture → compare → export → verify baseline and private-network protections.
2. Add shared versioned records and stable references without mutating capture evidence.
3. Implement vault, canvas and database/network independently, with module-specific validators and revision tests.
4. Connect them through navigation, evidence attachments, hypotheses and explicit review.
5. Validate real browser edits, conflicts, restarts, exported bytes and standalone verification.
6. Continue remaining parity work using `../feature-parity.json`; do not present partial implementations as full Obsidian or master-directive completion.

The current feature branch reaches steps 1–5 for the tested subset. Step 6 remains active development work, not an implicit authorization to deploy, publish or transmit research data.
