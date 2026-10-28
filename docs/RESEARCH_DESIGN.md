# Linked research workspace design

Design reference review: 2026-10-28. This document proposes a bounded first implementation; it does not assert feature completion or passing tests. The references inform navigation and provenance design. SOURCEWATCH does not import their datasets, endorse allegations, or infer that a displayed relationship establishes wrongdoing.

## Reference findings

| Primary reference | Observed mechanism | SOURCEWATCH application |
| --- | --- | --- |
| [Obsidian Backlinks](https://obsidian.md/help/plugins/backlinks) | Incoming explicit links reveal notes referencing the current note; contextual mentions aid navigation. | Compute incoming relationships as backlinks and show their labels and linked evidence. Keep inferred name matches out of v1. |
| [Obsidian Graph view](https://obsidian.md/help/plugins/graph) | Notes and links form a navigable graph with filtering, grouping, and local neighborhoods. | Searchable graph plus an accessible relationship list; selecting a node opens its record. Type/tag filters reduce clutter. |
| [Obsidian Properties](https://obsidian.md/help/properties) | Structured metadata supports organization and search alongside note text. | A small fixed node type vocabulary, tags, title, body, timestamps, and explicit evidence references. Avoid a general schema engine in v1. |
| [Who Funded Genocide database](https://whofundedgenocide.com/) | Separate record categories, search/filter controls, entity-oriented records, source links, and downloads. | Entity/topic profiles with linked captures and focused filtering. Preserve distinct record types instead of collapsing unlike observations into a single score. |
| [Its network map](https://whofundedgenocide.com/map/) | Searchable entity/link navigation; selecting a record exposes citations. Link descriptions distinguish different relationships. Tables and graph data are downloadable. | Labeled directional edges, inspectable citations, and a JSON export of the user's graph. Graph placement conveys navigation, not confidence or causation. |
| [Its methodology page](https://whofundedgenocide.com/methodology.html) | Documents source provenance, matching limitations, omissions, and corrections. | Explain how user-authored relationships were entered and what capture references establish. Never silently merge people or organizations by name. |

The map reference explicitly separates systems where it has no joining document and distinguishes reported movement from approvals or other associations. The transferable principle is precise edge semantics and inspectable provenance, not importing its specific claims. The methodology distinguishes an observed transaction from beliefs or intent. Those are useful constraints for a neutral research tool. [Network-map explanation](https://whofundedgenocide.com/map/), [methodology](https://whofundedgenocide.com/methodology.html).

## First implementation scope

A research node has a stable ID, title, type (`topic`, `person`, `organization`, or `claim`), plain-text body, tags, and local creation/update timestamps. Nodes are researcher-authored records. A claim is a proposition to investigate; its type does not mark it true or verified.

Relationships are explicitly created and directional. Each stores its source and target node IDs, a human-readable label, and optional evidence capture reference. Example labels include “discusses”, “published by”, “supports”, “contradicts”, and “associated in document”; these remain assertions by the researcher. Do not automatically create relationships from co-occurrence, common names, or matching tags. Do not merge duplicate labels or names into identity claims.

Nodes can link to monitored sources and exact captures. A relationship's evidence capture should open that exact receipt, including its observation timestamp and retained artifacts. A current URL is useful context; a capture ID identifies the version actually cited. Show missing references honestly instead of substituting a newer capture. Reference validation ensures IDs exist; each cited capture retains its actual source identity rather than being relabeled as a different source. A researcher may cite another source as supporting context.

The workspace provides search by title/body/tags, filters by node type, a navigable graph, and an incoming/outgoing relationship list. Backlinks are derived from saved explicit edges. A text/list route must remain usable without relying on graph geometry, color, or precise pointer input. Keep bounded node/edge counts and predictable small-graph layout rather than promising large-scale network analysis.

Export the graph as versioned JSON containing nodes, relationships, source/capture references, and export time. This mutable research layer is separate from append-only captured evidence and its hash chain. Editing a node or relationship must not rewrite capture artifacts or imply the research history is immutable. A graph export is not an evidence ZIP; distribute evidence separately when recipients need independent file-integrity verification. Preserve stable IDs and document the export fields. JSON import, Obsidian vault synchronization, automatic entity extraction, inferred links, collaborative editing, and external dataset ingestion are outside this first scope.

## Optional tiled screenshots

Provide an explicit screenshot-mode setting for bounded tiled capture of tall pages. Exact tile size/count and archive representation depend on the implementation and must be documented after testing. Preserve text, rendered HTML, metadata, and honest warnings when screenshots are unavailable within resource limits. Do not label a text/HTML-only capture as having a complete screenshot. Each retained tile must be inventoried and checksummed for export/verification; viewers should expose order and coverage rather than imply a seamless full-page artifact. Tiling does not guarantee complete archival replay or lift capture time/area/resource bounds.

## Acceptance before release claims

Test node/relationship CRUD, invalid/dangling references, persistence across restart, incoming backlinks, search/filter behavior, exact capture navigation, graph/list accessibility and mobile overflow, hostile text rendered as inert data, and JSON export fidelity. Confirm graph edits leave existing evidence hashes unchanged. Exercise screenshot modes against a real tall fixture and test fallback behavior, saved tile manifests/checksums, export, and independent verification. Report actual outcomes before calling the feature implemented or release-ready.

## Implemented first pass

The 1.2.0 implementation follows the bounded scope above. Tiles are at most 8,192px high, at most 64 (524,288px), with a 64 MiB compressed-image budget and 25-second visual-capture budget inside the 45-second overall deadline. Tiles are sequential observations; dynamic content can change between images. No automatic scrolling to discover infinite or lazy-loaded content is performed. See [validation](VALIDATION-1.2.md).
