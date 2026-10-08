/**
 * Runs a synchronous operation immediately and represents its result or thrown
 * error as a promise.
 */
export function promiseFromSync<T>(operation: () => T): Promise<T> {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(error);
  }
}
