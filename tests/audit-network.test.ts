import test, { mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { safeFetch } from "../src/network.js";
afterEach(() => mock.restoreAll());
function transport(
  config: {
    chunks?: Buffer[];
    headers?: Record<string, string | string[]>;
    hang?: boolean;
  } = {},
) {
  mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  let calls = 0;
  let options: any;
  let response: Readable | undefined;
  let written: Buffer | undefined;
  let entered!: () => void;
  const ready = new Promise<void>((r) => (entered = r));
  const request = new EventEmitter() as EventEmitter & {
    end: () => void;
    write: (b: Buffer) => void;
    destroy: (e: Error) => void;
  };
  request.write = (b) => {
    written = b;
  };
  request.destroy = (e) => {
    request.emit("error", e);
    request.emit("close");
  };
  const handler = (_url: URL, opts: any, callback: (r: any) => void) => {
    calls++;
    options = opts;
    entered();
    request.end = () => {
      if (config.hang) return;
      queueMicrotask(() => {
        response = Readable.from(config.chunks || [Buffer.from("receipt")]);
        Object.assign(response, {
          headers: config.headers || { "content-type": "text/html" },
          statusCode: 200,
        });
        response.on("close", () => request.emit("close"));
        callback(response);
      });
    };
    return request;
  };
  mock.method(http, "request", handler as never);
  mock.method(https, "request", handler as never);
  return {
    ready,
    request,
    get calls() {
      return calls;
    },
    get options() {
      return options;
    },
    get response() {
      return response;
    },
    get written() {
      return written;
    },
  };
}
test("validated DNS address is pinned in both Node lookup callback forms and request credentials are excluded", async () => {
  const t = transport({
    headers: {
      "content-type": "text/html",
      "set-cookie": ["secret=value"],
      connection: "close",
    },
  });
  const controller = new AbortController();
  const result = await safeFetch(
    "https://example.com/",
    "GET",
    { cookie: "secret", authorization: "Bearer secret", accept: "text/html" },
    undefined,
    { remaining: 100, signal: controller.signal },
  );
  assert.equal(t.calls, 1);
  assert.equal(t.options.signal, controller.signal);
  assert.equal(t.options.headers.cookie, undefined);
  assert.equal(t.options.headers.authorization, undefined);
  assert.equal(t.options.headers["accept-encoding"], "identity");
  assert.equal(t.options.headers.accept, "text/html");
  assert.equal(result.headers["set-cookie"], undefined);
  assert.equal(result.headers.connection, undefined);
  assert.equal(result.body.toString(), "receipt");
  t.options.lookup(
    "example.com",
    { all: true },
    (error: Error | null, addresses: unknown) => {
      assert.equal(error, null);
      assert.deepEqual(addresses, [{ address: "8.8.8.8", family: 4 }]);
    },
  );
  t.options.lookup(
    "example.com",
    {},
    (error: Error | null, address: string, family: number) => {
      assert.equal(error, null);
      assert.equal(address, "8.8.8.8");
      assert.equal(family, 4);
    },
  );
});
test("mixed and private DNS answers are rejected before opening transport", async () => {
  const t = transport();
  for (const answers of [
    [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ],
    [{ address: "169.254.169.254", family: 4 }],
    [],
  ]) {
    mock.method(dns, "lookup", async () => answers);
    await assert.rejects(
      safeFetch("https://example.com/"),
      /private or reserved/,
    );
  }
  assert.equal(t.calls, 0);
});
test("response stream cannot exceed eight MiB", async () => {
  const t = transport({
    chunks: [Buffer.alloc(8 * 1024 * 1024), Buffer.from("x")],
  });
  await assert.rejects(safeFetch("http://example.com/"), /exceeds 8 MiB/);
  assert(t.response?.destroyed);
});
test("response chunks consume a shared capture budget across requests", async () => {
  transport({ chunks: [Buffer.from("123456")] });
  const budget = { remaining: 10 };
  await safeFetch(
    "http://example.com/",
    undefined,
    undefined,
    undefined,
    budget,
  );
  assert.equal(budget.remaining, 4);
  await assert.rejects(
    safeFetch("http://example.com/", undefined, undefined, undefined, budget),
    /capture response budget exceeded/,
  );
  assert.equal(budget.remaining, -2);
});
test("compressed responses are rejected without decompression", async () => {
  for (const encoding of ["gzip", "br", "deflate"]) {
    const t = transport({ headers: { "content-encoding": encoding } });
    await assert.rejects(
      safeFetch("https://example.com/"),
      /Compressed responses are blocked/,
    );
    assert(t.response?.destroyed);
  }
});
test("request deadline destroys stalled transport without a real ten-second wait", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const transportMock = transport({ hang: true });
  const pending = safeFetch("http://example.com/");
  const rejected = assert.rejects(pending, /Request timeout/);
  await transportMock.ready;
  t.mock.timers.tick(10000);
  await rejected;
  t.mock.timers.reset();
});
