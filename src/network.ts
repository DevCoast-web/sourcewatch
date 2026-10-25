import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";
export function publicAddress(address: string): boolean {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress())
      ip = (ip as ipaddr.IPv6).toIPv4Address();
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export function parsePublicUrl(input: string): URL {
  const u = new URL(input);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    !["", "80", "443"].includes(u.port)
  )
    throw new Error(
      "Only HTTP(S) URLs on standard ports without credentials are allowed",
    );
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (!host.includes(".") && !host.includes(":"))
  )
    throw new Error("Internal hostnames are blocked");
  if (ipaddr.isValid(host) && !publicAddress(host))
    throw new Error("Private or reserved address blocked");
  return u;
}
export async function resolvePublic(
  u: URL,
  lookup = dns.lookup,
): Promise<string> {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const answers = await lookup(host, { all: true, verbatim: true });
  if (!answers.length || answers.some((a) => !publicAddress(a.address)))
    throw new Error("DNS resolved to a private or reserved address");
  return answers[0].address;
}
export type NetworkBudget = { remaining: number; signal?: AbortSignal };
export type FetchResult = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};
export async function safeFetch(
  input: string,
  method = "GET",
  headers: Record<string, string> = {},
  body?: Buffer,
  budget?: NetworkBudget,
): Promise<FetchResult> {
  const u = parsePublicUrl(input);
  const address = await resolvePublic(u);
  // Pin the validated address for the actual socket; no second DNS lookup or proxy environment use.
  return new Promise((resolve, reject) => {
    const clean: Record<string, string> = {
      "user-agent": "SOURCEWATCH/1.0 (local research capture)",
      "accept-encoding": "identity",
    };
    for (const key of ["accept", "accept-language", "content-type"])
      if (headers[key]) clean[key] = headers[key];
    const request = (u.protocol === "https:" ? https : http).request(
      u,
      {
        method,
        headers: clean,
        signal: budget?.signal,
        lookup: ((_host: any, _opts: any, cb: any) =>
          _opts.all
            ? cb(null, [{ address, family: address.includes(":") ? 6 : 4 }])
            : cb(null, address, address.includes(":") ? 6 : 4)) as any,
      },
      (response) => {
        const encoding = String(
          response.headers["content-encoding"] || "identity",
        ).toLowerCase();
        if (encoding !== "identity") {
          response.destroy();
          reject(
            new Error(
              "Compressed responses are blocked to prevent decompression bombs",
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (budget) budget.remaining -= chunk.length;
          if (budget && budget.remaining < 0) {
            response.destroy(
              new Error("32 MiB capture response budget exceeded"),
            );
            return;
          }
          if (size > 8 * 1024 * 1024) {
            response.destroy(new Error("Response exceeds 8 MiB"));
          } else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const out: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers))
            if (
              value !== undefined &&
              !["set-cookie", "connection", "transfer-encoding"].includes(key)
            )
              out[key] = Array.isArray(value) ? value.join(", ") : value;
          resolve({
            status: response.statusCode || 0,
            headers: out,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    const deadline = setTimeout(
      () => request.destroy(new Error("Request timeout")),
      10000,
    );
    request.on("close", () => clearTimeout(deadline));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}
