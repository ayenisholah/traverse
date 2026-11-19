import { once } from "node:events";
import { createServer, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for Amazon Bedrock's Converse endpoint (A-15), for tests and local runs only. The real
 * SDK talks to it, over HTTP/2 as its runtime client always does, so the wire format is the one
 * Bedrock uses. Each request is answered by the script, which can return a tool answer, plain
 * text, or an error Bedrock would send, including wrong and hostile answers, so the app's
 * validation is what's tested.
 */
export type Reply =
  | { kind: "tool"; input: unknown; name?: string }
  | { kind: "text"; text: string }
  | { kind: "error"; status: number; type: string }
  | { kind: "hang" };

interface ConverseCall {
  modelId: string;
  /** The system prompt and the user's prompt, as sent. */
  system: string;
  prompt: string;
  /** The tool the model was forced to use, and its input schema. */
  toolChoice: unknown;
  toolSchema: unknown;
  maxTokens: unknown;
  /** The request's signature, which names the key ID that signed it. */
  authorization: string;
}

export interface ModelStub {
  url: string;
  calls: ConverseCall[];
  /** Replaces the script: each call gets the next reply, or the last one once they run out. */
  reply: (...replies: Reply[]) => void;
  /** Answers each call from what it holds, for a server another process drives. */
  respond: (choose: (call: ConverseCall) => Reply) => void;
  stop: () => Promise<void>;
}

interface ConverseBody {
  system?: { text?: string }[];
  messages?: { content?: { text?: string }[] }[];
  inferenceConfig?: { maxTokens?: unknown };
  toolConfig?: {
    toolChoice?: unknown;
    tools?: { toolSpec?: { inputSchema?: { json?: unknown } } }[];
  };
}

const answer = (reply: Exclude<Reply, { kind: "error" | "hang" }>) => ({
  output: {
    message: {
      role: "assistant",
      content:
        reply.kind === "tool"
          ? [
              {
                toolUse: {
                  toolUseId: "tooluse_test",
                  name: reply.name ?? "answer",
                  input: reply.input,
                },
              },
            ]
          : [{ text: reply.text }],
    },
  },
  stopReason: reply.kind === "tool" ? "tool_use" : "end_turn",
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  metrics: { latencyMs: 1 },
});

const UNAVAILABLE: Reply = { kind: "error", status: 503, type: "ServiceUnavailableException" };

export const startModelStub = async (port = 0): Promise<ModelStub> => {
  const calls: ConverseCall[] = [];
  let script: Reply[] = [UNAVAILABLE];
  let chooser: ((call: ConverseCall) => Reply) | undefined;
  const server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk: Buffer) => (text += chunk.toString()));
    request.on("end", () => {
      const path = /^\/model\/([^/]+)\/converse$/.exec(request.url ?? "");
      if (request.method !== "POST" || path === null) {
        response.writeHead(404).end();
        return;
      }
      const body = JSON.parse(text) as ConverseBody;
      const call: ConverseCall = {
        modelId: decodeURIComponent(path[1] as string),
        system: (body.system ?? []).map((block) => block.text ?? "").join("\n"),
        prompt: (body.messages?.[0]?.content ?? []).map((block) => block.text ?? "").join("\n"),
        toolChoice: body.toolConfig?.toolChoice,
        toolSchema: body.toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json,
        maxTokens: body.inferenceConfig?.maxTokens,
        authorization: String(request.headers.authorization ?? ""),
      };
      calls.push(call);
      const next = script.length > 1 ? script.shift() : script[0];
      const reply: Reply = chooser?.(call) ?? next ?? UNAVAILABLE;
      if (reply.kind === "hang") return;
      if (reply.kind === "error") {
        response
          .writeHead(reply.status, {
            "content-type": "application/json",
            "x-amzn-errortype": reply.type,
          })
          .end(JSON.stringify({ message: "test error" }));
        return;
      }
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(answer(reply)));
    });
  });
  const sessions = new Set<ServerHttp2Session>();
  server.on("session", (session) => {
    sessions.add(session);
    session.on("close", () => sessions.delete(session));
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    calls,
    reply: (...replies) => {
      chooser = undefined;
      script = replies;
    },
    respond: (choose) => {
      chooser = choose;
    },
    stop: async () => {
      // HTTP/2 sessions stay open between calls, so close waits only for those to end.
      const closed = once(server, "close");
      server.close();
      for (const session of sessions) session.destroy();
      await closed;
    },
  };
};
