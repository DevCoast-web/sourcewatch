import { diffLines, diffWordsWithSpace } from "diff";
export function compare(
  before: { text: string; links: string[]; title?: string },
  after: { text: string; links: string[]; title?: string },
) {
  const parts = diffLines(before.text, after.text, {
    maxEditLength: 10000,
    timeout: 1500,
  });
  if (!parts) throw new Error("Comparison exceeds complexity limit");
  const added = parts
      .filter((p) => p.added)
      .reduce((n, p) => n + (p.count || 0), 0),
    removed = parts
      .filter((p) => p.removed)
      .reduce((n, p) => n + (p.count || 0), 0);
  const words = diffWordsWithSpace(before.text, after.text, {
    maxEditLength: 10000,
    timeout: 1500,
  });
  return {
    titleChanged: before.title !== after.title,
    beforeTitle: before.title,
    afterTitle: after.title,
    parts,
    words: words || parts,
    added,
    removed,
    changed:
      before.title !== after.title ||
      added + removed > 0 ||
      JSON.stringify(before.links) !== JSON.stringify(after.links),
    linksAdded: after.links.filter((l) => !before.links.includes(l)),
    linksRemoved: before.links.filter((l) => !after.links.includes(l)),
  };
}
