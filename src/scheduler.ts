import type { Source } from "./storage.js";
export function nextDue(
  sources: Source[],
  now = Date.now(),
): Source | undefined {
  return sources.find(
    (s) =>
      !s.paused &&
      !s.archived &&
      s.intervalMinutes > 0 &&
      now - Date.parse(s.lastAttempt || s.createdAt) >=
        s.intervalMinutes * 60000,
  );
}
