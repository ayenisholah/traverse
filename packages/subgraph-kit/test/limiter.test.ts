import { describe, expect, it } from "vitest";
import { createLimiter, LimitReached } from "../src/limiter.ts";

const gate = () => {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};

describe("createLimiter", () => {
  it("[FR-SG-6] runs no more than its limit at once, then the queue in order", async () => {
    const limiter = createLimiter(2, 10);
    const gates = [gate(), gate(), gate()];
    const started: number[] = [];
    let running = 0;
    let most = 0;

    const tasks = gates.map(({ opened }, index) =>
      limiter.run(async () => {
        started.push(index);
        running += 1;
        most = Math.max(most, running);
        await opened;
        running -= 1;
        return index;
      }),
    );
    await Promise.resolve();
    expect(started).toEqual([0, 1]);

    for (const { open } of gates) open();

    expect(await Promise.all(tasks)).toEqual([0, 1, 2]);
    expect(started).toEqual([0, 1, 2]);
    expect(most).toBe(2);
  });

  it("[FR-SG-6] refuses work once the queue is full, rather than queue without end", async () => {
    const limiter = createLimiter(1, 1);
    const { open, opened } = gate();
    const first = limiter.run(() => opened);
    const queued = limiter.run(() => Promise.resolve("queued"));

    await expect(limiter.run(() => Promise.resolve("refused"))).rejects.toBeInstanceOf(
      LimitReached,
    );

    open();
    await first;
    expect(await queued).toBe("queued");
  });

  it("[FR-SG-6] still holds the limit after handing a slot to a waiting task", async () => {
    const limiter = createLimiter(1, 5);
    const [first, second] = [gate(), gate()];
    const started: string[] = [];
    const run = (name: string, opened: Promise<void>) =>
      limiter.run(async () => {
        started.push(name);
        await opened;
      });

    const a = run("a", first.opened);
    const b = run("b", second.opened);
    first.open();
    await a;
    await Promise.resolve();
    const c = run("c", Promise.resolve());
    await Promise.resolve();

    expect(started).toEqual(["a", "b"]);
    second.open();
    await Promise.all([b, c]);
    expect(started).toEqual(["a", "b", "c"]);
  });

  it("[FR-SG-6] frees its slot when a task fails", async () => {
    const limiter = createLimiter(1, 0);

    await expect(limiter.run(() => Promise.reject(new Error("x")))).rejects.toThrow("x");

    expect(await limiter.run(() => Promise.resolve("next"))).toBe("next");
  });
});
