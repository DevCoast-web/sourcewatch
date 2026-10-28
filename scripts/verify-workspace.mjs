#!/usr/bin/env node
import { readFileSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const hash = (b) => createHash("sha256").update(b).digest("hex");
export function verifyWorkspace(directory, expected) {
  const root = realpathSync(directory),
    bytes = readFileSync(join(root, "manifest.json")),
    manifest = JSON.parse(bytes),
    errors = [];
  if (manifest.format !== "sourcewatch-workspace-v1")
    throw Error("Unsupported workspace format");
  if (expected && hash(bytes) !== expected)
    errors.push("Manifest fingerprint mismatch");
  const read = (name) => {
    if (
      typeof name !== "string" ||
      name.includes("\\") ||
      name.includes(":") ||
      name.startsWith("/") ||
      name.split("/").some((p) => !p || p === "." || p === "..")
    )
      throw Error("Unsafe path");
    let current = root;
    for (const p of name.split("/")) {
      current = join(current, p);
      if (lstatSync(current).isSymbolicLink()) throw Error("Symlink rejected");
    }
    if (!resolve(current).startsWith(root + sep))
      throw Error("Path escapes bundle");
    return readFileSync(current);
  };
  for (const [name, digest] of Object.entries(manifest.files)) {
    try {
      if (hash(read(name)) !== digest) errors.push("MODIFIED: " + name);
    } catch (e) {
      errors.push("MISSING/UNSAFE: " + name + ": " + e.message);
    }
  }
  function walk(dir, prefix = "") {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const n = prefix + item.name;
      if (item.isSymbolicLink()) errors.push("SYMLINK: " + n);
      else if (item.isDirectory()) walk(join(dir, item.name), n + "/");
      else if (n !== "manifest.json" && !Object.hasOwn(manifest.files, n))
        errors.push("UNEXPECTED: " + n);
    }
  }
  walk(root);
  return {
    ok: !errors.length,
    manifestSha256: hash(bytes),
    files: Object.keys(manifest.files).length,
    errors,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const expected = process.argv.includes("--expect")
      ? process.argv[process.argv.indexOf("--expect") + 1]
      : undefined;
    if (expected && !/^[a-f0-9]{64}$/.test(expected))
      throw Error("Invalid expected SHA-256");
    const r = verifyWorkspace(process.argv[2] || ".", expected);
    console.log(JSON.stringify(r, null, 2));
    process.exitCode = r.ok ? 0 : 1;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
