#!/usr/bin/env node
// SOURCEWATCH offline verifier: Node.js built-ins only. No install or network required.
import { readFileSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const hash = (b) => createHash("sha256").update(b).digest("hex");
export function verify(directory, expected) {
  const root = realpathSync(directory),
    errors = [];
  const bytes = readFileSync(join(root, "manifest.json"));
  const digest = hash(bytes);
  if (expected && digest !== expected)
    errors.push("Manifest does not match the externally retained SHA-256");
  const manifest = JSON.parse(bytes);
  if (manifest.format !== "sourcewatch-evidence-v1")
    throw new Error("Unsupported bundle format");
  const safe = (name) =>
    typeof name === "string" &&
    !name.includes("\\") &&
    !name.split("/").some((p) => !p || p === "." || p === "..") &&
    !name.startsWith("/") &&
    !name.includes(":");
  const read = (name) => {
    if (!safe(name)) throw new Error(`Unsafe manifest path: ${name}`);
    const file = resolve(root, name);
    if (!file.startsWith(root + sep)) throw new Error("Path escapes bundle");
    let current = root;
    for (const part of name.split("/")) {
      current = join(current, part);
      if (lstatSync(current).isSymbolicLink())
        throw new Error(`Symlink rejected: ${name}`);
    }
    return readFileSync(file);
  };
  for (const [name, digest] of Object.entries(manifest.files))
    try {
      if (hash(read(name)) !== digest) errors.push(`MODIFIED: ${name}`);
    } catch (e) {
      errors.push(`MISSING/UNSAFE: ${name}: ${e.message}`);
    }
  let previous = null;
  const ids = new Set();
  for (const id of manifest.captures) {
    try {
      if (ids.has(id)) throw new Error("Duplicate capture");
      ids.add(id);
      const name = `captures/${id}/metadata.json`;
      if (!manifest.files[name])
        throw new Error("Metadata absent from manifest");
      const record = JSON.parse(read(name));
      const { chainHash, ...base } = record;
      if (
        record.id !== id ||
        record.sourceId !== manifest.sourceId ||
        record.previousHash !== previous ||
        hash(JSON.stringify(base)) !== chainHash
      )
        errors.push(`CHAIN MISMATCH: ${id}`);
      for (const [name, digest] of Object.entries(record.files)) {
        const path = `captures/${id}/${name}`;
        if (manifest.files[path] !== digest || hash(read(path)) !== digest)
          errors.push(`ARTIFACT MISMATCH: ${path}`);
      }
      if (record.screenshotInfo) {
        const info = record.screenshotInfo;
        if (
          !["tiled", "none"].includes(info.mode) ||
          !Array.isArray(info.tiles) ||
          info.tiles.length > 64 ||
          !Number.isInteger(info.width) ||
          !Number.isInteger(info.height) ||
          info.width < 1 ||
          info.height < 1 ||
          typeof info.complete !== "boolean"
        )
          throw new Error("Invalid visual capture descriptor");
        let y = 0;
        for (const [index, tile] of info.tiles.entries()) {
          const expectedName =
            "screenshot-" + String(index + 1).padStart(4, "0") + ".png";
          if (
            tile.file !== expectedName ||
            tile.y !== y ||
            tile.width !== info.width ||
            !Number.isInteger(tile.height) ||
            tile.height < 1 ||
            tile.height > 8192 ||
            !record.files[tile.file]
          )
            throw new Error("Invalid or missing screenshot tile");
          y += tile.height;
        }
        if (
          y > info.height ||
          (info.complete && (info.mode !== "tiled" || y !== info.height)) ||
          (info.mode === "none" && info.tiles.length)
        )
          throw new Error("Inconsistent visual coverage");
      }
      previous = chainHash;
    } catch (e) {
      errors.push(`INVALID CAPTURE ${id}: ${e.message}`);
    }
  }
  if (previous !== manifest.chainTip) errors.push("Chain tip mismatch");
  function walk(dir, prefix = "") {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix + item.name;
      if (item.isSymbolicLink()) {
        errors.push(`UNEXPECTED SYMLINK: ${path}`);
        continue;
      }
      if (item.isDirectory()) walk(join(dir, item.name), path + "/");
      else if (path !== "manifest.json" && !Object.hasOwn(manifest.files, path))
        errors.push(`UNEXPECTED: ${path}`);
    }
  }
  walk(root);
  return {
    ok: errors.length === 0,
    captures: ids.size,
    manifestSha256: digest,
    errors,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (!process.argv[2])
      throw new Error(
        "Usage: node verify.mjs <extracted-bundle-directory> [--expect <manifest-sha256>]",
      );
    if (
      process.argv.includes("--expect") &&
      !/^[a-f0-9]{64}$/i.test(
        process.argv[process.argv.indexOf("--expect") + 1] || "",
      )
    )
      throw new Error("--expect requires a 64-character SHA-256");
    const result = verify(
      process.argv[2],
      process.argv.includes("--expect")
        ? process.argv[process.argv.indexOf("--expect") + 1]
        : undefined,
    );
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
