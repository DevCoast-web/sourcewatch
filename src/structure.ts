import { parse } from "parse5";
import { diffLines } from "diff";

export interface StructureComparison {
  changed: boolean;
  parts: Array<{ value: string; added?: boolean; removed?: boolean }>;
  added: number;
  removed: number;
  truncated: boolean;
}

interface HtmlNode {
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
}

const excluded = new Set(["script", "style", "noscript", "template"]);
const attributes = ["role", "aria-label", "id", "type"];

/** Parse inert HTML: no browser, JavaScript execution, or network requests. */
function outline(html: string): { value: string; truncated: boolean } {
  const document = parse(html) as unknown as HtmlNode;
  const stack: Array<{ node: HtmlNode; depth: number }> = [
    { node: document, depth: 0 },
  ];
  const lines: string[] = [];
  let truncated = false;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (node.tagName && excluded.has(node.tagName)) continue;
    if (node.tagName) {
      if (depth > 30) {
        truncated = true;
        continue;
      }
      if (lines.length >= 5000) {
        truncated = true;
        break;
      }
      const values = new Map((node.attrs || []).map((a) => [a.name, a.value]));
      const labels = attributes
        .filter((name) => values.has(name))
        .map((name) => {
          const value = values
            .get(name)!
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120);
          return ` ${name}=${JSON.stringify(value)}`;
        })
        .join("");
      lines.push(`${"  ".repeat(depth)}${node.tagName}${labels}\n`);
    }
    const children = node.childNodes || [];
    for (let index = children.length - 1; index >= 0; index--) {
      if (!children[index].tagName && !children[index].childNodes) continue;
      stack.push({
        node: children[index],
        depth: depth + (node.tagName ? 1 : 0),
      });
    }
  }
  return { value: lines.join(""), truncated };
}

/** Compares bounded element outlines. Text and presentation attributes are ignored. */
export function compareStructure(
  beforeHtml: string,
  afterHtml: string,
): StructureComparison {
  const before = outline(beforeHtml);
  const after = outline(afterHtml);
  const parts = diffLines(before.value, after.value, {
    timeout: 1000,
    maxEditLength: 10000,
  });
  if (!parts)
    throw new Error("HTML structure comparison exceeds complexity limit");
  const added = parts
    .filter((part) => part.added)
    .reduce((n, part) => n + (part.count || 0), 0);
  const removed = parts
    .filter((part) => part.removed)
    .reduce((n, part) => n + (part.count || 0), 0);
  return {
    changed: added + removed > 0,
    parts,
    added,
    removed,
    truncated: before.truncated || after.truncated,
  };
}
