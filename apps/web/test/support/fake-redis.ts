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
