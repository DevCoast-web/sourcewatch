import { verifyPreservedReference } from "./workspace-evidence.js";
import { zipSync } from "fflate";
import { parseWikiLinks } from "./vault.js";
import { createHash } from "node:crypto";
import { Store } from "./storage.js";
import { WorkspaceStore } from "./workspace-store.js";
export const intelligenceKinds = [
  "entity",
  "relationship",
  "investigation",
  "board",
  "correction",
] as const;
export type IntelligenceKind = (typeof intelligenceKinds)[number];
const classes = ["annotation", "hypothesis", "verified", "disputed"];
const txt = (v: any, n: number, required = false) => {
  if (typeof v !== "string" || v.length > n || (required && !v.trim()))
    throw new Error("Invalid text field");
  return v.trim();
};
const strings = (v: any, max = 100) => {
  if (
    !Array.isArray(v) ||
    v.length > max ||
    v.some((x) => typeof x !== "string" || x.length > 2000)
  )
    throw new Error("Invalid string list");
  return [...new Set(v)] as string[];
};
const csv = (rows: any[]) => {
  if (!rows.length) return "";
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const quote = (v: any) =>
    '"' +
    String(typeof v === "object" ? JSON.stringify(v) : (v ?? "")).replaceAll(
      '"',
      '""',
    ) +
    '"';
  return (
    keys.map(quote).join(",") +
    "\r\n" +
    rows.map((r) => keys.map((k) => quote(r[k])).join(",")).join("\r\n")
  );
};
export function parseCSV(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (!quoted && value) throw new Error("Malformed CSV quote");
      else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(value.replace(/\r$/, ""));
      value = "";
      if (c === "\n") {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else value += c;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  row.push(value.replace(/\r$/, ""));
  if (row.some(Boolean)) rows.push(row);
  const header = rows.shift() || [];
  if (
    new Set(header).size !== header.length ||
    header.some(
      (k) => !k || ["__proto__", "constructor", "prototype"].includes(k),
    )
  )
    throw new Error("Invalid CSV header");
  return rows.map((r, i) => {
    if (r.length !== header.length)
      throw new Error("CSV column count at row " + (i + 2));
    return Object.fromEntries(header.map((k, j) => [k, r[j]]));
  });
}
export function createIntelligence(store: Store, workspace: WorkspaceStore) {
  store.db.exec(
    `CREATE INDEX IF NOT EXISTS intel_from ON workspace_objects(kind,json_extract(data,'$.fromRef'),deletedAt);CREATE INDEX IF NOT EXISTS intel_to ON workspace_objects(kind,json_extract(data,'$.toRef'),deletedAt);CREATE INDEX IF NOT EXISTS intel_class ON workspace_objects(kind,json_extract(data,'$.classification'),deletedAt);`,
  );
  function kind(k: string): asserts k is IntelligenceKind {
    if (!(intelligenceKinds as readonly string[]).includes(k))
      throw new Error("Unknown intelligence kind");
  }
  const reference = (r: any) => {
    if (typeof r !== "string" || !workspace.resolveReference(r))
      throw new Error("Unresolved reference: " + String(r));
    return r as string;
  };
  function validate(k: string, input: any, reviewAllowed = false) {
    kind(k);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Record must be an object");
    const d = JSON.parse(JSON.stringify(input));
    delete d.id;
    delete d.revision;
    d.title = txt(d.title ?? (k === "relationship" ? d.type : ""), 200, true);
    d.tags = strings(d.tags || [], 50);
    d.body = txt(d.body || "", 100000);
    if (k === "entity") {
      d.type = txt(d.type || "organization", 100, true);
      d.aliases = strings(d.aliases || []);
      d.jurisdiction = txt(d.jurisdiction || "", 100);
      d.identifiers = d.identifiers || {};
      if (
        typeof d.identifiers !== "object" ||
        Array.isArray(d.identifiers) ||
        JSON.stringify(d.identifiers).length > 10000
      )
        throw new Error("Invalid identifiers");
      d.citations = d.citations || [];
      if (!Array.isArray(d.citations) || d.citations.length > 100)
        throw new Error("Invalid citations");
      d.citations = d.citations.map((c: any) => ({
        ...c,
        ref: reference(c.ref),
        section: txt(c.section || "", 500),
      }));
    }
    if (k === "relationship") {
      d.fromRef = reference(d.fromRef);
      d.toRef = reference(d.toRef);
      if (d.fromRef === d.toRef)
        throw new Error("Self relationships are not supported");
      d.type = txt(d.type, 100, true);
      d.classification = d.classification || "annotation";
      if (!classes.includes(d.classification))
        throw new Error("Invalid relationship classification");
      d.explanation = txt(d.explanation || "", 10000);
      d.creator = txt(d.creator || "Local researcher", 200, true);
      d.evidenceRefs = strings(d.evidenceRefs || []).map(reference);
      d.reviews = d.reviews || [];
      if (!Array.isArray(d.reviews) || d.reviews.length > 1000)
        throw new Error("Invalid review history");
      if (d.classification === "verified" && !reviewAllowed)
        throw new Error(
          "Use explicit evidence review to verify a relationship",
        );
      if (d.financial) {
        const f = d.financial;
        f.amount = f.amount ?? null;
        if (
          f.amount !== null &&
          (typeof f.amount !== "string" ||
            !/^\d+(\.\d+)?$/.test(f.amount) ||
            f.amount.length > 60)
        )
          throw new Error("Amount must be a decimal string or null");
        f.currency = txt(f.currency, 12, true).toUpperCase();
        f.category = txt(f.category, 100, true);
        if (
          ![
            "payment",
            "budget",
            "contract",
            "pledge",
            "estimate",
            "revenue",
            "independent-expenditure",
            "other",
          ].includes(f.category)
        )
          throw new Error("Unknown financial category");
      }
      for (const field of ["startDate", "endDate"])
        if (d[field] && !/^\d{4}-\d{2}-\d{2}$/.test(d[field]))
          throw new Error("Dates must use YYYY-MM-DD");
    }
    if (k === "investigation") {
      d.refs = strings(d.refs || []).map(reference);
      d.timeline = d.timeline || [];
      if (!Array.isArray(d.timeline) || d.timeline.length > 2000)
        throw new Error("Invalid timeline");
    }
    if (k === "board") {
      d.filters = d.filters || {};
      if (typeof d.filters !== "object" || Array.isArray(d.filters))
        throw new Error("Invalid board filters");
    }
    if (k === "correction") {
      d.targetRef = reference(d.targetRef);
      d.status = d.status || "proposed";
      if (!["proposed", "accepted", "rejected"].includes(d.status))
        throw new Error("Invalid correction status");
      d.evidenceRefs = strings(d.evidenceRefs || []).map(reference);
      if (d.status !== "proposed" && !reviewAllowed)
        throw new Error("Use correction review");
    }
    return d;
  }
  function save(k: string, data: any, id?: string, revision?: number) {
    kind(k);
    const old = id ? workspace.get(id, k) : undefined;
    if (id && !old) throw new Error("Record not found");
    const d = validate(k, data);
    if (old && k === "relationship") d.reviews = old.data.reviews || [];
    return workspace.put(k, d, id, revision);
  }
  function list(k: string, f: any = {}) {
    kind(k);
    const terms = ["kind=?", "deletedAt IS NULL"];
    const args: any[] = [k];
    for (const [key, path] of Object.entries({
      type: "type",
      classification: "classification",
      jurisdiction: "jurisdiction",
      currency: "financial.currency",
      category: "financial.category",
    }))
      if (f[key]) {
        terms.push("json_extract(data,'$." + path + "')=?");
        args.push(String(f[key]));
      }
    if (f.q) {
      terms.push("lower(data) LIKE ?");
      args.push("%" + String(f.q).toLowerCase().slice(0, 200) + "%");
    }
    if (f.tag) {
      terms.push(
        "EXISTS(SELECT 1 FROM json_each(data,'$.tags') WHERE value=?)",
      );
      args.push(f.tag);
    }
    if (f.after) {
      terms.push("json_extract(data,'$.startDate')>=?");
      args.push(f.after);
    }
    if (f.before) {
      terms.push("json_extract(data,'$.startDate')<=?");
      args.push(f.before);
    }
    const where = terms.join(" AND ");
    const total = (
      store.db
        .prepare("SELECT count(*) n FROM workspace_objects WHERE " + where)
        .get(...args) as any
    ).n;
    const limit = Math.min(500, Math.max(1, Number(f.limit) || 50));
    const offset = Math.max(0, Number(f.offset) || 0);
    const order =
      f.sort === "title"
        ? "json_extract(data,'$.title') COLLATE NOCASE"
        : "updatedAt DESC";
    const items = (
      store.db
        .prepare(
          "SELECT * FROM workspace_objects WHERE " +
            where +
            " ORDER BY " +
            order +
            ",id LIMIT ? OFFSET ?",
        )
        .all(...args, limit, offset) as any[]
    ).map((r) => ({ ...r, data: JSON.parse(r.data) }));
    return { items, total, limit, offset };
  }
  function review(id: string, input: any) {
    const row = workspace.get(id);
    if (!row || !["relationship", "correction"].includes(row.kind))
      throw new Error("Review target not found");
    const reviewer = txt(input.reviewer, 200, true),
      explanation = txt(input.explanation, 10000, true);
    const d = { ...row.data };
    const status = input.status;
    if (row.kind === "relationship") {
      if (!classes.includes(status)) throw new Error("Invalid review status");
      const refs = strings(input.evidenceRefs || d.evidenceRefs || []).map(
        reference,
      );
      if (
        status === "verified" &&
        !refs.some((r) => /^(capture|attachment):/.test(r))
      )
        throw new Error(
          "Verification requires a preserved capture or attachment",
        );
      if (status === "verified")
        for (const ref of refs.filter((r) => /^(capture|attachment):/.test(r)))
          verifyPreservedReference(workspace, ref);
      d.evidenceRefs = refs;
      d.classification = status;
      d.reviews = [
        ...(d.reviews || []),
        {
          reviewer,
          explanation,
          status,
          evidenceRefs: refs,
          at: new Date().toISOString(),
        },
      ];
    } else {
      if (!["accepted", "rejected"].includes(status))
        throw new Error("Invalid correction decision");
      d.status = status;
      d.review = { reviewer, explanation, at: new Date().toISOString() };
    }
    return workspace.put(
      row.kind,
      validate(row.kind, d, true),
      id,
      input.revision ?? row.revision,
    );
  }
  function graph(f: any = {}) {
    const relationships = list("relationship", { ...f, limit: 500 });
    let edges = relationships.items.map((r) => ({
      id: r.id,
      ref: "relationship:" + r.id,
      ...r.data,
    }));
    const maxNodes = Math.min(500, Math.max(1, Number(f.nodeLimit) || 500));
    const refs = new Set<string>();
    if (f.center) {
      reference(f.center);
      refs.add(f.center);
      const hops = Math.min(4, Math.max(1, Number(f.hops) || 1));
      for (let h = 0; h < hops; h++) {
        const existing = [...refs];
        if (!existing.length) break;
        const placeholders = existing.map(() => "?").join(",");
        const found = store.db
          .prepare(
            `SELECT * FROM workspace_objects WHERE kind='relationship' AND deletedAt IS NULL AND (json_extract(data,'$.fromRef') IN (${placeholders}) OR json_extract(data,'$.toRef') IN (${placeholders})) LIMIT 500`,
          )
          .all(...existing, ...existing) as any[];
        edges = found.map((r) => ({
          id: r.id,
          ref: "relationship:" + r.id,
          ...JSON.parse(r.data),
        }));
        for (const e of edges) {
          if (refs.size < maxNodes) refs.add(e.fromRef);
          if (refs.size < maxNodes) refs.add(e.toRef);
        }
      }
    } else {
      for (const e of edges) {
        if (refs.size < maxNodes) refs.add(e.fromRef);
        if (refs.size < maxNodes) refs.add(e.toRef);
      }
      for (const e of list("entity", {
        q: f.q,
        tag: f.tag,
        type: f.entityType,
        limit: maxNodes,
      }).items)
        if (refs.size < maxNodes) refs.add("entity:" + e.id);
    }

    if (
      f.knowledge !== "false" &&
      (!f.classification || f.classification === "annotation")
    ) {
      const notes = (
        store.db
          .prepare(
            "SELECT id,data FROM workspace_objects WHERE kind='note' AND deletedAt IS NULL LIMIT 1000",
          )
          .all() as any[]
      ).map((r) => ({ ...r, data: JSON.parse(r.data) }));
      const names = new Map<string, string[]>();
      for (const n of notes)
        for (const name of [n.data.title, ...(n.data.aliases || [])]) {
          const key = n.data.vaultId + ":" + String(name).toLowerCase();
          names.set(key, [...(names.get(key) || []), "note:" + n.id]);
        }
      const knowledgeEdges: any[] = [];
      for (const n of notes)
        for (const link of parseWikiLinks(n.data.body || "")) {
          const explicit = /^(note|entity|capture|source):/.test(link.target)
            ? link.target
            : undefined;
          const matches =
            names.get(n.data.vaultId + ":" + link.target.toLowerCase()) || [];
          const target =
            explicit || (matches.length === 1 ? matches[0] : undefined);
          if (target && workspace.resolveReference(target))
            knowledgeEdges.push({
              id: "wiki:" + n.id + ":" + link.start,
              ref: "note:" + n.id,
              fromRef: "note:" + n.id,
              toRef: target,
              type: "wikilink",
              classification: "annotation",
              evidenceRefs: [],
              explanation:
                "Explicit note link, not a verified factual relationship",
            });
        }
      const hasLegacy = store.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='research_edges'",
        )
        .get();
      if (hasLegacy)
        for (const e of store.db
          .prepare("SELECT * FROM research_edges LIMIT 500")
          .all() as any[])
          knowledgeEdges.push({
            id: "legacy:" + e.id,
            ref: "node:" + e.fromId,
            fromRef: "node:" + e.fromId,
            toRef: "node:" + e.toId,
            type: e.label,
            classification: "annotation",
            evidenceRefs: e.evidenceCaptureId
              ? ["capture:" + e.evidenceCaptureId]
              : [],
            explanation: "Legacy researcher link; not independently verified",
          });
      for (const e of knowledgeEdges) {
        if (edges.length >= 500) break;
        if (f.center && !refs.has(e.fromRef) && !refs.has(e.toRef)) continue;
        if (
          f.q &&
          !JSON.stringify(e).toLowerCase().includes(String(f.q).toLowerCase())
        )
          continue;
        if (refs.size < maxNodes) refs.add(e.fromRef);
        if (refs.size < maxNodes) refs.add(e.toRef);
        edges.push(e);
      }
    }
    edges = edges.filter(
      (e) =>
        refs.has(e.fromRef) &&
        refs.has(e.toRef) &&
        (!f.classification || e.classification === f.classification) &&
        (!f.type || e.type === f.type) &&
        (!f.tag || (e.tags || []).includes(f.tag)),
    );

    const nodes = [...refs]
      .map((ref) => workspace.resolveReference(ref))
      .filter(Boolean);
    const allNodes = (
      store.db
        .prepare(
          "SELECT count(*) n FROM workspace_objects WHERE kind='entity' AND deletedAt IS NULL",
        )
        .get() as any
    ).n;
    return {
      nodes,
      edges,
      totalEntities: allNodes,
      totalRelationships: relationships.total,
      truncated: allNodes > nodes.length || relationships.total > edges.length,
      displayLimit: maxNodes,
      edgeLimit: 500,
    };
  }
  function path(from: string, to: string) {
    reference(from);
    reference(to);
    const visited = new Set([from]);
    const queue = [{ ref: from, path: [] as string[] }];
    for (let i = 0; i < queue.length && i < 5000; i++) {
      const item = queue[i];
      if (item.ref === to)
        return { found: true, relationships: item.path, visited: visited.size };
      if (item.path.length >= 8) continue;
      const rows = store.db
        .prepare(
          "SELECT id,data FROM workspace_objects WHERE kind='relationship' AND deletedAt IS NULL AND (json_extract(data,'$.fromRef')=? OR json_extract(data,'$.toRef')=?) LIMIT 500",
        )
        .all(item.ref, item.ref) as any[];
      for (const r of rows) {
        const e = JSON.parse(r.data),
          next = e.fromRef === item.ref ? e.toRef : e.fromRef;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ ref: next, path: [...item.path, r.id] });
        }
      }
    }
    return {
      found: false,
      relationships: [],
      visited: visited.size,
      limit: 5000,
      maxDepth: 8,
    };
  }
  function importRecords(input: any) {
    kind(input.kind);
    if (
      typeof input.content !== "string" ||
      Buffer.byteLength(input.content) > 8 * 1024 * 1024
    )
      throw new Error("Import exceeds 8 MiB");
    let rows =
      input.format === "csv"
        ? parseCSV(input.content)
        : JSON.parse(input.content);
    if (!Array.isArray(rows)) rows = rows.items;
    if (!Array.isArray(rows) || rows.length > 25000)
      throw new Error("Expected up to 25000 records");
    const errors: any[] = [],
      warnings: any[] = [],
      valid: any[] = [];
    const seen = new Set<string>();
    rows.forEach((raw: any, i: number) => {
      try {
        const d = { ...(raw.data || raw) };
        for (const key of [
          "tags",
          "aliases",
          "citations",
          "identifiers",
          "evidenceRefs",
          "financial",
          "refs",
          "timeline",
          "filters",
        ])
          if (typeof d[key] === "string" && d[key].trim().match(/^[{[]/))
            d[key] = JSON.parse(d[key]);
        const normalized = validate(input.kind, d);
        const identity = normalized.title.toLowerCase();
        if (
          store.db
            .prepare(
              "SELECT id FROM workspace_objects WHERE kind=? AND deletedAt IS NULL AND lower(json_extract(data,'$.title'))=? LIMIT 1",
            )
            .get(input.kind, identity)
        )
          warnings.push({
            row: i + 1,
            message:
              "Existing title match; identity review required, not merged",
          });
        if (seen.has(identity))
          warnings.push({
            row: i + 1,
            message: "Duplicate title; kept separate, identity not merged",
          });
        seen.add(identity);
        valid.push({ row: i + 1, data: normalized });
      } catch (e) {
        errors.push({ row: i + 1, message: (e as Error).message });
      }
    });
    const accepted: any[] = [];
    if (!input.dryRun) {
      store.db.exec("SAVEPOINT intelligence_import");
      try {
        for (const v of valid) accepted.push(workspace.put(input.kind, v.data));
        workspace.audit("import:" + input.kind, "import", {
          accepted: accepted.length,
          rejected: errors.length,
        });
        store.db.exec("RELEASE intelligence_import");
      } catch (e) {
        store.db.exec(
          "ROLLBACK TO intelligence_import;RELEASE intelligence_import",
        );
        throw e;
      }
    }
    return {
      accepted: input.dryRun ? valid.length : accepted.length,
      rejected: errors.length,
      errors,
      warnings,
      dryRun: !!input.dryRun,
      items: accepted,
    };
  }
  function exportRecords(format = "json") {
    const records = intelligenceKinds.flatMap((k) => workspace.list(k));
    if (Buffer.byteLength(JSON.stringify(records)) > 64 * 1024 * 1024)
      throw new Error("Research export exceeds 64 MiB context limit");
    const entities = records
      .filter((r) => r.kind === "entity")
      .map((r) => ({ id: r.id, ...r.data }));
    const edges = records
      .filter((r) => r.kind === "relationship")
      .map((r) => ({
        id: r.id,
        Source: r.data.fromRef,
        Target: r.data.toRef,
        Type: "Directed",
        ...r.data,
      }));
    const payload = {
      format: "sourcewatch-intelligence-v1",
      exportedAt: new Date().toISOString(),
      notice:
        "Mutable researcher context; verification classification is a local review, not independent certification. Check original cited evidence. No redistribution license is assumed.",
      records,
    };
    if (format === "csv")
      return {
        type: "text/csv",
        name: "entities.csv",
        bytes: Buffer.from(csv(entities)),
      };
    if (format === "gephi")
      return {
        type: "text/csv",
        name: "edges.csv",
        bytes: Buffer.from(csv(edges)),
      };
    if (format === "cytoscape")
      return {
        type: "application/json",
        name: "cytoscape.json",
        bytes: Buffer.from(
          JSON.stringify(
            {
              elements: {
                nodes: entities.map((e) => ({
                  data: { ...e, id: "entity:" + e.id },
                })),
                edges: edges.map((e) => ({
                  data: { ...e, source: e.Source, target: e.Target },
                })),
              },
            },
            null,
            2,
          ),
        ),
      };
    if (format === "zip") {
      const files: Record<string, Uint8Array> = {
        "research.json": Buffer.from(JSON.stringify(payload, null, 2)),
        "entities.csv": Buffer.from(csv(entities)),
        "relationships.csv": Buffer.from(csv(edges)),
        "sources.csv": Buffer.from(csv(store.sources(true))),
        "README.txt": Buffer.from(
          payload.notice +
            "\nResearch references do not contain the original evidence files. Export original capture evidence separately.\nVerify with: node verify.mjs .\n",
        ),
      };
      const hash = (b: Uint8Array) =>
        createHash("sha256").update(b).digest("hex");
      const verifier =
        "import{readFileSync}from'node:fs';import{join,resolve}from'node:path';import{createHash}from'node:crypto';const root=resolve(process.argv[2]||'.');const m=JSON.parse(readFileSync(join(root,'checksums.json')));let bad=false;for(const[n,h]of Object.entries(m)){if(!/^[A-Za-z.-]+$/.test(n))throw Error('Unsafe path');try{if(createHash('sha256').update(readFileSync(join(root,n))).digest('hex')!==h){console.error('MODIFIED',n);bad=true}}catch{console.error('MISSING',n);bad=true}}process.exitCode=bad?1:0;console.log(bad?'FAILED':'OK');";
      files["verify.mjs"] = Buffer.from(verifier);
      files["checksums.json"] = Buffer.from(
        JSON.stringify(
          Object.fromEntries(
            Object.entries(files).map(([n, b]) => [n, hash(b)]),
          ),
          null,
          2,
        ),
      );
      return {
        type: "application/zip",
        name: "research.zip",
        bytes: Buffer.from(zipSync(files)),
      };
    }
    return {
      type: "application/json",
      name: "research.json",
      bytes: Buffer.from(JSON.stringify(payload, null, 2)),
    };
  }
  return {
    save,
    list,
    review,
    graph,
    path,
    importRecords,
    exportRecords,
    get: (id: string) => {
      const row = workspace.get(id);
      if (row) kind(row.kind);
      return row;
    },
    remove: (id: string, revision?: number) => {
      const row = workspace.get(id);
      if (!row) throw new Error("Record not found");
      kind(row.kind);
      return workspace.remove(id, revision);
    },
    history: (id: string) => {
      const row = workspace.get(id, undefined, true);
      if (!row) throw new Error("Record not found");
      kind(row.kind);
      return workspace.history(id);
    },
    audit: () => workspace.auditEvents(),
  };
}
export type Intelligence = ReturnType<typeof createIntelligence>;
