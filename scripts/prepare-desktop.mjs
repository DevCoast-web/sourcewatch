import { build } from "esbuild";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  cpSync,
  rmSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { resolve, join, dirname, sep } from "node:path";
import { spawnSync } from "node:child_process";
if (
  process.platform !== "win32" ||
  process.arch !== "x64" ||
  Number(process.versions.node.split(".")[0]) < 24
)
  throw Error("Windows x64 and Node.js 24+ are required to build this package");
const pkg = JSON.parse(readFileSync("package.json")),
  work = resolve("work"),
  stage = resolve("work/desktop-runtime");
if (!stage.startsWith(work + sep) || stage === work)
  throw Error("Unsafe staging path");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const names = [
  "@fastify/static",
  "diff",
  "fastify",
  "fflate",
  "ipaddr.js",
  "parse5",
  "playwright",
];
const dependencies = Object.fromEntries(
  names.map((name) => [
    name,
    JSON.parse(readFileSync(join("node_modules", name, "package.json")))
      .version,
  ]),
);
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify(
    {
      name: "sourcewatch-engine",
      version: pkg.version,
      type: "module",
      private: true,
      dependencies,
      overrides: pkg.overrides,
    },
    null,
    2,
  ),
);
await build({
  entryPoints: readdirSync("src")
    .filter((n) => n.endsWith(".ts"))
    .map((n) => "src/" + n),
  outdir: join(stage, "src"),
  format: "esm",
  platform: "node",
  target: "node24",
  bundle: false,
});
cpSync("dist", join(stage, "dist"), { recursive: true });
mkdirSync(join(stage, "scripts"));
for (const name of ["verify.mjs", "verify-workspace.mjs"])
  copyFileSync("scripts/" + name, join(stage, "scripts", name));
copyFileSync("desktop/bootstrap.mjs", join(stage, "bootstrap.mjs"));
copyFileSync(process.execPath, join(stage, "node.exe"));
const nodeLicense = join(dirname(process.execPath), "LICENSE");
if (existsSync(nodeLicense))
  copyFileSync(nodeLicense, join(stage, "NODE-LICENSE.txt"));
else {
  const response = await fetch(
    "https://raw.githubusercontent.com/nodejs/node/v" +
      process.versions.node +
      "/LICENSE",
  );
  if (!response.ok)
    throw Error("Could not obtain the exact bundled Node license");
  writeFileSync(join(stage, "NODE-LICENSE.txt"), await response.text());
}
copyFileSync("LICENSE", join(stage, "LICENSE"));
const npmCli =
  process.env.npm_execpath ||
  join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
if (!existsSync(npmCli))
  throw Error("Run this preparation through npm run desktop:prepare");
const installed = spawnSync(
  process.execPath,
  [
    npmCli,
    "install",
    "--omit=dev",
    "--ignore-scripts",
    "--no-fund",
    "--no-audit",
  ],
  { cwd: stage, stdio: "inherit" },
);
if (installed.status !== 0)
  throw Error("Runtime dependency installation failed");
const browsers = JSON.parse(
  readFileSync("node_modules/playwright-core/browsers.json"),
).browsers;
const spec = browsers.find((b) => b.name === "chromium-headless-shell");
const folder = "chromium_headless_shell-" + spec.revision;
if (!existsSync(join(".browsers", folder)))
  throw Error(
    "Run: npx playwright install chromium (PLAYWRIGHT_BROWSERS_PATH=.browsers)",
  );
writeFileSync(
  "desktop/browser-build.json",
  JSON.stringify({ folder }, null, 2) + "\n",
);
writeFileSync(
  join(stage, "runtime-info.json"),
  JSON.stringify(
    {
      version: pkg.version,
      node: process.versions.node,
      playwright: dependencies.playwright,
      browserRevision: spec.revision,
    },
    null,
    2,
  ),
);
console.log("Desktop engine prepared with bundled Node and " + folder);
