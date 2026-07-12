/**
 * Run async work over `items` with a concurrency ceiling — keeps "select every
 * channel" from firing 20 LLM calls at once (provider rate-limits + memory),
 * and preserves input order in the result. Shared by the generate route and
 * the live evals (previously two copies).
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
