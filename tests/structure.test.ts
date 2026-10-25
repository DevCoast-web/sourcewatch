import assert from "node:assert/strict";
import { test } from "node:test";
import { compareStructure } from "../src/structure.ts";

test("structure ignores readable text and dynamic presentation attributes", () => {
  const result = compareStructure(
    '<p class="a" style="color:red">before</p>',
    '<p class="b" style="color:blue">after</p>',
  );
  assert.equal(result.changed, false);
  assert.equal(result.truncated, false);
});

test("structure identifies element replacement and form control insertion", () => {
  const result = compareStructure(
    "<main><p>Hello</p></main>",
    '<main><section>Hello</section><input type="email" aria-label="Email"></main>',
  );
  assert.equal(result.changed, true);
  assert.equal(result.removed, 1);
  assert.equal(result.added, 2);
  assert.match(
    result.parts
      .filter((part) => part.removed)
      .map((part) => part.value)
      .join(""),
    /p\n/,
  );
  assert.match(
    result.parts
      .filter((part) => part.added)
      .map((part) => part.value)
      .join(""),
    /input aria-label="Email" type="email"/,
  );
});

test("structure uses stable selected attributes and bounded single-line values", () => {
  assert.equal(
    compareStructure('<div id="a" role="main">', '<div role="main" id="a">')
      .changed,
    false,
  );
  assert.equal(compareStructure('<div id="a">', '<div id="b">').changed, true);
  const result = compareStructure(
    "",
    `<div aria-label="hello\nworld${"x".repeat(200)}">`,
  );
  const line = result.parts
    .map((part) => part.value)
    .join("")
    .split("\n")
    .find((line) => line.includes("div"))!;
  assert.equal(JSON.parse(line.split("aria-label=")[1]).length, 120);
});

test("structure excludes executable and inert hidden subtrees without running or fetching them", () => {
  const oldFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (() => {
    requests++;
    throw new Error("network access");
  }) as typeof fetch;
  try {
    const result = compareStructure(
      "<main></main>",
      '<main><script>throw new Error("executed")</script><style>p{color:red}</style><noscript><p>fallback</p></noscript><template><form><input></form></template></main><img src="https://example.invalid/track">',
    );
    assert.equal(requests, 0);
    assert.equal(result.added, 1);
    assert.match(
      result.parts
        .filter((part) => part.added)
        .map((part) => part.value)
        .join(""),
      /img/,
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("malformed HTML is parsed deterministically with normal HTML repair", () => {
  const malformed = "<table><tr><td>x</table><p><b>unfinished";
  assert.deepEqual(
    compareStructure(malformed, malformed),
    compareStructure(malformed, malformed),
  );
  assert.equal(compareStructure(malformed, malformed).changed, false);
  assert.equal(compareStructure("<p>one", "<p>two</p>").changed, false);
});

test("structure bounds node count and reports truncation", () => {
  const result = compareStructure(
    "<div></div>".repeat(6000),
    "<div></div>".repeat(6000),
  );
  assert.equal(result.truncated, true);
  assert.equal(result.changed, false);
  assert.equal(
    result.parts
      .map((part) => part.value)
      .join("")
      .split("\n")
      .filter(Boolean).length,
    5000,
  );
});

test("structure bounds depth and still visits later siblings", () => {
  const nested = "<div>".repeat(100) + "</div>".repeat(100);
  const result = compareStructure(nested, nested + "<footer></footer>");
  assert.equal(result.truncated, true);
  assert.equal(result.added, 1);
  assert.match(
    result.parts
      .filter((part) => part.added)
      .map((part) => part.value)
      .join(""),
    /footer/,
  );
});
