// Aperture Eye is the editable vector master; raster exports are derived from it.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const folder = "docs/brand";
mkdirSync(folder, { recursive: true });
const green = "#194d3b", ivory = "#f6f3eb";
const geometry = '<path d="M42 104 225 0 262 15 275 49Z M280 22 460 137 323 173Z M435 156 242 261 220 196Z M194 268 119 205 134 155Z M0 139 155 90 107 195Z"/><rect x="188" y="98" width="82" height="82"/>';
const mark = (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="920" height="536" viewBox="0 0 460 268" role="img" aria-label="SourceWatch Aperture Eye"><g fill="${color}">${geometry}</g></svg>`;
const icon = (rounded) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="SourceWatch"><rect width="512" height="512" rx="${rounded ? 96 : 0}" fill="${green}"/><g transform="translate(36 128) scale(.9565217391)" fill="${ivory}">${geometry}</g></svg>`;
writeFileSync(`${folder}/aperture-eye.svg`, mark(green));
writeFileSync(`${folder}/aperture-eye-light.svg`, mark(ivory));
writeFileSync(`${folder}/app-icon.svg`, icon(true));
writeFileSync("public/favicon.svg", icon(true));
const wordmark = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="120" viewBox="0 0 720 120" role="img" aria-label="SOURCEWATCH. The internet changes. Keep the receipts."><rect width="720" height="120" rx="12" fill="${ivory}"/><g transform="translate(20 31) scale(.21)" fill="${green}">${geometry}</g><text x="136" y="61" font-family="Arial,sans-serif" font-size="34" font-weight="700" letter-spacing="4" fill="${green}">SOURCEWATCH</text><text x="138" y="87" font-family="Arial,sans-serif" font-size="15" fill="#55665d">The internet changes. Keep the receipts.</text></svg>`;
writeFileSync(`${folder}/wordmark.svg`, wordmark);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  async function render(svg, size, path, transparent = false) {
    await page.setViewportSize(size);
    await page.setContent(`<html><body style="margin:0;background:${transparent ? "transparent" : ivory}">${svg.replace(/width="\d+" height="\d+"/, `width="${size.width}" height="${size.height}"`)}</body></html>`);
    await page.screenshot({ path, omitBackground: transparent });
  }
  await render(mark(green), { width: 920, height: 536 }, `${folder}/aperture-eye.png`, true);
  await render(mark(ivory), { width: 920, height: 536 }, `${folder}/aperture-eye-light.png`, true);
  await render(icon(true), { width: 1024, height: 1024 }, `${folder}/app-icon.png`, true);
  await render(icon(false), { width: 1024, height: 1024 }, "ios/SourceWatch/Assets.xcassets/AppIcon.appiconset/AppIcon.png");
  await render(icon(true), { width: 256, height: 256 }, "desktop/shell/icon.png", true);
  const png = readFileSync("desktop/shell/icon.png"), ico = Buffer.alloc(22 + png.length);
  ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
  ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18); png.copy(ico, 22);
  writeFileSync("desktop/icon.ico", ico);
  await render(wordmark, { width: 1440, height: 240 }, `${folder}/wordmark.png`);
} finally { await browser.close(); }
console.log(`Aperture Eye assets generated in ${resolve(folder)}`);
