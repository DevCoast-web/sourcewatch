import { randomUUID, createHash } from "node:crypto";
import {
  mkdirSync,
  lstatSync,
  existsSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import {
  WorkspaceStore,
  workspaceId,
  type WorkspaceObject,
} from "./workspace-store.js";
export type NoteData = {
  title: string;
  body: string;
  aliases: string[];
  tags: string[];
  properties: Record<string, unknown>;
  vaultId: string;
  folder: string;
  refs: string[];
};
export type WikiLink = {
  raw: string;
  target: string;
  label: string;
  heading: string;
  embed: boolean;
  start: number;
  end: number;
};
export type ResolvedWikiLink = WikiLink & {
  targetRef: string | null;
  status: "resolved" | "unresolved" | "ambiguous";
};
export function parseWikiLinks(body: string): WikiLink[] {
  const masked = body.replace(/```[^]*?```|~~~[^]*?~~~|`[^`\n]*`/g, (match) =>
    " ".repeat(match.length),
  );
  return [...masked.matchAll(/(!?)\[\[([^\]\n]{1,500})\]\]/g)].map((match) => {
    const [destination, label] = match[2].split("|", 2),
      hash = destination.indexOf("#");
    const target = (hash < 0 ? destination : destination.slice(0, hash)).trim(),
      heading = hash < 0 ? "" : destination.slice(hash + 1).trim();
    return {
      raw: body.slice(match.index!, match.index! + match[0].length),
      target,
      label: label?.trim() || destination.trim(),
      heading,
      embed: !!match[1],
      start: match.index!,
      end: match.index! + match[0].length,
    };
  });
}
function object(input: unknown): Record<string, any> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(input))
  )
    throw new Error("Expected plain object");
  for (const key of Reflect.ownKeys(input))
    if (
      typeof key !== "string" ||
      ["__proto__", "constructor", "prototype"].includes(key) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key)!, "value")
    )
      throw new Error("Unsafe object field");
  return input as Record<string, any>;
}
function text(value: unknown, name: string, max = 120, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error(`Invalid ${name} (maximum ${max} characters)`);
  return required ? value.trim() : value;
}
function strings(value: unknown, name: string, max = 40, length = 80) {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`Invalid ${name}`);
  return [...new Set(value.map((v) => text(v, name, length, true)))];
}
function safeFolder(value: unknown) {
  const folder = text(value, "folder", 240).trim();
  if (
    folder &&
    (!/^[^\\:]+$/.test(folder) ||
      [...folder].some((character) => character.charCodeAt(0) < 32) ||
      folder.startsWith("/") ||
      folder.split("/").some((p) => !p || p === "." || p === ".."))
  )
    throw new Error("Invalid folder path");
  return folder;
}
export function noteOutline(body: string) {
  let offset = 0;
  const result: Array<{
    level: number;
    text: string;
    id: string;
    offset: number;
  }> = [];
  let fence = "";
  for (const line of body.split("\n")) {
    const mark = /^\s*(```|~~~)/.exec(line);
    if (mark) fence = fence ? "" : mark[1];
    if (!fence) {
      const h = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
      if (h)
        result.push({
          level: h[1].length,
          text: h[2],
          id: `heading-${result.length}`,
          offset,
        });
    }
    offset += line.length + 1;
  }
  return result;
}
export function createVault(workspace: WorkspaceStore) {
  const notes = () => workspace.list<NoteData>("note");
  function directory(trash = false) {
    let dir = workspace.root;
    for (const segment of [
      "workspace",
      "notes",
      ...(trash ? [".trash"] : []),
    ]) {
      dir = join(dir, segment);
      if (existsSync(dir)) {
        const stat = lstatSync(dir);
        if (stat.isSymbolicLink() || !stat.isDirectory())
          throw new Error("Unsafe Markdown mirror directory");
      } else mkdirSync(dir);
    }
    return dir;
  }
  function markdown(row: WorkspaceObject<NoteData>) {
    return `---\nsourcewatch: ${JSON.stringify({ id: row.id, revision: row.revision, ...row.data, body: undefined, createdAt: row.createdAt, updatedAt: row.updatedAt })}\n---\n${row.data.body}`;
  }
  function mirror(row: WorkspaceObject<NoteData>) {
    const dir = directory(!!row.deletedAt),
      target = join(dir, `${row.id}.md`),
      temporary = join(dir, `.${row.id}.${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, markdown(row), { flag: "wx" });
      renameSync(temporary, target);
      if (row.deletedAt) {
        const active = join(directory(), `${row.id}.md`);
        if (existsSync(active)) unlinkSync(active);
      }
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  function getNote(id: string, deleted = false) {
    const row = workspace.get<NoteData>(id, "note", deleted);
    if (!row)
      throw Object.assign(new Error("Note not found"), { statusCode: 404 });
    return row;
  }
  function saveVault(input: unknown, id?: string, expectedRevision?: number) {
    const data = object(input);
    return workspace.put(
      "vault",
      {
        title: text(data.title, "vault title", 120, true),
        dailyFolder: safeFolder(data.dailyFolder ?? "Daily"),
        dailyFormat: text(data.dailyFormat ?? "YYYY-MM-DD", "daily format", 80),
        dailyTemplateId: data.dailyTemplateId
          ? text(data.dailyTemplateId, "template identifier", 36)
          : null,
      },
      id,
      expectedRevision,
    );
  }
  function defaultVault() {
    return workspace.list("vault")[0] || saveVault({ title: "Local vault" });
  }
  function normalize(
    input: unknown,
    previous?: WorkspaceObject<NoteData>,
  ): NoteData {
    const data = object(input),
      title = text(data.title, "note title", 120, true),
      body = text(data.body ?? "", "note body", 500000),
      folder = safeFolder(data.folder ?? "");
    const vaultId = data.vaultId ?? previous?.data.vaultId ?? defaultVault().id;
    if (!workspace.get(vaultId, "vault")) throw new Error("Vault not found");
    let aliases = strings(data.aliases ?? [], "aliases", 20, 120);
    if (
      previous &&
      previous.data.title !== title &&
      !aliases.includes(previous.data.title)
    )
      aliases = [...aliases, previous.data.title];
    if (aliases.length > 20)
      throw new Error(
        "Rename requires room for the previous title among 20 aliases",
      );
    const properties = object(data.properties ?? {});
    if (Object.keys(properties).length > 50)
      throw new Error("Maximum 50 properties");
    for (const [key, value] of Object.entries(properties)) {
      text(key, "property name", 80, true);
      const values = Array.isArray(value) ? value : [value];
      if (
        values.length > 100 ||
        values.some(
          (v) =>
            v !== null &&
            typeof v !== "string" &&
            typeof v !== "number" &&
            typeof v !== "boolean",
        ) ||
        values.some((v) => typeof v === "number" && !Number.isFinite(v)) ||
        values.some((v) => typeof v === "string" && v.length > 2000)
      )
        throw new Error(
          "Properties support finite numbers, booleans, strings, null and scalar lists",
        );
    }
    const refs = strings(data.refs ?? [], "references", 200, 100);
    for (const ref of refs)
      if (!workspace.resolveReference(ref))
        throw new Error(`Reference not found: ${ref}`);
    return {
      title,
      body,
      folder,
      vaultId,
      aliases,
      tags: strings(data.tags ?? [], "tags"),
      properties,
      refs,
    };
  }
  function saveNote(input: unknown, id?: string, expectedRevision?: number) {
    directory();
    const previous = id ? getNote(id) : undefined;
    const data = normalize(input, previous);
    const row = workspace.put("note", data, id, expectedRevision);
    try {
      mirror(row);
      return row;
    } catch (error) {
      return {
        ...row,
        mirrorWarning: `Note saved in SQLite; Markdown mirror could not be updated: ${(error as Error).message}`,
      };
    }
  }
  function removeNote(id: string, expectedRevision?: number) {
    directory(true);
    getNote(id);
    const row = workspace.remove(
      id,
      expectedRevision,
    ) as WorkspaceObject<NoteData>;
    mirror(row);
    return row;
  }
  function restoreNote(
    id: string,
    revision: number,
    expectedRevision?: number,
  ) {
    directory();
    getNote(id, true);
    const previous = workspace
      .history(id)
      .find((row) => row.revision === revision && !row.deletedAt);
    if (!previous) throw new Error("Active note revision not found");
    const row = workspace.put(
      "note",
      normalize(previous.data),
      id,
      expectedRevision,
    );
    mirror(row);
    return row;
  }
  function resolveLink(
    link: WikiLink,
    note: WorkspaceObject<NoteData>,
  ): ResolvedWikiLink {
    const target = link.target;
    let matches: WorkspaceObject<NoteData>[] = [];
    if (!target) matches = [note];
    else if (target.startsWith("note:") || Boolean(workspaceId(target))) {
      const row = workspace.get<NoteData>(target.replace(/^note:/, ""), "note");
      if (row) matches = [row];
    } else if (/^[a-z]+:/.test(target)) {
      const ref = workspace.resolveReference(target);
      return {
        ...link,
        targetRef: ref?.ref || null,
        status: ref ? "resolved" : "unresolved",
      };
    } else {
      const normalized = target.replace(/\.md$/i, "").toLocaleLowerCase();
      matches = notes().filter(
        (row) =>
          row.data.vaultId === note.data.vaultId &&
          [
            row.data.title,
            ...row.data.aliases,
            ...(row.data.folder
              ? [`${row.data.folder}/${row.data.title}`]
              : []),
          ].some((name) => name.toLocaleLowerCase() === normalized),
      );
    }
    return {
      ...link,
      targetRef: matches.length === 1 ? `note:${matches[0].id}` : null,
      status:
        matches.length === 1
          ? "resolved"
          : matches.length
            ? "ambiguous"
            : "unresolved",
    };
  }
  function links(id: string) {
    const row = getNote(id);
    return parseWikiLinks(row.data.body).map((link) => resolveLink(link, row));
  }
  function detail(id: string) {
    const note = getNote(id),
      outgoing = links(id),
      backlinks: Array<{ ref: string; title: string; excerpt: string }> = [],
      unlinkedMentions: typeof backlinks = [];
    for (const other of notes()) {
      if (other.id === id) continue;
      const found = links(other.id).find(
        (link) => link.targetRef === `note:${id}`,
      );
      if (found)
        backlinks.push({
          ref: `note:${other.id}`,
          title: other.data.title,
          excerpt: other.data.body.slice(
            Math.max(0, found.start - 70),
            found.end + 90,
          ),
        });
      else if (
        other.data.vaultId === note.data.vaultId &&
        [note.data.title, ...note.data.aliases].some(
          (name) =>
            name.length >= 3 &&
            other.data.body
              .toLocaleLowerCase()
              .includes(name.toLocaleLowerCase()),
        )
      )
        unlinkedMentions.push({
          ref: `note:${other.id}`,
          title: other.data.title,
          excerpt: other.data.body.slice(0, 180),
        });
    }
    const externalLinks = [
      ...note.data.body.matchAll(/\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g),
    ].map((match) => match[1]);
    return {
      note,
      outgoing,
      externalLinks,
      backlinks,
      unlinkedMentions,
      outline: noteOutline(note.data.body),
      counts: {
        words: (note.data.body.match(/[\p{L}\p{N}_]+/gu) || []).length,
        characters: note.data.body.length,
      },
    };
  }
  function listNotes(
    query = "",
    options: { vaultId?: string; includeDeleted?: boolean } = {},
  ) {
    if (typeof query !== "string" || query.length > 1000)
      throw new Error("Invalid note search");
    const rows = workspace.list<NoteData>("note", {
      includeDeleted: options.includeDeleted,
    });
    const groups = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const match = (row: WorkspaceObject<NoteData>, raw: string) => {
      const negate = raw.startsWith("-"),
        term = (negate ? raw.slice(1) : raw)
          .replace(/"/g, "")
          .toLocaleLowerCase(),
        data = row.data;
      let yes: boolean;
      if (term.startsWith("tag:"))
        yes = data.tags.some(
          (tag) => tag.toLocaleLowerCase() === term.slice(4),
        );
      else if (term.startsWith("folder:") || term.startsWith("path:"))
        yes = data.folder
          .toLocaleLowerCase()
          .startsWith(term.slice(term.indexOf(":") + 1));
      else if (term.startsWith("property:")) {
        const [key, ...value] = term.slice(9).split("=");
        yes =
          Object.hasOwn(data.properties, key) &&
          (!value.length ||
            String(data.properties[key]).toLocaleLowerCase() ===
              value.join("="));
      } else if (term.startsWith("after:"))
        yes = row.updatedAt.slice(0, 10) >= term.slice(6);
      else if (term.startsWith("before:"))
        yes = row.updatedAt.slice(0, 10) <= term.slice(7);
      else if (term.startsWith("type:"))
        yes = ["note", "md", "markdown"].includes(term.slice(5));
      else
        yes = [data.title, data.body, ...data.aliases, ...data.tags]
          .join("\n")
          .toLocaleLowerCase()
          .includes(term);
      return negate ? !yes : yes;
    };
    const alternatives: Array<string[]> = [[]];
    for (const token of groups) {
      if (token === "OR") alternatives.push([]);
      else alternatives.at(-1)!.push(token);
    }
    return rows.filter(
      (row) =>
        (!options.vaultId || row.data.vaultId === options.vaultId) &&
        alternatives.some((terms) => terms.every((term) => match(row, term))),
    );
  }
  function saveTemplate(
    input: unknown,
    id?: string,
    expectedRevision?: number,
  ) {
    const data = object(input);
    return workspace.put(
      "template",
      {
        title: text(data.title, "template title", 120, true),
        body: text(data.body ?? "", "template body", 500000),
        folder: safeFolder(data.folder ?? ""),
        properties: object(data.properties ?? {}),
      },
      id,
      expectedRevision,
    );
  }
  function daily(input: unknown) {
    const data = object(input),
      date = text(data.date, "daily date", 10, true);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
    )
      throw new Error("Invalid daily date");
    const vault = data.vaultId
      ? workspace.get(data.vaultId, "vault")
      : defaultVault();
    if (!vault) throw new Error("Vault not found");
    const existing = notes().find(
      (row) =>
        row.data.vaultId === vault.id && row.data.properties.daily === date,
    );
    if (existing) return existing;
    const template =
      data.templateId || vault.data.dailyTemplateId
        ? workspace.get(
            data.templateId || vault.data.dailyTemplateId,
            "template",
          )
        : undefined;
    const [year, month, day] = date.split("-");
    const title = (vault.data.dailyFormat || "YYYY-MM-DD")
      .replace(/YYYY/g, year)
      .replace(/MM/g, month)
      .replace(/DD/g, day);
    return saveNote({
      title,
      body: (template?.data.body || "# {{title}}\n\n")
        .replace(/\{\{date\}\}/g, date)
        .replace(/\{\{title\}\}/g, title),
      vaultId: vault.id,
      folder: vault.data.dailyFolder || "Daily",
      properties: { ...(template?.data.properties || {}), daily: date },
    });
  }
  function saveBookmark(
    input: unknown,
    id?: string,
    expectedRevision?: number,
  ) {
    const data = object(input),
      target = text(data.target, "bookmark target", 2000, true);
    if (target.startsWith("https://") || target.startsWith("http://")) {
      const url = new URL(target);
      if (url.username || url.password)
        throw new Error("Bookmark URL cannot include credentials");
    } else if (!workspace.resolveReference(target))
      throw new Error("Bookmark reference not found");
    return workspace.put(
      "bookmark",
      {
        title: text(data.title, "bookmark title", 120, true),
        target,
        heading: text(data.heading ?? "", "bookmark heading", 240),
        folder: safeFolder(data.folder ?? ""),
        order: Number.isFinite(data.order) ? data.order : 0,
      },
      id,
      expectedRevision,
    );
  }
  function importFiles(input: unknown) {
    const data = object(input);
    if (!Array.isArray(data.files) || data.files.length > 100)
      throw new Error("Import requires up to 100 files");
    let total = 0;
    for (const file of data.files) {
      object(file);
      const name = text(file.name, "import filename", 240, true);
      if (
        name.startsWith("/") ||
        name.includes("\\") ||
        name.includes(":") ||
        name.split("/").some((p) => !p || p === ".." || p === ".") ||
        !/\.(md|json)$/i.test(name)
      )
        throw new Error("Unsafe or unsupported import filename");
      total += Buffer.byteLength(
        text(file.content, "import content", 4 * 1024 * 1024),
      );
    }
    if (total > 4 * 1024 * 1024) throw new Error("Import exceeds 4 MiB");
    const imported: Array<{ name: string; id: string; originalId?: string }> =
        [],
      rejected: Array<{ name: string; error: string }> = [],
      warnings: string[] = [],
      queue: Array<{ name: string; content: string }> = [];
    for (const file of data.files) {
      try {
        if (/\.json$/i.test(file.name)) {
          const parsed = object(JSON.parse(file.content));
          if (parsed.format === "sourcewatch-vault") {
            if (!Array.isArray(parsed.notes) || parsed.notes.length > 1000)
              throw new Error("Vault JSON requires at most 1000 notes");
            for (let i = 0; i < parsed.notes.length; i++)
              queue.push({
                name: `${file.name}/note-${i}.json`,
                content: JSON.stringify(parsed.notes[i]),
              });
            warnings.push(
              `${file.name}: notes imported non-destructively; vault settings, templates, bookmarks and attachments are not imported by this notes importer`,
            );
            continue;
          }
        }
        queue.push(file);
      } catch (error) {
        rejected.push({ name: file.name, error: (error as Error).message });
      }
    }
    for (const file of queue) {
      try {
        let body = file.content,
          meta: any = {};
        if (/\.json$/i.test(file.name)) {
          const parsed = object(JSON.parse(body));
          meta = parsed.data
            ? { ...object(parsed.data), id: parsed.id }
            : parsed;
          if (typeof meta.body !== "string")
            throw new Error("JSON note requires a text body");
          body = meta.body;
        } else if (body.startsWith("---\n") || body.startsWith("---\r\n")) {
          const match = /^---\r?\n([^]*?)\r?\n---\r?\n?/.exec(body);
          if (match) {
            const native = /^sourcewatch:\s*(\{[^]*\})\s*$/.exec(match[1]);
            if (native) {
              meta = object(JSON.parse(native[1]));
              body = body.slice(match[0].length);
            } else {
              for (const line of match[1].split(/\r?\n/)) {
                const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
                if (!field) continue;
                let value: any = field[2];
                try {
                  value = JSON.parse(value);
                } catch {
                  if (value.startsWith("["))
                    value = value
                      .slice(1, -1)
                      .split(",")
                      .map((v: string) => v.trim());
                }
                if (["title", "tags", "aliases", "folder"].includes(field[1]))
                  meta[field[1]] = value;
              }
              warnings.push(
                `${file.name}: simple frontmatter indexed; original YAML preserved verbatim in Markdown body; advanced YAML is not interpreted`,
              );
            }
          }
        }
        const refs = Array.isArray(meta.refs)
          ? meta.refs.filter(
              (ref: unknown) =>
                typeof ref === "string" && workspace.resolveReference(ref),
            )
          : [];
        if (Array.isArray(meta.refs) && refs.length !== meta.refs.length)
          warnings.push(
            `${file.name}: unresolved explicit references omitted; original IDs retained in the import mapping`,
          );
        const row = saveNote({
          title:
            typeof meta.title === "string"
              ? meta.title
              : file.name
                  .split("/")
                  .at(-1)!
                  .replace(/\.(md|json)$/i, ""),
          body,
          folder:
            typeof meta.folder === "string"
              ? meta.folder
              : file.name.split("/").slice(0, -1).join("/"),
          vaultId: data.vaultId || undefined,
          aliases: meta.aliases || [],
          tags:
            typeof meta.tags === "string"
              ? meta.tags.split(/[, ]+/).filter(Boolean)
              : meta.tags || [],
          properties: meta.properties || {},
          refs,
        });
        imported.push({
          name: file.name,
          id: row.id,
          ...(workspaceId(meta.id) ? { originalId: meta.id } : {}),
        });
      } catch (error) {
        rejected.push({ name: file.name, error: (error as Error).message });
      }
    }
    const mapping = new Map(
      imported
        .filter((row) => row.originalId)
        .map((row) => [row.originalId!, row.id]),
    );
    for (const importedRow of imported) {
      const row = getNote(importedRow.id);
      let body = row.data.body;
      for (const link of parseWikiLinks(row.data.body).reverse()) {
        const rawId = link.target.replace(/^note:/, "");
        const replacement = mapping.get(rawId);
        if (replacement) {
          const raw = link.raw.replace(
            link.target,
            link.target.startsWith("note:")
              ? `note:${replacement}`
              : replacement,
          );
          body = body.slice(0, link.start) + raw + body.slice(link.end);
        }
      }
      if (body !== row.data.body)
        saveNote({ ...row.data, body }, row.id, row.revision);
    }
    workspace.audit("vault:import", "batch", {
      imported: imported.length,
      rejected: rejected.length,
    });
    return { imported, rejected, warnings };
  }
  function exportZip(vaultId?: string) {
    const rows = notes().filter(
        (row) => !vaultId || row.data.vaultId === vaultId,
      ),
      files: Record<string, Uint8Array> = {};
    let total = 0;
    for (const row of rows) {
      const content = strToU8(markdown(row));
      total += content.length;
      if (total > 64 * 1024 * 1024)
        throw new Error("Vault export exceeds 64 MiB");
      files[`notes/${row.id}.md`] = content;
    }
    files["workspace.json"] = strToU8(
      JSON.stringify(
        {
          format: "sourcewatch-vault",
          version: 1,
          vaults: workspace
            .list("vault")
            .filter((row) => !vaultId || row.id === vaultId),
          notes: rows,
          templates: workspace.list("template"),
          bookmarks: workspace.list("bookmark"),
          references: rows.flatMap((row) => row.data.refs),
          notice:
            "Editable research notes, separate from capture evidence. Local timestamps and hashes do not certify authenticity.",
        },
        null,
        2,
      ),
    );
    files["README.txt"] = strToU8(
      "SOURCEWATCH vault export\nMarkdown notes are in notes/. UUID filenames and frontmatter preserve stable identifiers. workspace.json contains metadata and editable context. manifest.json lists SHA-256 file hashes. No website authenticity or certified timestamps are implied. Attachments remain separately cataloged; this export does not embed their bytes.\n",
    );
    const hashes = Object.fromEntries(
      Object.keys(files)
        .sort()
        .map((name) => [
          name,
          createHash("sha256").update(files[name]).digest("hex"),
        ]),
    );
    files["manifest.json"] = strToU8(
      JSON.stringify(
        { version: 1, algorithm: "sha256", files: hashes },
        null,
        2,
      ),
    );
    if (
      Object.values(files).reduce((size, bytes) => size + bytes.length, 0) >
      64 * 1024 * 1024
    )
      throw new Error("Vault export exceeds 64 MiB including metadata");
    return zipSync(files, {
      level: 6,
      mtime: new Date(2000, 0, 1),
    });
  }
  function expected(row: WorkspaceObject<NoteData>, revision: unknown) {
    if (!Number.isInteger(revision) || revision !== row.revision)
      throw Object.assign(
        new Error("Note revision conflict. Reload before composing."),
        { statusCode: 409 },
      );
  }
  function extractNote(id: string, input: unknown) {
    const data = object(input),
      original = getNote(id);
    expected(original, data.expectedRevision);
    const start = data.start,
      end = data.end,
      title = text(data.title, "extracted note title", 120, true);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > original.data.body.length
    )
      throw new Error("Select a nonempty valid text range");
    let extracted: WorkspaceObject<NoteData> | undefined;
    workspace.store.db.exec("SAVEPOINT vault_compose");
    try {
      extracted = saveNote({
        ...original.data,
        title,
        body: original.data.body.slice(start, end),
        aliases: [],
        properties: Object.fromEntries(
          Object.entries(original.data.properties).filter(
            ([key]) => key !== "daily",
          ),
        ),
      });
      const label = title
        .replaceAll("[", " ")
        .replaceAll("]", " ")
        .replaceAll("|", " ")
        .replaceAll("\r", " ")
        .replaceAll("\n", " ");
      const updated = saveNote(
        {
          ...original.data,
          body:
            original.data.body.slice(0, start) +
            `[[note:${extracted.id}|${label}]]` +
            original.data.body.slice(end),
        },
        id,
        original.revision,
      );
      workspace.audit("vault:extract", id, {
        fromRevision: original.revision,
        newNoteId: extracted.id,
        start,
        end,
      });
      workspace.store.db.exec("RELEASE vault_compose");
      return { note: updated, extracted };
    } catch (error) {
      workspace.store.db.exec(
        "ROLLBACK TO vault_compose;RELEASE vault_compose",
      );
      if (extracted) {
        const orphan = join(directory(), `${extracted.id}.md`);
        if (existsSync(orphan)) unlinkSync(orphan);
      }
      mirror(original);
      throw error;
    }
  }
  function mergeNote(id: string, input: unknown) {
    const data = object(input),
      target = getNote(id),
      source = getNote(text(data.sourceId, "source note identifier", 36, true));
    expected(target, data.expectedRevision);
    expected(source, data.sourceRevision);
    if (source.id === target.id)
      throw new Error("Cannot merge a note into itself");
    if (source.data.vaultId !== target.data.vaultId)
      throw new Error(
        "Merge notes within the same vault to preserve title-based link resolution",
      );
    const label = source.data.title
      .replaceAll("[", " ")
      .replaceAll("]", " ")
      .replaceAll("|", " ")
      .replaceAll("\r", " ")
      .replaceAll("\n", " ");
    const row = saveNote(
      {
        ...target.data,
        body: `${target.data.body}\n\n---\n\n## From [[note:${source.id}|${label}]]\n\n${source.data.body}`,
        refs: [...new Set([...target.data.refs, ...source.data.refs])],
      },
      id,
      target.revision,
    );
    workspace.audit("vault:merge", id, {
      fromRevision: target.revision,
      sourceId: source.id,
      sourceRevision: source.revision,
      sourceRetained: true,
    });
    return row;
  }
  function uniqueNote(input: unknown) {
    const data = object(input),
      title = `${new Date().toISOString().replace(/[:.]/g, "-")} ${randomUUID()}`;
    return saveNote({
      title,
      body: `# ${title}\n\n`,
      vaultId: data.vaultId,
      folder: data.folder || "",
    });
  }
  function state() {
    defaultVault();
    return {
      vaults: workspace.list("vault"),
      notes: notes(),
      deleted: workspace
        .list<NoteData>("note", true)
        .filter((row) => row.deletedAt),
      templates: workspace.list("template"),
      bookmarks: workspace.list("bookmark"),
    };
  }
  return {
    state,
    listNotes,
    saveNote,
    getNote,
    detail,
    links,
    removeNote,
    restoreNote,
    history: (id: string) => {
      getNote(id, true);
      return workspace.history(id);
    },
    saveVault,
    saveTemplate,
    daily,
    saveBookmark,
    importFiles,
    exportZip,
    markdown,
    extractNote,
    mergeNote,
    uniqueNote,
  };
}
