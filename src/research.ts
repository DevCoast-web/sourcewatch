import { randomUUID } from "node:crypto";
import { Store, type RecordData } from "./storage.js";
import { compare } from "./compare.js";
export type Annotation = {
  captureId: string;
  note: string;
  tags: string[];
  updatedAt: string | null;
};
export type ResearchEvent = {
  id: string;
  sourceId: string;
  captureId: string | null;
  beforeId: string | null;
  kind: "changed" | "failure";
  summary: string;
  readAt: string | null;
  createdAt: string;
};
export function createResearch(store: Store) {
  store.db.exec(
    `CREATE TABLE IF NOT EXISTS research_annotations(captureId TEXT PRIMARY KEY REFERENCES captures(id),note TEXT NOT NULL,tags TEXT NOT NULL,updatedAt TEXT NOT NULL);CREATE TABLE IF NOT EXISTS research_events(id TEXT PRIMARY KEY,sourceId TEXT NOT NULL REFERENCES sources(id),captureId TEXT UNIQUE REFERENCES captures(id),beforeId TEXT REFERENCES captures(id),kind TEXT NOT NULL CHECK(kind IN ('changed','failure')),summary TEXT NOT NULL,readAt TEXT,createdAt TEXT NOT NULL);`,
  );
  function requireCapture(id: string) {
    const record = store.get(id);
    if (!record || !store.source(record.sourceId))
      throw new Error("Capture not found");
    return record;
  }
  function listEvents(unreadOnly = false): ResearchEvent[] {
    return store.db
      .prepare(
        `SELECT * FROM research_events ${unreadOnly ? "WHERE readAt IS NULL" : ""} ORDER BY createdAt DESC,rowid DESC LIMIT 500`,
      )
      .all() as ResearchEvent[];
  }
  function unreadCount() {
    return Number(
      (
        store.db
          .prepare(
            "SELECT COUNT(*) AS count FROM research_events WHERE readAt IS NULL",
          )
          .get() as { count: number }
      ).count,
    );
  }
  function markRead(id: string) {
    if (!store.db.prepare("SELECT id FROM research_events WHERE id=?").get(id))
      throw new Error("Event not found");
    store.db
      .prepare(
        "UPDATE research_events SET readAt=COALESCE(readAt,?) WHERE id=?",
      )
      .run(new Date().toISOString(), id);
    return store.db
      .prepare("SELECT * FROM research_events WHERE id=?")
      .get(id) as ResearchEvent;
  }
  function annotation(captureId: string): Annotation {
    requireCapture(captureId);
    const row = store.db
      .prepare("SELECT * FROM research_annotations WHERE captureId=?")
      .get(captureId) as
      | { captureId: string; note: string; tags: string; updatedAt: string }
      | undefined;
    return row
      ? { ...row, tags: JSON.parse(row.tags) }
      : { captureId, note: "", tags: [], updatedAt: null };
  }
  function saveAnnotation(
    captureId: string,
    input: { note: string; tags: string[] },
  ): Annotation {
    requireCapture(captureId);
    if (
      !input ||
      typeof input.note !== "string" ||
      input.note.length > 10000 ||
      !Array.isArray(input.tags) ||
      input.tags.length > 20 ||
      input.tags.some((tag) => typeof tag !== "string" || tag.length > 40)
    )
      throw new Error(
        "Invalid annotation: note maximum 10000 characters; maximum 20 tags of 40 characters",
      );
    const tags = [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))];
    store.db
      .prepare(
        "INSERT INTO research_annotations(captureId,note,tags,updatedAt) VALUES(?,?,?,?) ON CONFLICT(captureId) DO UPDATE SET note=excluded.note,tags=excluded.tags,updatedAt=excluded.updatedAt",
      )
      .run(
        captureId,
        input.note,
        JSON.stringify(tags),
        new Date().toISOString(),
      );
    return annotation(captureId);
  }
  function recordSuccess(
    previous: RecordData | undefined,
    current: RecordData,
  ) {
    current = requireCapture(current.id);
    if (!previous) return;
    previous = requireCapture(previous.id);
    if (
      previous.sourceId !== current.sourceId ||
      previous.id === current.id ||
      current.previousHash !== previous.chainHash
    )
      throw new Error(
        "Captures must be consecutive versions of the same source",
      );
    const before = store.file(previous.id, "text.txt").toString(),
      after = store.file(current.id, "text.txt").toString();
    let summary: string;
    try {
      const diff = compare(
        { text: before, links: previous.links, title: previous.title },
        { text: after, links: current.links, title: current.title },
      );
      if (!diff.changed) return;
      summary = [
        `Text: +${diff.added} / -${diff.removed} lines`,
        ...(diff.titleChanged ? ["Title changed"] : []),
        `Links: +${diff.linksAdded.length} / -${diff.linksRemoved.length}`,
      ].join("; ");
    } catch {
      if (
        previous.files["text.txt"] === current.files["text.txt"] &&
        previous.title === current.title &&
        JSON.stringify(previous.links) === JSON.stringify(current.links)
      )
        return;
      summary = "Content changed; detailed comparison exceeds complexity limit";
    }
    store.db
      .prepare(
        "INSERT OR IGNORE INTO research_events(id,sourceId,captureId,beforeId,kind,summary,createdAt) VALUES(?,?,?,?,'changed',?,?)",
      )
      .run(
        randomUUID(),
        current.sourceId,
        current.id,
        previous.id,
        summary,
        new Date().toISOString(),
      );
  }
  function recordFailure(sourceId: string, message: string) {
    if (!store.source(sourceId)) throw new Error("Source not found");
    if (typeof message !== "string") throw new Error("Invalid failure message");
    const id = randomUUID();
    store.db
      .prepare(
        "INSERT INTO research_events(id,sourceId,kind,summary,createdAt) VALUES(?,?,'failure',?,?)",
      )
      .run(id, sourceId, message.slice(0, 1000), new Date().toISOString());
    return id;
  }
  return {
    listEvents,
    unreadCount,
    markRead,
    annotation,
    saveAnnotation,
    recordSuccess,
    recordFailure,
  };
}
