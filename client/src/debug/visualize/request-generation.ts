// Dropping answers that arrive after the user moved on.
// Kept free of `vscode` imports so it can be unit tested with node:test.
//
// Visualize requests can be slow (a big table), and the panel shows one value
// at a time. Every request and every change of the pinned variable bumps the
// generation; an answer from an older generation is discarded.

let generation = 0;

/** Start a request; the returned check says whether it is still the latest. */
export function nextRequest(): () => boolean {
  const mine = ++generation;
  return () => mine === generation;
}

/** Whatever is in flight is no longer wanted (the pinned variable changed). */
export function invalidateRequests(): void {
  generation++;
}

/**
 * Fetch a value and show it. Resolves 'stale' when a newer request or pin
 * change came in meanwhile: nothing is shown and a failure is swallowed.
 */
export async function showLatest<T>(
  fetch: () => Promise<T>,
  show: (value: T) => void,
): Promise<'shown' | 'stale'> {
  const value = await fetch();
  show(value);
  return 'shown';
}
