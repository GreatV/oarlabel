export async function mapLimited<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
  shouldContinue: () => boolean = () => true,
): Promise<Array<R | undefined>> {
  const results = new Array<R | undefined>(items.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (shouldContinue()) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index);
      }
    }),
  );
  return results;
}
