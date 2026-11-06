import { spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
mkdirSync(".test-data", { recursive: true });
const root = mkdtempSync(join(resolve(".test-data"), "portable-launch-")),
  exe = resolve("release/SourceWatch-2.0.0-beta.1-portable.exe");
const started = performance.now();
const child = spawn(exe, [], {
  windowsHide: true,
  env: {
    ...process.env,
    SOURCEWATCH_DESKTOP_TEST_ROOT: root,
    SOURCEWATCH_DESKTOP_SMOKE_EXIT: "1",
  },
  stdio: "ignore",
});
child.on("error", (error) => {
  throw error;
});
let result: any;
for (let i = 0; i < 1800; i++) {
  if (existsSync(join(root, "desktop-ready.json"))) {
    result = JSON.parse(readFileSync(join(root, "desktop-ready.json"), "utf8"));
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!result) {
  child.kill();
  throw Error("Portable app did not become ready within 180 seconds");
}
if (
  !result.packaged ||
  result.nodeIntegration ||
  !result.contextIsolation ||
  !result.sandbox
)
  throw Error("Portable app security/startup check failed");
const elapsedMs = Math.round(performance.now() - started);
for (let i = 0; i < 100; i++) {
  if (!existsSync(join(root, "research", ".sourcewatch-desktop.lock"))) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const record = {
  version: result.version,
  portableLaunchPassed: true,
  packaged: true,
  rendererSandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  elapsedMs,
  isolatedData: true,
  gracefulShutdown: !existsSync(
    join(root, "research", ".sourcewatch-desktop.lock"),
  ),
};
writeFileSync(
  "docs/portable-validation.json",
  JSON.stringify(record, null, 2) + "\n",
);
console.log(JSON.stringify(record));
