import { capture } from "../src/capture.js";
import { Store } from "../src/storage.js";
import { exportBundle } from "../src/export.js";
import { mkdirSync, writeFileSync } from "node:fs";
const store = new Store("data/public-smoke");
try {
  const source = store.add({
    url: "https://example.com",
    name: "Example Domain",
    collection: "Public smoke test",
    description: "Real public-network capture smoke test",
    intervalMinutes: 0,
    selectors: [],
  });
  const result = store.save(source, await capture(source.url));
  const bundle = exportBundle(store, source.id);
  mkdirSync("data/public-smoke/export", { recursive: true });
  writeFileSync("data/public-smoke/export/evidence.zip", bundle.zip);
  console.log(
    JSON.stringify(
      {
        title: result.title,
        status: result.status,
        finalUrl: result.finalUrl,
        artifacts: result.files,
        manifestSha256: bundle.manifestSha256,
        warnings: result.warnings,
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
