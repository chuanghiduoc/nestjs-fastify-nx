// Races a promise against a timeout. Always clearTimeout in finally — a dangling timer keeps the
// event loop (and closure) alive and blocks a clean shutdown. Note the underlying promise is NOT
// cancelled on timeout (JS can't); only the wait is bounded.
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'Operation'): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
