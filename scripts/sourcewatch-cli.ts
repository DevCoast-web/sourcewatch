#!/usr/bin/env node
import { readFileSync } from "node:fs";
const [command, ...args] = process.argv.slice(2),
  base = "http://127.0.0.1:" + (process.env.PORT || 3210);
async function request(path: string, method = "GET", body?: unknown) {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = r.headers.get("content-type") || "";
  const result = type.includes("application/json")
    ? await r.json()
    : await r.text();
  if (!r.ok)
    throw Error(typeof result === "object" ? result.error : String(result));
  return result;
}
try {
  let result: unknown;
  switch (command) {
    case "status":
      result = await request("/status");
      break;
    case "vaults":
      result = (await request("/vault/state")).vaults;
      break;
    case "notes":
      result = await request(
        "/vault/notes?q=" + encodeURIComponent(args.join(" ")),
      );
      break;
    case "read":
      result = await request("/vault/notes/" + args[0]);
      break;
    case "create":
      result = await request("/vault/notes", "POST", {
        title: args[0] || "Unique note " + new Date().toISOString(),
        body: args[1] ? readFileSync(args[1], "utf8") : "",
      });
      break;
    case "daily":
      result = await request(
        "/vault/daily",
        "POST",
        args[0] ? { date: args[0] } : {},
      );
      break;
    case "links":
      result = await request("/vault/notes/" + args[0]);
      result = {
        outgoing: (result as any).outgoing,
        backlinks: (result as any).backlinks,
        unlinkedMentions: (result as any).unlinkedMentions,
      };
      break;
    case "search":
      result = await request(
        "/workspace/search?q=" + encodeURIComponent(args.join(" ")),
      );
      break;
    case "catalog":
      result = await request("/workspace/catalog");
      break;
    case "canvases":
      result = await request("/canvases");
      break;
    case "entities":
      result = await request(
        "/intelligence/records/entity?q=" + encodeURIComponent(args.join(" ")),
      );
      break;
    case "investigations":
      result = await request("/intelligence/records/investigation");
      break;
    case "evidence":
      result = await request("/captures/" + args[0]);
      break;
    case "capture":
      result = await request("/sources/" + args[0] + "/capture", "POST");
      break;
    case "import-notes":
      result = await request(
        "/vault/import",
        "POST",
        JSON.parse(readFileSync(args[0], "utf8")),
      );
      break;
    case "import-data":
      result = await request(
        "/intelligence/imports",
        "POST",
        JSON.parse(readFileSync(args[0], "utf8")),
      );
      break;
    case "export-urls":
      result = {
        workspace: base + "/api/workspace/export",
        vault: base + "/api/vault/export",
        intelligence: base + "/api/intelligence/export?format=zip",
      };
      break;
    default:
      throw Error(
        "Usage: npm run cli -- status|vaults|notes [query]|read <noteID>|create <title> [markdown-file]|daily [date]|links <noteID>|search <query>|catalog|canvases|entities|investigations|evidence <captureID>|capture <sourceID>|import-notes <JSONfile>|import-data <JSONfile>|export-urls",
      );
  }
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exitCode = 1;
}
