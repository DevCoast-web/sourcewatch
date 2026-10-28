# Global Graph implementation audit — 2.0.0-alpha.2

## Finding

Before this change SourceWatch had a bounded Network explorer, not a functional Obsidian-style Global Graph. `intelligence.graph()` capped displayed nodes/edges at 500, concentrated on entity/relationship records, and `ui/intelligence.tsx` placed nodes around a circle. There was no continuously refreshed whole-ecosystem index, force simulation, global category styling or cluster navigation. Existing database forms, local Network explorer and editable Canvas were retained.

Obsidian's documented reference behavior includes whole-vault notes/links, degree-based node sizes, selection, zoom/pan, orphan visibility, group colors, adjustable forces, and a depth-controlled local graph: https://obsidian.md/help/plugins/graph . SourceWatch now supplies the analogous research navigation without claiming full Obsidian parity.

## Real dataset audit

The default local `data/sourcewatch.sqlite` was opened read-only. Its aggregate counts matched the running service's catalog (one source, one capture, one vault). No research titles, URLs, artifacts or personal contents were copied into this report.

| Metric | Observed |
| --- | ---: |
| Eligible indexed records | 2 |
| Indexed entities | 0 |
| Stored links | 1 |
| Orphaned nodes | 0 |
| Excluded records | 1 |
| Unresolved stored references | 0 |

The link is source-to-preserved-capture membership, not an invented factual association. The excluded record is vault configuration. This dataset is too small to resemble a mature research network. `GLOBAL_GRAPH_DATA_AUDIT.json` records the aggregate audit. No demonstration nodes or relationships were inserted into this database.

## Implemented components

- **Global Graph** is a dashboard button, a workspace tab and a command-palette destination. The separate original Network view and Canvas continue to work.
- `src/ecosystem.ts` derives nodes from nondeleted notes, attachments/documents, monitored sources, captures/evidence, entities, investigations, relationship records, canvases, boards, corrections and legacy research nodes. Configuration, preferences and deleted records are excluded and counted.
- Edges derive from actual wikilinks (including aliases, UUIDs, folders and headings), matched source hyperlinks, explicit references, evidence citations, relationship endpoints, investigations/timelines, canvas placements/annotations and legacy links. Hyperlinks, citations, annotations, reviewed associations and membership have distinct categories. Canvas hypotheses remain annotations even when the corresponding authoritative database relationship is reviewed.
- The API detects connection-local writes and external SQLite changes, rebuilding its cached index when needed. An open graph polls every two seconds. No manual graph reconstruction is needed. Deletions remove indexed records; missing/ambiguous references are counted rather than guessed.
- Canvas 2D draws the ecosystem; a bundled worker runs link springs, spatial-grid repulsion and cluster-centering forces. This is a real dynamic simulation, not a fixed circular diagram. Work settles after 180 ticks and reheats for graph changes or dragging. Repulsion samples bounded local neighbors rather than all-pairs work.
- Nodes use category colors and per-category size multipliers, with additional degree-based hub sizing. Colors/sizes persist locally. Pan, pointer-centered wheel zoom, buttons, keyboard panning and fit operate independently of record inspection.
- Global Ecosystem, Local Network (one to eight undirected hops) and Investigation Network perspectives share the index. Search, category/link filters, isolated-node visibility, cluster collapse/expansion and cluster focusing are available. Connected components are split into bounded connected neighborhoods when large; these clusters are navigation aids, not asserted social or factual communities.
- Node selection shows the corresponding stored record and known links in an inspector. Full record navigation reuses the existing editors/evidence inspector. Graph state remains mounted during workspace navigation; selection, viewport and filter context have session recovery when leaving/reopening the workspace.
- Investigations retain references and independently saved graph coordinates/viewport with revision conflicts. They can open a persistent investigation canvas using the existing editable cards, evidence references and annotation tools. Canvas conversion is bounded to 1,000 records; existing investigation canvases are reused, not silently overwritten.

## Populated demonstration

Select **Demonstration dataset** in Global Graph, or use `/?workspace=graph&demo=1`. It supplies 10,000 synthetic mixed-category records and 12,000 explicitly synthetic links in memory, including hubs and inter-cluster connections. Demo data is visibly labeled and never written to the research database. No synthetic association is labeled verified. The separate preview service on port 3211 uses `work/global-graph-preview` rather than production data.

## Verification and performance

Production build/TypeScript and ESLint passed. The full regression suite passed **102 tests: 99 passed, 0 failed, 3 Windows symlink/junction privilege skips**. A subsequent 16-test browser/integration run passed after context/focus refinements. Browser tests exercise discoverability, selected records and links, automatic updates after writes, local depth, cluster collapse/focus/expand, return from a record, all 10,000 nodes/12,000 edges, search, export-independent layout persistence and the existing investigation journey. Tests use isolated databases.

`global-graph-browser-benchmark.json` contains measured real Chromium renderer/search results from the latest run; these are local measurements, not cross-device guarantees. The test waits for the worker's complete 180 ticks, verifies 10,000 visible nodes and 12,000 edges, searches a record near the end of the index, and asserts no database writes from demo mode.

`npm run benchmark:global-graph` independently seeds a temporary SQLite database with 10,000 stored notes and 12,000 real wikilinks, then runs the actual indexer and force code. The measured index took **483 ms**, force preparation **46 ms**, and 20 force iterations **350 ms**, with approximately **172 MiB** process RSS. Its entire graph was returned (no 500-node truncation); see `global-graph-index-benchmark.json`. This fixture database is removed afterward.

## Limits

This is not an unlimited graph or a full Obsidian clone. Safety ceilings are 100,000 indexed nodes and 250,000 edges, with an explicit truncation flag. Performance is validated at 10,000/12,000, not guaranteed at those ceilings. Search filters the rendered subset; the accessible result list shows the first 100 matches and search can reach any indexed node. The center dropdown lists up to 12,000 choices; larger indexes can select a center through node search. Relationship lists show the first 100 entries while the graph retains the indexed edges. Local depth is a graph-distance view, not proof of causality or identity. Clustering is topological neighborhood grouping, not a validated community-detection finding.

The force engine uses bounded spatial sampling; arbitrary force equations and GPU rendering are not implemented. Indexes are derived on demand and refreshed within about two seconds, rather than maintained by a separate background indexing daemon. Browser/mobile hardware beyond Chromium remains pending. Reviewed status means a local explicit evidence review; hashes and graph appearance do not certify authenticity, factual truth or independent publication timestamps.

## Running the updated application

An already running backend must restart to register the new routes. Stop it with Ctrl+C, then from the dedicated sourcewatch folder run `npm.cmd run build` and `npm.cmd start`. The UI shows restart guidance when backend/frontend versions differ. The existing service on port 3210 was not killed during this audit.
