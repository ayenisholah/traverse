import { once } from "node:events";
import { createServer, type Server } from "node:net";

// ioredis 6 opens with HELLO 3, CLIENT SETINFO and INFO, and needs one reply to each before it's
// ready. HELLO's reply is a protocol 3 map, as Redis 7 sends.
const HELLO =
  "%3\r\n$6\r\nserver\r\n$5\r\nredis\r\n$7\r\nversion\r\n$5\r\n7.2.0\r\n$5\r\nproto\r\n:3\r\n";

// One reply per command, as Redis does.
const reply = (command: string): string => {
  const name = /\$\d+\r\n([a-z]+)/i.exec(command)?.[1]?.toLowerCase();
  if (name === "hello") return HELLO;
  if (name === "info") return "$9\r\nloading:0\r\n";
  return name === "get" || name === "set" ? "" : "+OK\r\n";
};

/** Answers everything but GET and SET, which it never answers: a Redis that hangs. */
export const hangingRedis = async (): Promise<{
  url: string;
  closed: Promise<unknown>;
  server: Server;
}> => {
  let markClosed: (value: unknown) => void = () => undefined;
  const closed = new Promise((resolve) => {
    markClosed = resolve;
  });
  const server = createServer((socket) => {
    socket.on("close", markClosed);
    socket.on("data", (data) => {
      const commands = data.toString().split(/(?=\*\d+\r\n\$)/);
      socket.write(commands.map(reply).join(""));
    });
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  return { url: `redis://127.0.0.1:${port}`, closed, server };
};
