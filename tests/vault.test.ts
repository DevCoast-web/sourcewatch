import { chromium } from "playwright";
import { createApp } from "../src/server.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { unzipSync } from "fflate";
import { Store } from "../src/storage.js";
import { WorkspaceStore } from "../src/workspace-store.js";
import { createVault, parseWikiLinks, noteOutline } from "../src/vault.js";
import { registerVaultRoutes } from "../src/vault-routes.js";
function fixture() {
  mkdirSync(resolve(".test-data"), { recursive: true });
  const root = mkdtempSync(join(resolve(".test-data"), "vault-")),
    store = new Store(root),
    workspace = new WorkspaceStore(store),
    vault = createVault(workspace);
  return {
    root,
    store,
    workspace,
    vault,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("vault saves readable atomic Markdown, CAS revisions, stable renames, deletion and recovery", () => {
  const f = fixture();
  try {
    const vaultId = f.vault.state().vaults[0].id;
    const first = f.vault.saveNote({
      title: "Commitment",
      body: "# Original\n\nPublic promise.",
      vaultId,
      tags: ["policy"],
      properties: { reviewed: false, amount: 12 },
      folder: "Research/Policy",
    });
    const mirror = join(f.root, "workspace", "notes", `${first.id}.md`);
    assert.match(readFileSync(mirror, "utf8"), /# Original/);
    assert.match(readFileSync(mirror, "utf8"), new RegExp(first.id));
    const revised = f.vault.saveNote(
      {
        ...first.data,
        title: "Revised commitment",
        body: "# Revised\n\nUpdated promise.",
      },
      first.id,
      first.revision,
    );
    assert.equal(revised.id, first.id);
    assert.deepEqual(revised.data.aliases, ["Commitment"]);
    assert.throws(
      () =>
        f.vault.saveNote(
          { ...first.data, body: "Stale" },
          first.id,
          first.revision,
        ),
      (e: any) => e.statusCode === 409,
    );
    assert.match(readFileSync(mirror, "utf8"), /# Revised/);
    const deleted = f.vault.removeNote(first.id, revised.revision);
    assert.equal(f.vault.listNotes().length, 0);
    assert.equal(existsSync(mirror), false);
    assert.equal(
      existsSync(
        join(f.root, "workspace", "notes", ".trash", `${first.id}.md`),
      ),
      true,
    );
    const restored = f.vault.restoreNote(first.id, 1, deleted.revision);
    assert.equal(restored.data.body, first.data.body);
    assert.equal(restored.revision, 4);
    assert.equal(f.vault.history(first.id).length, 4);
    assert.match(readFileSync(mirror, "utf8"), /# Original/);
    const reopened = new Store(f.root);
    try {
      assert.deepEqual(
        createVault(new WorkspaceStore(reopened)).getNote(first.id),
        restored,
      );
    } finally {
      reopened.close();
    }
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) AS n FROM captures").get()!.n,
      0,
    );
  } finally {
    f.close();
  }
});
test("wikilinks resolve aliases, headings and UUIDs without guessing ambiguous names or treating code as links", () => {
  const f = fixture();
  try {
    const target = f.vault.saveNote({ title: "Commitment", body: "# Details" });
    const source = f.vault.saveNote({
      title: "Analysis",
      body: `[[Commitment#Details|the promise]] [[note:${target.id}]] [[Missing]]\n\n\`[[ignored]]\`\n\n\`\`\`\n[[also ignored]]\n\`\`\``,
    });
    assert.equal(parseWikiLinks(source.data.body).length, 3);
    assert.equal(f.vault.links(source.id)[0].targetRef, `note:${target.id}`);
    assert.equal(f.vault.links(source.id)[0].heading, "Details");
    assert.equal(f.vault.links(source.id)[2].status, "unresolved");
    assert.equal(
      f.vault.detail(target.id).backlinks[0].ref,
      `note:${source.id}`,
    );
    f.vault.saveNote(
      { ...target.data, title: "New title" },
      target.id,
      target.revision,
    );
    assert.equal(f.vault.links(source.id)[0].targetRef, `note:${target.id}`);
    f.vault.saveNote({ title: "Commitment", body: "Different note" });
    assert.equal(f.vault.links(source.id)[0].status, "ambiguous");
    assert.equal(f.vault.links(source.id)[1].status, "resolved");
    const mention = f.vault.saveNote({
      title: "Mention",
      body: "The New title has an unresolved question.",
    });
    assert.equal(
      f.vault.detail(target.id).unlinkedMentions[0].ref,
      `note:${mention.id}`,
    );
    const other = f.vault.saveVault({ title: "Other vault" });
    const isolated = f.vault.saveNote({
      title: "Isolated",
      body: "[[New title]]",
      vaultId: other.id,
    });
    assert.equal(f.vault.links(isolated.id)[0].status, "unresolved");
    assert.deepEqual(
      noteOutline("# One\n```\n# not a heading\n```\n## Two").map(
        (row) => row.text,
      ),
      ["One", "Two"],
    );
  } finally {
    f.close();
  }
});
test("vault search combines phrases, tag folder properties negation alternatives and daily templates", () => {
  const f = fixture();
  try {
    const row = f.vault.saveNote({
      title: "Annual report",
      body: "Exact phrase goes here",
      folder: "Cases/Agency",
      tags: ["policy"],
      properties: { status: "reviewed" },
    });
    assert.equal(
      f.vault.listNotes(
        '"exact phrase" tag:policy folder:Cases property:status=reviewed',
      )[0].id,
      row.id,
    );
    assert.equal(f.vault.listNotes("tag:policy -reviewed").length, 1);
    assert.equal(f.vault.listNotes('missing OR "exact phrase"').length, 1);
    assert.equal(f.vault.listNotes("type:pdf").length, 0);
    const template = f.vault.saveTemplate({
      title: "Daily template",
      body: "# {{title}}\nDate: {{date}}",
      properties: { reviewed: false },
    });
    const vault = f.vault.state().vaults[0];
    f.vault.saveVault(
      { ...vault.data, dailyTemplateId: template.id },
      vault.id,
      vault.revision,
    );
    const daily = f.vault.daily({ date: "2026-10-28", vaultId: vault.id });
    assert.equal(daily.data.body, "# 2026-10-28\nDate: 2026-10-28");
    assert.equal(daily.data.folder, "Daily");
    assert.equal(
      f.vault.daily({ date: "2026-10-28", vaultId: vault.id }).id,
      daily.id,
    );
    assert.throws(() => f.vault.daily({ date: "2026-02-31" }), /Invalid daily/);
    f.vault.saveBookmark({ title: "Daily", target: `note:${daily.id}` });
    assert.equal(f.vault.state().bookmarks.length, 1);
    assert.throws(
      () =>
        f.vault.saveBookmark({
          title: "Unsafe",
          target: "javascript:alert(1)",
        }),
      /not found/,
    );
  } finally {
    f.close();
  }
});
test("imports isolate malformed records, retain Markdown, refuse traversal, and export actual hashed files", () => {
  const f = fixture();
  try {
    for (const name of [
      "../escape.md",
      "/absolute.md",
      "C:/escape.md",
      "folder\\escape.md",
      "a/../../escape.md",
      "a.html",
    ]) {
      assert.throws(
        () => f.vault.importFiles({ files: [{ name, content: "bad" }] }),
        /Unsafe/,
      );
    }
    assert.equal(f.vault.listNotes().length, 0);
    const result = f.vault.importFiles({
      files: [
        {
          name: "Research/Imported.md",
          content:
            '---\ntitle: "Imported title"\ntags: [policy, test]\n---\n# Preserved\n\nRaw <script>must remain text</script>',
        },
        { name: "broken.json", content: "not JSON" },
        {
          name: "valid.json",
          content: JSON.stringify({
            title: "JSON note",
            body: "Portable",
            tags: [],
          }),
        },
      ],
    });
    assert.equal(result.imported.length, 2);
    assert.equal(result.rejected.length, 1);
    const imported = f.vault.getNote(result.imported[0].id);
    assert.equal(imported.data.title, "Imported title");
    assert.equal(imported.data.folder, "Research");
    assert.match(imported.data.body, /# Preserved/);
    assert.deepEqual(imported.data.tags, ["policy", "test"]);
    const bundle = f.vault.exportZip();
    assert.deepEqual(
      f.vault.exportZip(),
      bundle,
      "Unchanged vault exports are deterministic",
    );
    const files = unzipSync(bundle),
      manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
    for (const [name, hash] of Object.entries(manifest.files)) {
      assert.equal(
        createHash("sha256").update(files[name]).digest("hex"),
        hash,
      );
    }
    assert.match(
      Buffer.from(files[`notes/${imported.id}.md`]).toString(),
      /<script>must remain text<\/script>/,
    );
    const native = f.vault.importFiles({
      files: [
        {
          name: "roundtrip.md",
          content: Buffer.from(files[`notes/${imported.id}.md`]).toString(),
        },
      ],
    });
    assert.equal(
      f.vault.getNote(native.imported[0].id).data.body,
      imported.data.body,
    );
    assert.notEqual(
      native.imported[0].id,
      imported.id,
      "Import is nondestructive",
    );
    assert.equal(existsSync(join(f.root, "escape.md")), false);
  } finally {
    f.close();
  }
});
test("vault rejects unsafe filesystem mirrors and invalid references without writing outside root", (t) => {
  const f = fixture();
  let external = "";
  try {
    external = mkdtempSync(join(resolve(".test-data"), "vault-external-"));
    try {
      symlinkSync(external, join(f.root, "workspace", "notes"), "junction");
    } catch (error: any) {
      if (["EPERM", "EACCES"].includes(error.code)) {
        t.skip("Windows junction privilege unavailable");
        return;
      }
      throw error;
    }
    assert.throws(
      () => f.vault.saveNote({ title: "Escape", body: "Must not write" }),
      /Unsafe Markdown/,
    );
    assert.equal(f.workspace.list("note").length, 0);
    assert.equal(existsSync(join(external, "notes")), false);
  } finally {
    f.close();
    if (external) rmSync(external, { recursive: true, force: true });
  }
});
test("vault routes execute note workflow and expose current revision conflicts", async () => {
  const f = fixture(),
    app = Fastify();
  app.setErrorHandler((error: any, _req, reply) =>
    reply.code(error.statusCode || 400).send({ error: error.message }),
  );
  registerVaultRoutes(app, f.store, f.workspace);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/vault/notes",
      payload: { title: "Route note", body: "# Source" },
    });
    assert.equal(response.statusCode, 200, response.body);
    const row = response.json();
    assert.equal(
      (await app.inject({ url: `/api/vault/notes/${row.id}` })).json().note.data
        .body,
      "# Source",
    );
    const updated = await app.inject({
      method: "PUT",
      url: `/api/vault/notes/${row.id}`,
      payload: {
        data: { ...row.data, body: "# Changed" },
        expectedRevision: row.revision,
      },
    });
    assert.equal(updated.statusCode, 200, updated.body);
    const conflict = await app.inject({
      method: "PUT",
      url: `/api/vault/notes/${row.id}`,
      payload: { data: row.data, expectedRevision: row.revision },
    });
    assert.equal(conflict.statusCode, 409);
    const exported = await app.inject({ url: "/api/vault/export" });
    assert.equal(exported.headers["content-type"], "application/zip");
    assert(unzipSync(exported.rawPayload)[`notes/${row.id}.md`]);
  } finally {
    await app.close();
    f.close();
  }
});

test("vault browser workflow: edit, safe reading, wikilinks, backlinks, history, file import and persistence", async () => {
  const browser = await chromium.launch();
  const f = fixture();
  const target = f.vault.saveNote({
    title: "Linked target",
    body: "# Evidence review\n\n- [x] Confirmed reading\n\n<script>window.vaultUnsafe=true</script>\n\n[^source]: Local citation",
  });
  f.vault.saveNote({
    title: "Linked analysis",
    body: "# Working analysis\n\nSee [[Linked target|the target]].",
  });
  let active = await createApp({ root: f.root, testMode: true });
  try {
    await active.app.listen({ host: "127.0.0.1", port: 0 });
    const address = () =>
      `http://127.0.0.1:${(active.app.server.address() as { port: number }).port}`;
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await page.goto(address());
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    const workspace = page.getByRole("dialog", {
      name: "Research workspace",
      exact: true,
    });
    await workspace
      .locator(".vault-notelist")
      .getByRole("button", { name: /Linked analysis/ })
      .click();
    await workspace
      .getByRole("textbox", { name: "Markdown note editor", exact: true })
      .press("Control+End");
    await workspace
      .getByRole("button", { name: "Insert / command", exact: true })
      .click();
    await workspace
      .getByRole("menu", { name: "Insert Markdown command" })
      .getByRole("menuitem", { name: "Task", exact: true })
      .click();
    assert.match(
      await workspace
        .getByRole("textbox", { name: "Markdown note editor", exact: true })
        .inputValue(),
      /- \[ \] Task/,
    );
    const analysisSaved = page.waitForResponse(
      (response) =>
        response.url().includes("/api/vault/notes/") &&
        response.request().method() === "PUT",
    );
    await workspace
      .getByRole("button", { name: "Save now", exact: true })
      .click();
    assert.equal((await analysisSaved).status(), 200);
    await workspace
      .locator(".vault-status")
      .filter({ hasText: "Saved locally" })
      .waitFor();
    await workspace
      .locator(".vault-reading")
      .getByRole("button", { name: "the target", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        (
          document.querySelector(
            'input[aria-label="Note title"]',
          ) as HTMLInputElement | null
        )?.value === "Linked target",
    );
    await workspace
      .locator(".vault-context")
      .getByRole("button", { name: /Linked analysis/ })
      .waitFor();
    assert.equal(
      await workspace.locator(".vault-reading script").count(),
      0,
      "Raw note HTML must remain text",
    );
    assert.equal(
      await page.evaluate(() => (window as any).vaultUnsafe),
      undefined,
    );
    await workspace
      .getByRole("textbox", { name: "Markdown note editor", exact: true })
      .fill(
        "# Revised review\n\nActual saved Markdown.\n\n- [x] Retained task\n\n---\n\n# Second research slide",
      );
    const saved = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/vault/notes/${target.id}` &&
        r.request().method() === "PUT",
    );
    await workspace
      .getByRole("button", { name: "Save now", exact: true })
      .click();
    assert.equal((await saved).status(), 200);
    await workspace
      .locator(".vault-status")
      .filter({ hasText: "Saved locally" })
      .waitFor();
    assert.match(
      readFileSync(
        join(f.root, "workspace", "notes", `${target.id}.md`),
        "utf8",
      ),
      /Actual saved Markdown/,
    );
    await workspace
      .getByRole("button", { name: "Slides", exact: true })
      .click();
    await workspace
      .locator(".vault-slides")
      .getByRole("heading", { name: "Revised review", exact: true })
      .waitFor();
    await workspace
      .getByRole("button", { name: "Next slide", exact: true })
      .click();
    await workspace
      .locator(".vault-slides")
      .getByRole("heading", { name: "Second research slide", exact: true })
      .waitFor();
    await workspace
      .getByRole("button", { name: "Previous slide", exact: true })
      .click();
    await workspace
      .locator(".vault-slides")
      .getByRole("heading", { name: "Revised review", exact: true })
      .waitFor();
    await workspace.getByRole("button", { name: "Split", exact: true }).click();
    await workspace
      .getByText("Revision history & recovery", { exact: true })
      .click();
    await workspace.getByText("Revision 2", { exact: true }).waitFor();
    await workspace
      .getByLabel("Import Markdown or JSON", { exact: true })
      .setInputFiles({
        name: "Browser import.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(
          "# Imported through the real browser\n\nPortable note.",
        ),
      });
    await workspace
      .locator(".vault-notelist")
      .getByRole("button", { name: /Browser import/ })
      .waitFor();
    await active.app.close();
    active = await createApp({ root: f.root, testMode: true });
    await active.app.listen({ host: "127.0.0.1", port: 0 });
    await page.goto(address());
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await page
      .locator(".vault-notelist")
      .getByRole("button", { name: /Linked target/ })
      .click();
    await page.waitForFunction(() =>
      (
        document.querySelector(
          'textarea[aria-label="Markdown note editor"]',
        ) as HTMLTextAreaElement | null
      )?.value.includes("Actual saved Markdown"),
    );
    assert.equal(
      (
        await active.app.inject({
          url: `/api/vault/notes/${target.id}`,
          headers: { host: "127.0.0.1" },
        })
      ).json().note.revision,
      2,
    );
  } finally {
    await browser.close();
    await active.app.close();
    f.close();
  }
});

test("note composer extracts selected Markdown atomically, links both notes, and retains original revisions", () => {
  const f = fixture();
  try {
    const other = f.vault.saveNote({
      title: "Other evidence",
      body: "Context",
    });
    const body = "# Analysis\n\nSelected [[Other evidence]].\n\nTail.";
    const original = f.vault.saveNote({
      title: "Analysis",
      body,
      tags: ["case"],
    });
    const selection = "Selected [[Other evidence]].",
      start = body.indexOf(selection);
    const result = f.vault.extractNote(original.id, {
      start,
      end: start + selection.length,
      title: "Extracted section",
      expectedRevision: original.revision,
    });
    assert.equal(result.extracted.data.body, selection);
    assert.equal(result.extracted.data.vaultId, original.data.vaultId);
    assert.deepEqual(result.extracted.data.tags, ["case"]);
    assert.match(
      result.note.data.body,
      new RegExp(`\\[\\[note:${result.extracted.id}\\|Extracted section\\]\\]`),
    );
    assert.equal(
      f.vault.links(original.id)[0].targetRef,
      `note:${result.extracted.id}`,
    );
    assert.equal(
      f.vault.links(result.extracted.id)[0].targetRef,
      `note:${other.id}`,
    );
    assert.equal(
      f.vault.history(original.id).find((row) => row.revision === 1)!.data.body,
      body,
    );
    assert.equal(
      f.vault.detail(result.extracted.id).backlinks[0].ref,
      `note:${original.id}`,
    );
    const count = f.vault.listNotes().length;
    assert.throws(
      () =>
        f.vault.extractNote(original.id, {
          start: 0,
          end: 1,
          title: "Stale",
          expectedRevision: 1,
        }),
      (error: any) => error.statusCode === 409,
    );
    assert.equal(f.vault.listNotes().length, count);
    assert.throws(
      () =>
        f.vault.extractNote(original.id, {
          start: -1,
          end: 1,
          title: "Bad range",
          expectedRevision: result.note.revision,
        }),
      /valid text range/,
    );
  } finally {
    f.close();
  }
});

test("failed composer writes roll back new note, revision entries and Markdown mirrors", () => {
  const f = fixture();
  try {
    const original = f.vault.saveNote({
      title: "Original",
      body: "Selected text and retained remainder",
    });
    const put = f.workspace.put;
    let writes = 0;
    f.workspace.put = function (
      kind: string,
      data: any,
      id?: string,
      revision?: number,
    ) {
      if (kind === "note" && ++writes === 2)
        throw new Error("Forced composer failure");
      return put.call(f.workspace, kind, data, id, revision);
    } as typeof f.workspace.put;
    try {
      assert.throws(
        () =>
          f.vault.extractNote(original.id, {
            start: 0,
            end: 13,
            title: "New section",
            expectedRevision: original.revision,
          }),
        /Forced composer failure/,
      );
    } finally {
      f.workspace.put = put;
    }
    assert.equal(f.vault.listNotes().length, 1);
    assert.deepEqual(f.vault.getNote(original.id), original);
    assert.equal(f.vault.history(original.id).length, 1);
    assert.match(
      readFileSync(
        join(f.root, "workspace", "notes", `${original.id}.md`),
        "utf8",
      ),
      /Selected text and retained remainder/,
    );
    assert.equal(
      f.store.db
        .prepare(
          "SELECT COUNT(*) AS n FROM workspace_revisions WHERE objectId<>?",
        )
        .get(original.id)!.n,
      1,
      "Only the vault's own revision may remain beside the original note",
    );
  } finally {
    f.close();
  }
});

test("merge appends a copy with stable provenance, retains source and history, and requires both current revisions", () => {
  const f = fixture();
  try {
    const source = f.vault.saveNote({
      title: "Source section",
      body: "## Documented context\n\nNo inferred facts.",
    });
    const target = f.vault.saveNote({ title: "Case report", body: "# Report" });
    const merged = f.vault.mergeNote(target.id, {
      sourceId: source.id,
      sourceRevision: source.revision,
      expectedRevision: target.revision,
    });
    assert.match(merged.data.body, /Documented context/);
    assert.equal(f.vault.links(target.id)[0].targetRef, `note:${source.id}`);
    assert.deepEqual(f.vault.getNote(source.id), source);
    assert.equal(f.vault.history(source.id).length, 1);
    assert.equal(f.vault.history(target.id).length, 2);
    assert.throws(
      () =>
        f.vault.mergeNote(target.id, {
          sourceId: source.id,
          sourceRevision: 0,
          expectedRevision: merged.revision,
        }),
      (error: any) => error.statusCode === 409,
    );
    assert.throws(
      () =>
        f.vault.mergeNote(target.id, {
          sourceId: target.id,
          sourceRevision: merged.revision,
          expectedRevision: merged.revision,
        }),
      /itself/,
    );
    const otherVault = f.vault.saveVault({ title: "Independent vault" }),
      other = f.vault.saveNote({
        title: "Other vault note",
        body: "Other",
        vaultId: otherVault.id,
      });
    assert.throws(
      () =>
        f.vault.mergeNote(target.id, {
          sourceId: other.id,
          sourceRevision: other.revision,
          expectedRevision: merged.revision,
        }),
      /same vault/,
    );
    assert.equal(f.vault.history(target.id).length, 2);
    const first = f.vault.uniqueNote({ vaultId: source.data.vaultId }),
      second = f.vault.uniqueNote({ vaultId: source.data.vaultId });
    assert.notEqual(first.data.title, second.data.title);
    assert.notEqual(first.id, second.id);
  } finally {
    f.close();
  }
});
