import { _electron as electron } from "playwright";
import { resolve, join, dirname } from "node:path";
import { unzipSync } from "fflate";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
mkdirSync(".test-data", { recursive: true });
const root = mkdtempSync(join(resolve(".test-data"), "desktop-smoke-"));
const exe =
  process.env.SOURCEWATCH_TEST_EXECUTABLE ||
  resolve("node_modules/electron/dist/electron.exe");
const app = await electron.launch({
  executablePath: exe,
  args: process.env.SOURCEWATCH_TEST_EXECUTABLE
    ? []
    : [resolve("desktop/shell/main.cjs")],
  env: { ...process.env, SOURCEWATCH_DESKTOP_TEST_ROOT: root },
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.getByRole("region", { name: "Research overview" }).waitFor();
  console.log("DESKTOP overview rendered");
  const web = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const prefs = w.webContents.getLastWebPreferences();
    return {
      nodeIntegration: prefs.nodeIntegration,
      contextIsolation: prefs.contextIsolation,
      sandbox: prefs.sandbox,
      url: w.webContents.getURL(),
    };
  });
  if (web.nodeIntegration || !web.contextIsolation || !web.sandbox)
    throw Error("Insecure renderer preferences");
  const status = await page.evaluate(async () => {
    const r = await fetch("/api/status");
    return r.json();
  });
  console.log(JSON.stringify({ status, security: web }));
  const unauth = await fetch(new URL("/api/status", page.url()));
  if (unauth.status !== 403)
    throw Error("Desktop API allowed an unauthenticated request");
  await page
    .getByRole("button", { name: "Notes & vault", exact: true })
    .click();
  await page.getByRole("button", { name: "+ New note", exact: true }).click();
  await page
    .getByLabel("Note title", { exact: true })
    .fill("Packaged desktop note");
  await page
    .getByRole("textbox", { name: "Markdown note editor", exact: true })
    .fill(
      "# Saved in the desktop app\n\nThis persisted note proves the packaged service is running.",
    );
  await page
    .getByRole("button", { name: "Save now", exact: true })
    .click({ timeout: 1000 })
    .catch(() => {});
  await page
    .locator(".vault-status")
    .filter({ hasText: "Saved locally" })
    .waitFor();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page
    .getByRole("button", { name: "Packaged desktop note", exact: true })
    .waitFor();
  let nativeVerifierPassed = false,
    publicCapturePassed = false;
  if (process.env.SOURCEWATCH_DESKTOP_CAPTURE === "1") {
    await page.getByRole("button", { name: "Sources & captures", exact: true }).click();
    await page
      .getByRole("button", { name: "+ Add source", exact: true })
      .click();
    await page.getByLabel("Website URL").fill("https://example.com/");
    await page.getByLabel("Source name").fill("Desktop capture validation");
    await page.getByLabel("Collection", { exact: true }).fill("Desktop test");
    await page.getByRole("button", { name: "Add source", exact: true }).click();
    await page
      .getByRole("button", { name: "Capture first version", exact: true })
      .click();
    await page
      .getByText("First capture saved.", { exact: true })
      .waitFor({ timeout: 65000 });
    publicCapturePassed = true;
    const exported = await page.evaluate(async () => {
      const sources = await (await fetch("/api/sources")).json();
      const response = await fetch("/api/sources/" + sources[0].id + "/export");
      if (!response.ok) throw Error("Export failed");
      return Array.from(new Uint8Array(await response.arrayBuffer()));
    });
    const bundle = join(root, "exported-evidence");
    for (const [name, bytes] of Object.entries(
      unzipSync(Buffer.from(exported)),
    )) {
      const target = join(bundle, name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    await app.evaluate(({ dialog, Menu }, folder) => {
      (dialog as any).showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
      (dialog as any).showMessageBox = async (_window: any, options: any) => {
        (globalThis as any).sourcewatchVerificationResult = options;
        return { response: 0 };
      };
      Menu.getApplicationMenu()!
        .items.find((item) => item.label === "File")!
        .submenu!.items.find(
          (item) => item.label === "Verify extracted evidence…",
        )!
        .click();
    }, bundle);
    for (let i = 0; i < 100; i++) {
      const result = await app.evaluate(
        () => (globalThis as any).sourcewatchVerificationResult,
      );
      if (result) {
        if (result.message !== "Integrity check passed")
          throw Error(JSON.stringify(result));
        nativeVerifierPassed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!nativeVerifierPassed) throw Error("Native verifier did not complete");
    await page
      .getByRole("button", { name: "Overview", exact: true })
      .click();
    await page.evaluate(async () => {
      const ids: string[] = [];
      for (const title of [
        "Demo: Atlas Research",
        "Demo: Riverbend Office",
        "Demo: Public records archive",
        "Demo: Policy review group",
        "Demo: Open research journal",
        "Demo: Evidence workshop",
      ]) {
        const response = await fetch("/api/intelligence/records/entity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            type: "organization",
            tags: ["synthetic"],
          }),
        });
        if (!response.ok) throw Error(await response.text());
        ids.push((await response.json()).id);
      }
      await fetch("/api/intelligence/records/investigation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Demo: Public records review",
          refs: ids.slice(0, 3).map((id) => "entity:" + id),
        }),
      });
      for (let i = 0; i < 3; i++)
        await fetch("/api/intelligence/records/relationship", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Demo research connection " + i,
            type: "research context",
            fromRef: "entity:" + ids[i],
            toRef: "entity:" + ids[i + 1],
            classification: "hypothesis",
            explanation:
              "Synthetic screenshot data; no factual association is asserted.",
          }),
        });
    });
    await page
      .getByRole("button", { name: "Notes & vault", exact: true })
      .click();
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page
      .getByRole("button", { name: "Demo: Atlas Research", exact: true })
      .waitFor();
  }
  mkdirSync("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/desktop-overview.png" });
  writeFileSync(
    ".test-data/desktop-smoke-result.json",
    JSON.stringify(
      {
        root,
        exe,
        status,
        security: web,
        unauthenticatedApiBlocked: true,
        noteSavedAndIndexed: true,
        publicCapturePassed,
        nativeVerifierPassed,
      },
      null,
      2,
    ),
  );
  console.log("DESKTOP security and note persistence passed");
} finally {
  await app.close();
}

const reopened = await electron.launch({
  executablePath: exe,
  args: process.env.SOURCEWATCH_TEST_EXECUTABLE
    ? []
    : [resolve("desktop/shell/main.cjs")],
  env: { ...process.env, SOURCEWATCH_DESKTOP_TEST_ROOT: root },
});
try {
  const page = await reopened.firstWindow();
  await page
    .getByRole("button", { name: "Packaged desktop note", exact: true })
    .waitFor();
  console.log("DESKTOP note persisted across application restart");
} finally {
  await reopened.close();
}
if (existsSync(join(root, "research", ".sourcewatch-desktop.lock")))
  throw Error("Backend lock remained after shutdown");
