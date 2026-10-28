import { prepareForce, forceStep } from "./ecosystem-force.js";
let state: ReturnType<typeof prepareForce> | undefined,
  timer: ReturnType<typeof setTimeout> | undefined,
  ticks = 0;
function run() {
  if (!state) return;
  for (let i = 0; i < 4; i++)
    forceStep(state.points, state.links, state.centers);
  ticks += 4;
  postMessage({
    points: state.points.map((p) => ({ x: p.x, y: p.y, fixed: p.fixed })),
    ticks,
  });
  if (ticks < 180) timer = setTimeout(run, 16);
}
onmessage = (event) => {
  if (timer) clearTimeout(timer);
  if (event.data.type === "pin" && state) {
    const p = state.points[event.data.index];
    if (p) {
      p.x = event.data.x;
      p.y = event.data.y;
      p.fixed = event.data.fixed;
    }
    ticks = 0;
    run();
    return;
  }
  state = prepareForce(event.data.nodes, event.data.edges, event.data.previous);
  ticks = 0;
  run();
};
