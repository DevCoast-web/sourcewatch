import { chromium } from "playwright";
import { safeFetch, parsePublicUrl, type FetchResult } from "./network.js";
export type Captured = {
  html: string;
  text: string;
  screenshot: Buffer;
  title: string;
  description: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  links: string[];
  observedAt: string;
  warnings: string[];
  ignoredSelectors: string[];
};
export type CaptureOptions = {
  fetcher?: typeof safeFetch;
  fixtureUrl?: string;
  settleMs?: number;
  navigationTimeoutMs?: number;
  totalTimeoutMs?: number;
};
export async function capture(
  url: string,
  selectors: string[] = [],
  options: CaptureOptions = {},
): Promise<Captured> {
  if (!options.fixtureUrl) parsePublicUrl(url);
  const fetcher = options.fetcher || safeFetch;
  const browser = await chromium.launch({
    headless: true,
    timeout: 10000,
    args: [
      "--disable-quic",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--disable-background-networking",
    ],
    proxy: { server: "http://127.0.0.1:9", bypass: "<-loopback>" },
  });
  const context = await browser.newContext({
    viewport: { width: 1365, height: 900 },
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  const warnings: string[] = [];
  let count = 0;
  let bytes = 0;
  let main: FetchResult | undefined;
  const controller = new AbortController();
  const budget = { remaining: 32 * 1024 * 1024, signal: controller.signal };
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = async () => {
    if (active >= 6) await new Promise<void>((r) => waiting.push(r));
    else active++;
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  const deadline = setTimeout(() => {
    controller.abort();
    void browser.close();
  }, options.totalTimeoutMs ?? 45000);
  try {
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.route("**/*", async (route) => {
      const req = route.request();
      try {
        if (++count > 150) throw new Error("150-request limit reached");
        if (!["GET", "HEAD"].includes(req.method()))
          throw new Error("Non-read request blocked");
        if (["media", "font"].includes(req.resourceType()))
          return await route.abort();
        if (options.fixtureUrl && !req.url().startsWith(options.fixtureUrl))
          throw new Error("Fixture origin blocked");
        await acquire();
        let result: FetchResult;
        try {
          if (controller.signal.aborted) throw new Error("Capture closed");
          result = await fetcher(
            req.url(),
            req.method(),
            req.headers(),
            undefined,
            budget,
          );
        } finally {
          release();
        }
        bytes += result.body.length;
        if (bytes > 32 * 1024 * 1024)
          throw new Error("32 MiB total response limit reached");
        if (
          req.isNavigationRequest() &&
          req.frame() === context.pages()[0]?.mainFrame()
        )
          main = result;
        await route.fulfill({
          status: result.status,
          headers: result.headers,
          body: result.body,
        });
      } catch (e) {
        warnings.push(`${req.url().slice(0, 200)}: ${(e as Error).message}`);
        await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage();
    page.on("dialog", (d) => void d.dismiss());
    context.on("page", (p) => {
      if (p !== page) void p.close();
    });
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: options.navigationTimeoutMs ?? 25000,
      });
    } catch (e) {
      throw new Error(
        `Navigation failed: ${(e as Error).message.split("\n")[0]}. ${warnings.slice(-3).join("; ")}`,
        { cause: e },
      );
    }
    await page.waitForTimeout(options.settleMs ?? 1200);
    if (!main) throw new Error("No document response captured");
    if (main.status >= 400)
      throw new Error(
        `Website returned HTTP ${main.status}; access controls are not bypassed`,
      );
    if (
      !/text\/html|application\/xhtml/i.test(main.headers["content-type"] || "")
    )
      throw new Error("Only HTML pages can be captured");
    const html = await page.content();
    if (Buffer.byteLength(html) > 16 * 1024 * 1024)
      throw new Error("Rendered HTML exceeds 16 MiB");
    // Preserve the original rendered DOM and screenshot. Ignored regions affect comparisons only.
    const result = await page.evaluate((ignore) => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      const originals = Array.from(document.body.querySelectorAll("*"));
      const copies = Array.from(clone.querySelectorAll("*"));
      originals.forEach((el, i) => {
        const style = getComputedStyle(el);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          el.getAttribute("aria-hidden") === "true"
        )
          copies[i].remove();
      });
      clone
        .querySelectorAll("script,style,noscript,template")
        .forEach((n) => n.remove());
      for (const selector of ignore)
        clone.querySelectorAll(selector).forEach((n) => n.remove());
      clone
        .querySelectorAll(
          "p,div,section,article,header,footer,li,h1,h2,h3,h4,br,tr",
        )
        .forEach((n) => {
          n.prepend(document.createTextNode("\n"));
          n.append(document.createTextNode("\n"));
        });
      const text = (clone.textContent || "")
        .split("\n")
        .map((s) => s.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n");
      const links = [
        ...new Set(
          Array.from(clone.querySelectorAll("a[href]"))
            .map((n) => {
              try {
                return new URL(n.getAttribute("href")!, location.href).href;
              } catch {
                return "";
              }
            })
            .filter(
              (u) =>
                /^https?:/.test(u) && new URL(u).origin !== location.origin,
            ),
        ),
      ].sort();
      return {
        text,
        links,
        title: document.title,
        description:
          document
            .querySelector('meta[name="description"]')
            ?.getAttribute("content") || "",
      };
    }, selectors);
    const height = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    if (height > 18000)
      throw new Error("Page exceeds the 18,000px screenshot limit");
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    if (width > 4096 || width * height > 32000000)
      throw new Error("Page exceeds screenshot width or pixel limit");
    const screenshot = await page.screenshot({
      fullPage: true,
      timeout: 10000,
      animations: "disabled",
    });
    return {
      ...result,
      html,
      screenshot,
      finalUrl: page.url(),
      status: main.status,
      headers: Object.fromEntries(
        Object.entries(main.headers).filter(([k]) =>
          [
            "content-type",
            "content-length",
            "content-encoding",
            "etag",
            "last-modified",
            "date",
            "cache-control",
            "location",
            "server",
            "vary",
          ].includes(k),
        ),
      ),
      observedAt: new Date().toISOString(),
      warnings: warnings.slice(0, 50),
      ignoredSelectors: selectors,
    };
  } finally {
    controller.abort();
    clearTimeout(deadline);
    await context.close().catch(() => {});
    await browser.close();
  }
}
