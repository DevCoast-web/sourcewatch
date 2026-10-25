import { createServer } from "node:http";
import type { Socket } from "node:net";
// Chromium's fallback transport is owned by this capture and denies every request.
// Permitted HTTP requests are fulfilled only through the separately validated Node transport.
export async function createBarrier() {
  const sockets = new Set<Socket>();
  const server = createServer((_req, res) => {
    res.writeHead(403);
    res.end("Network denied");
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.setTimeout(2000, () => socket.destroy());
  });
  server.on("connect", (_req, socket) =>
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
