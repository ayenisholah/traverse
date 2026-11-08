export class LimitReached extends Error {}

export interface Limiter {
  run: <T>(task: () => Promise<T>) => Promise<T>;
}

/**
 * A slot passes straight to the next waiter, so the count stays right. The queue has a bound,
 * because an unbounded one turns a burst of requests into a burst of memory and upstream calls.
 */
export const createLimiter = (concurrency: number, queueLimit: number): Limiter => {
  let active = 0;
  const waiting: (() => void)[] = [];

  const acquire = async (): Promise<void> => {
    if (active < concurrency) {
      active += 1;
      return;
    }
    if (waiting.length >= queueLimit) throw new LimitReached();
    await new Promise<void>((resolve) => waiting.push(resolve));
  };

  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };

  return {
    run: async (task) => {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
};
