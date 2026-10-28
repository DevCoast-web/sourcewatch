import type { EcosystemNode, EcosystemEdge } from "../src/ecosystem.js";
export type Point = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
};
function clusterCenter(i: number) {
  return {
    x: Math.cos(i * 2.399963) * Math.sqrt(i) * 240,
    y: Math.sin(i * 2.399963) * Math.sqrt(i) * 240,
  };
}
export function initialPoints(
  nodes: EcosystemNode[],
  previous: Record<string, Point> = {},
): Point[] {
  const clusters = [...new Set(nodes.map((n) => n.cluster))],
    clusterIndex = new Map(clusters.map((c, i) => [c, i]));
  return nodes.map((n, i) =>
    previous[n.ref]
      ? { ...previous[n.ref], vx: 0, vy: 0 }
      : {
          x:
            clusterCenter(clusterIndex.get(n.cluster)!).x +
            Math.cos(i * 2.399) * Math.sqrt(i % 100) * 9,
          y:
            clusterCenter(clusterIndex.get(n.cluster)!).y +
            Math.sin(i * 2.399) * Math.sqrt(i % 100) * 9,
          vx: 0,
          vy: 0,
        },
  );
}
export function forceStep(
  points: Point[],
  links: [number, number][],
  centers: { x: number; y: number }[],
) {
  const grid = new Map<string, number[]>();
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      key = Math.floor(p.x / 50) + "," + Math.floor(p.y / 50);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(i);
  }
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.fixed) continue;
    const cx = Math.floor(p.x / 50),
      cy = Math.floor(p.y / 50);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const neighbors = grid.get(cx + dx + "," + (cy + dy));
        if (!neighbors) continue;
        for (let k = 0; k < Math.min(32, neighbors.length); k++) {
          const j = neighbors[k];
          if (i === j) continue;
          const q = points[j],
            x = p.x - q.x || 0.1,
            y = p.y - q.y || 0.1,
            d2 = x * x + y * y + 5,
            f = Math.min(1.2, 45 / d2);
          p.vx += x * f * 0.08;
          p.vy += y * f * 0.08;
        }
      }
    p.vx += (centers[i].x - p.x) * 0.001;
    p.vy += (centers[i].y - p.y) * 0.001;
  }
  for (const [a, b] of links) {
    const p = points[a],
      q = points[b],
      x = q.x - p.x,
      y = q.y - p.y,
      d = Math.hypot(x, y) || 1,
      f = ((d - 55) * 0.006) / d;
    if (!p.fixed) {
      p.vx += x * f;
      p.vy += y * f;
    }
    if (!q.fixed) {
      q.vx -= x * f;
      q.vy -= y * f;
    }
  }
  for (const p of points)
    if (!p.fixed) {
      p.vx = Math.max(-5, Math.min(5, p.vx * 0.75));
      p.vy = Math.max(-5, Math.min(5, p.vy * 0.75));
      p.x += p.vx;
      p.y += p.vy;
    }
}
export function prepareForce(
  nodes: EcosystemNode[],
  edges: EcosystemEdge[],
  previous: Record<string, Point> = {},
) {
  const points = initialPoints(nodes, previous),
    index = new Map(nodes.map((n, i) => [n.ref, i])),
    clusters = [...new Set(nodes.map((n) => n.cluster))],
    lookup = new Map(clusters.map((c, i) => [c, clusterCenter(i)]));
  return {
    points,
    links: edges
      .filter((e) => index.has(e.from) && index.has(e.to))
      .map((e) => [index.get(e.from)!, index.get(e.to)!] as [number, number]),
    centers: nodes.map((n) => lookup.get(n.cluster)!),
  };
}
