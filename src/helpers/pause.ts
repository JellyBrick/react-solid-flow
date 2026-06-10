interface PauseOpts {
  signal?: AbortSignal
}
/**
 * Promisified abortable timeout.
 * @param timeout timeout duration in ms
 * @param [opts.signal] optional AbortController
 * @returns Promise, resolved when timeout is passed, rejected if aborted (in the same way as fetch() is)
 */
export const pause = (timeout: number, { signal }: PauseOpts = {}) => {
  return new Promise<void>((res, rej) => {
    if (signal?.aborted) {
      rej(signal.reason);
      return;
    }
    const to = setTimeout(() => {
      if (typeof signal?.removeEventListener === "function") {
        signal.removeEventListener("abort", abortHandler);
      }
      res();
    }, timeout);

    const abortHandler = () => {
      if (to) {
        clearTimeout(to);
      }
      rej(signal!.reason);
    };

    if (typeof signal?.addEventListener === "function") {
      signal.addEventListener("abort", abortHandler, { once: true });
    }
  });
};