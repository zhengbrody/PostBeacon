/** Client async boundaries, not persisted jobs or a replacement for server RLS. */
export class StaleRequestError extends Error {
  constructor() {
    super("The account or project changed. The old response was discarded.");
  }
}

export function createAsyncScope() {
  let version = 0;
  const controllers = new Set<AbortController>();
  const invalidate = () => {
    version += 1;
    for (const controller of controllers) controller.abort();
    controllers.clear();
  };
  const capture = (matches: () => boolean = () => true) => {
    const captured = version;
    const controller = new AbortController();
    controllers.add(controller);
    const current = () => captured === version && !controller.signal.aborted && matches();
    return {
      signal: controller.signal,
      current,
      check: () => {
        if (!current()) throw new StaleRequestError();
      },
      release: () => controllers.delete(controller),
    };
  };
  return {
    invalidate,
    capture,
    begin: (matches?: () => boolean) => {
      invalidate();
      return capture(matches);
    },
  };
}

/** Ordered writes: a slow older save can never overtake a newer save in this client. */
export function createSerialQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    enqueue<T>(work: () => Promise<T>, key = "default"): Promise<T> {
      const result = (tails.get(key) ?? Promise.resolve()).then(work);
      const settled = result.then(
        () => undefined,
        () => undefined
      );
      tails.set(key, settled);
      void settled.then(() => {
        if (tails.get(key) === settled) tails.delete(key);
      });
      return result;
    },
  };
}
