import { createBarrier } from "./barrier.js";
import { chromium } from "playwright";
import { safeFetch, parsePublicUrl, type FetchResult } from "./network.js";
export type ScreenshotInfo = {
  mode: "tiled" | "none";
  width: number;
  height: number;
  complete: boolean;
  reason?: string;
  tiles: Array<{ file: string; y: number; width: number; height: number }>;
};
export type Captured = {
  html: string;
  text: string;
  screenshot: Buffer;
  screenshotInfo?: ScreenshotInfo;
  screenshotTiles?: Record<string, Buffer>;
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
  maxScreenshotHeight?: number;
  screenshotMode?: "single" | "tiled";
  preserveTextOnScreenshotFailure?: boolean;
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
  const barrier = await createBarrier();
  const browser = await chromium
    .launch({
      headless: true,
      timeout: 10000,
      args: [
        "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--disable-background-networking",
      ],
      proxy: { server: barrier.url, bypass: "<-loopback>" },
    })
    .catch(async (e) => {
      await barrier.close();
      throw e;
    });
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= browser.close().catch(() => {}));
  const dispose = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        close(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 2000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      await barrier.close();
    }
  };
  const context = await browser
    .newContext({
      viewport: { width: 1365, height: 900 },
      serviceWorkers: "block",
      acceptDownloads: false,
    })
    .catch(async (e) => {
      await dispose();
      throw e;
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
  let rejectDeadline: (e: Error) => void = () => {};
  const expired = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const deadline = setTimeout(() => {
    controller.abort();
    void close();
    rejectDeadline(new Error("Capture deadline exceeded; browser closed"));
  }, options.totalTimeoutMs ?? 45000);
  const work = async () => {
    // Playwright intercepts only the first request in an HTTP redirect chain.
    // Follow redirects through the DNS-pinned transport, never through Chromium's
    // deny-all fallback proxy. Resolve the main URL before navigation so relative
    // links and the recorded final URL retain the real destination origin.
    const fetchRedirects = async (
      input: string,
      method: string,
      headers: Record<string, string>,
    ) => {
      let target = input;
      const visited = new Set<string>();
      for (let hop = 0; hop <= 10; hop++) {
        if (visited.has(target)) throw new Error("Website redirect loop detected");
        visited.add(target);
        if (++count > 150) throw new Error("150-request limit reached");
        if (options.fixtureUrl) {
          if (!target.startsWith(options.fixtureUrl))
            throw new Error("Fixture origin blocked");
        } else parsePublicUrl(target);
        if (controller.signal.aborted) throw new Error("Capture closed");
        const result = await fetcher(target, method, headers, undefined, budget);
        bytes += result.body.length;
        if (bytes > 32 * 1024 * 1024)
          throw new Error("32 MiB total response limit reached");
        if (![301, 302, 303, 307, 308].includes(result.status))
          return { url: target, result };
        if (!result.headers.location)
          throw new Error("Website redirect has no destination");
        if (hop === 10) throw new Error("Website exceeds 10 redirects");
        target = new URL(result.headers.location, target).href;
      }
      throw new Error("Website exceeds 10 redirects");
    };
    let initialResponse: Awaited<ReturnType<typeof fetchRedirects>>;
    const navigationStarted = Date.now();
    const navigationLimit = options.navigationTimeoutMs ?? 25000;
    let navigationTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      initialResponse = await Promise.race([
        fetchRedirects(url, "GET", {}),
        new Promise<never>((_resolve, reject) => {
          navigationTimer = setTimeout(() => {
            controller.abort();
            reject(new Error(`Timeout ${navigationLimit}ms exceeded while loading the website`));
          }, navigationLimit);
        }),
      ]);
    } catch (e) {
      throw new Error(`Navigation failed: ${(e as Error).message}`, { cause: e });
    } finally {
      if (navigationTimer) clearTimeout(navigationTimer);
    }
    let initialDocument = true;
    let observedMainURL = initialResponse.url;
    const withoutFragment = (value: string) => {
      const address = new URL(value);
      address.hash = "";
      return address.href;
    };
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.route("**/*", async (route) => {
      const req = route.request();
      try {
        if (!["GET", "HEAD"].includes(req.method()))
          throw new Error("Non-read request blocked");
        if (["media", "font"].includes(req.resourceType()))
          return await route.abort();
        if (options.fixtureUrl && !req.url().startsWith(options.fixtureUrl))
          throw new Error("Fixture origin blocked");
        await acquire();
        let response: Awaited<ReturnType<typeof fetchRedirects>>;
        try {
          if (initialDocument && req.isNavigationRequest() && req.url() === withoutFragment(initialResponse.url)) {
            initialDocument = false;
            response = initialResponse;
          } else response = await fetchRedirects(req.url(), req.method(), req.headers());
        } finally {
          release();
        }
        const { result } = response;
        if (
          req.isNavigationRequest() &&
          req.frame() === context.pages()[0]?.mainFrame()
        )
        {
          main = result;
          observedMainURL = response.url;
        }
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
      await page.goto(initialResponse.url, {
        waitUntil: "domcontentloaded",
        timeout: Math.max(1, navigationLimit - (Date.now() - navigationStarted)),
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
    if (!/^https?:/.test(page.url()))
      throw new Error("Final document must use HTTP(S)");
    if (withoutFragment(page.url()) !== withoutFragment(observedMainURL))
      throw new Error("The page changed its address during capture; retry using its final URL");
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
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    let screenshot = Buffer.alloc(0) as Buffer;
    let screenshotInfo: ScreenshotInfo | undefined;
    const screenshotTiles: Record<string, Buffer> = {};
    try {
      if (width > 4096)
        throw new Error("Page exceeds 4096px screenshot width limit");
      if (options.screenshotMode === "tiled") {
        if (height > 524288)
          throw new Error("Page exceeds 524288px tiled screenshot limit");
        screenshotInfo = {
          mode: "tiled",
          width,
          height,
          complete: false,
          tiles: [],
        };
        const tileStarted = Date.now();
        let screenshotBytes = 0;
        for (let y = 0; y < height; y += 8192) {
          const remaining = 25000 - (Date.now() - tileStarted);
          if (remaining < 100)
            throw new Error("Tiled screenshot time budget reached");
          const tileHeight = Math.min(8192, height - y);
          const file =
            "screenshot-" +
            String(screenshotInfo.tiles.length + 1).padStart(4, "0") +
            ".png";
          const tile = await page.screenshot({
            fullPage: true,
            clip: { x: 0, y, width, height: tileHeight },
            timeout: Math.min(5000, remaining),
            animations: "disabled",
          });
          screenshotBytes += tile.length;
          if (screenshotBytes > 64 * 1024 * 1024)
            throw new Error("64 MiB screenshot byte budget reached");
          screenshotTiles[file] = tile;
          screenshotInfo.tiles.push({ file, y, width, height: tileHeight });
        }
        screenshotInfo.complete = true;
      } else {
        if (height > (options.maxScreenshotHeight ?? 100000))
          throw new Error(
            "Page exceeds the " +
              (options.maxScreenshotHeight ?? 100000).toLocaleString("en-US") +
              "px screenshot height limit. Adjust the maximum height in Application settings or choose tiled screenshots.",
          );
        if (width * height > 160000000)
          throw new Error("Page exceeds screenshot width or pixel limit");
        screenshot = await page.screenshot({
          fullPage: true,
          timeout: 25000,
          animations: "disabled",
        });
      }
    } catch (error) {
      if (options.preserveTextOnScreenshotFailure === false) throw error;
      const reason = (error as Error).message.split("\n")[0];
      screenshotInfo ??= {
        mode: "none",
        width,
        height,
        complete: false,
        tiles: [],
      };
      screenshotInfo.reason = reason;
      warnings.push(
        "Visual capture incomplete: " +
          reason +
          ". HTML and readable text were preserved.",
      );
    }
    return {
      ...result,
      html,
      screenshot,
      ...(screenshotInfo ? { screenshotInfo, screenshotTiles } : {}),
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
  };
  try {
    return await Promise.race([work(), expired]);
  } finally {
    controller.abort();
    clearTimeout(deadline);
    await dispose();
  }
}
