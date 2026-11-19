import { once } from "node:events";
import { createServer } from "node:net";

/** Speaks just enough Redis for one MULTI, INCR, EXPIRE and EXEC, answering EXEC with `exec`. */
export const fakeRedis = async (exec: string) => {
  const hello =
    "%3\r\n$6\r\nserver\r\n$5\r\nredis\r\n$7\r\nversion\r\n$5\r\n7.4.0\r\n$5\r\nproto\r\n:3\r\n";
  const reply = (command: string) => {
    const name = /\$\d+\r\n([a-z]+)/i.exec(command)?.[1]?.toLowerCase();
    if (name === "hello") return hello;
    if (name === "info") return "$9\r\nloading:0\r\n";
    if (name === "incr" || name === "expire") return "+QUEUED\r\n";
    if (name === "exec") return exec;
    return "+OK\r\n";
  };
  const server = createServer((socket) => {
    socket.on("data", (data) => {
      socket.write(
        data
          .toString()
          .split(/(?=\*\d+\r\n\$)/)
          .map(reply)
          .join(""),
      );
    });
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  return { url: `redis://127.0.0.1:${String(port)}`, server };
};

/** The strings in one RESP command, such as `["INCR", "key"]`. */
const argumentsOf = (command: string): string[] =>
  [...command.matchAll(/\$\d+\r\n([^\r]*)\r\n/g)].map(([, value]) => value as string);

/**
 * A Redis that really counts: MULTI, INCR, EXPIRE and EXEC over a map in memory, enough for the
 * assistant's limits. For local runs and tests that have no Docker; `apps/web/test/redis` proves
 * the same against the real thing.
 */
export const countingRedis = async () => {
  const counts = new Map<string, number>();
  const server = createServer((socket) => {
    let queued: string[] = [];
    socket.on("data", (data) => {
      const replies = data
        .toString()
        .split(/(?=\*\d+\r\n\$)/)
        .map((command) => {
          const [name = "", key = ""] = argumentsOf(command);
          switch (name.toLowerCase()) {
            case "hello":
              return "%3\r\n$6\r\nserver\r\n$5\r\nredis\r\n$7\r\nversion\r\n$5\r\n7.4.0\r\n$5\r\nproto\r\n:3\r\n";
            case "info":
              return "$9\r\nloading:0\r\n";
            case "incr":
              counts.set(key, (counts.get(key) ?? 0) + 1);
              queued.push(`:${String(counts.get(key))}\r\n`);
              return "+QUEUED\r\n";
            case "expire":
              queued.push(":1\r\n");
              return "+QUEUED\r\n";
            case "exec": {
              const reply = `*${String(queued.length)}\r\n${queued.join("")}`;
              queued = [];
              return reply;
            }
            default:
              return "+OK\r\n";
          }
        });
      socket.write(replies.join(""));
    });
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  return { url: `redis://127.0.0.1:${String(port)}`, stop: () => server.close() };
};
