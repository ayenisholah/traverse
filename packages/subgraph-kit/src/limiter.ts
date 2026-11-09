export class LimitReached extends Error {}

export interface Limiter {
  /** `owner` names who the work is for, such as one incoming request. */
  run: <T>(task: () => Promise<T>, owner?: unknown) => Promise<T>;
}

interface Waiter {
  resolve: () => void;
  reject: (error: LimitReached) => void;
}

/**
 * A slot passes straight to the next waiter, so the count stays right. The queue has a bound,
 * because an unbounded one turns a burst of requests into a burst of memory and upstream calls.
 *
 * Owners take turns, and a full queue gives up the newest work of whoever holds the most. One
 * request's batch can fill the queue on its own, but it can't keep everyone else out.
 */
export const createLimiter = (concurrency: number, queueLimit: number): Limiter => {
  let active = 0;
  let size = 0;
  // In turn order: whoever was served last goes to the back.
  const queues = new Map<unknown, Waiter[]>();

  const largest = (): Waiter[] | undefined => {
    let most: Waiter[] | undefined;
    for (const queue of queues.values()) {
      if (queue.length > (most?.length ?? 0)) most = queue;
    }
    return most;
  };

  const makeRoom = (owner: unknown): void => {
    const own = queues.get(owner)?.length ?? 0;
    const most = largest();
    // Only when it leaves things more even, otherwise two owners would trade work back and forth.
    if (!most || most.length <= own + 1) throw new LimitReached();
    most.pop()?.reject(new LimitReached());
    size -= 1;
  };

  const acquire = async (owner: unknown): Promise<void> => {
    if (active < concurrency) {
      active += 1;
      return;
    }
    if (size >= queueLimit) makeRoom(owner);
    const queue = queues.get(owner) ?? [];
    queues.set(owner, queue);
    size += 1;
    await new Promise<void>((resolve, reject) => queue.push({ resolve, reject }));
  };

  // Queues are never left empty, so the first one is always next in turn.
  const release = (): void => {
    const turn = queues.entries().next();
    if (turn.done) {
      active -= 1;
      return;
    }
    const [owner, queue] = turn.value;
    queues.delete(owner);
    const next = queue.shift();
    if (queue.length > 0) queues.set(owner, queue);
    size -= 1;
    next?.resolve();
  };

  return {
    run: async (task, owner) => {
      await acquire(owner);
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
};
