import { useCallback, useEffect, useMemo, useRef } from "react";
import { useResourceReducer } from "./useResourceReducer";
import type { Resource } from "../models/Resource";
import type { Initializer } from "../models/Initializer";

export type ResourceReturn<T, TArgs extends readonly unknown[]> = [
  Resource<T>,
  {
    /** Manually set the value.
     *
     * If fetcher was currently pending, it's aborted.
     */
    mutate: (v: Awaited<T>) => void;
    /**
     * Call refetch with supplied args.
     *
     * Fetcher opts added automatically. If fetcher was currently pending, it's aborted.
     */
    refetch: (...args: TArgs) => Promise<T> | T;
    /** Imperatively abort the current fetcher call.
     *
     * If abort is performed with no reason, or with AbortError instance, then
     * the state is still considered pending/refreshing, resource.error is
     * not updated, and onError callback is not called.
     * Any other reason will result in erorred resource state.
     *
     * Resource won't be refetched untill deps change again.
     */
    abort: (reason?: any) => void;
  },
];

export type ResourceOptions<T> = {
  /** Initial value for the resource */
  initialValue?: Initializer<Awaited<T>>;
  /** resolve callback */
  onCompleted?: (data: Awaited<T>) => void;
  /** rejection callback */
  onError?: (error: unknown) => void;
  /** Skip first run (before params change)  */
  skipFirstRun?: boolean;
  /** Skip calls of fetcher (can still be called manually with refresh)
   *
   * Can be useful if you're waiting for some of deps to be in certain state
   * before calling the fetcher or if you want to trigger the fetcher only
   * manually on some event.
   */
  skip?: boolean;
  /** Don't memoize getter, rerun it every time it changes */
  skipFnMemoization?: boolean;
};

export interface FetcherOpts {
  /** is true, if the call to fetcher was triggered manually with refetch function,
   * false otherwise */
  refetching: boolean;
  /** can be used to abort operations in fetcher function, i.e. passed to fetch options */
  signal: AbortSignal;
}

export const useResource = <T, TArgs extends readonly any[]>(
  fetcher:
    | ((...args: [...TArgs, FetcherOpts]) => Promise<T> | T)
    | ((...args: TArgs) => Promise<T> | T),
  deps: [...TArgs] = [] as unknown as [...TArgs],
  {
    initialValue,
    onCompleted,
    onError,
    skipFirstRun = false,
    skip = false,
    skipFnMemoization,
  }: ResourceOptions<T> = {},
): ResourceReturn<T, TArgs> => {
  // it's actually initialized in the effect bellow, so we don't create empty controllers
  // on each render
  const controller = useRef<AbortController | undefined>(undefined);
  const skipFirst = useRef<boolean>(skipFirstRun);

  // Always call the latest callbacks, without retriggering the fetch effect
  // when an unmemoized callback is passed.
  const callbacks = useRef({ onCompleted, onError });
  useEffect(() => {
    callbacks.current = { onCompleted, onError };
  });

  const [resource, dispatch] = useResourceReducer(initialValue, skip || skipFirstRun);

  const mutate = useCallback((val: Awaited<T>) => {
    controller.current?.abort();
    controller.current = new AbortController();
    dispatch({ type: "SYNC-RESULT", payload: val });
  }, [dispatch]);

  const fetcherFn = useCallback(
    (refetching: boolean, ...args: [...TArgs]): T | Promise<T> => {
      const cont = controller.current;

      const handler = async (val: Promise<T>) => {
        dispatch({ type: "PEND" });
        try {
          const result = await val;
          // As fetcher can completely ignore AbortController we're checking
          // for race conditions separately, by checking that AbortController
          // instance hasn't changed between calls.
          if (cont !== controller.current) { return }
          dispatch({ type: "RESOLVE", payload: result });
          callbacks.current.onCompleted?.(result);
        } catch (e) {
          if (isAbortError(e)) { return }
          if (cont !== controller.current) { return }
          dispatch({ type: "REJECT", payload: e });
          callbacks.current.onError?.(e);
        }
      };

      let val: Promise<T> | T;
      try {
        // in theory, this error should never happen, but better be on the safe side
        if (cont == null) {
          throw new Error("resource state error, abort controller is null during the fetch operation");
        }
        val = fetcher(...[...args, {
          signal: cont.signal,
          refetching,
        }] as unknown as TArgs);
        if (isThenable(val)) {
          handler(val);
        } else {
          dispatch({ type: "SYNC-RESULT", payload: val as Awaited<T> });
        }
        return val;
      } catch (e) {
        dispatch({ type: "REJECT", payload: e });
        callbacks.current.onError?.(e);
        if (refetching) {
          throw e;
        }
        return undefined as never;
      }
    },
    skipFnMemoization ? [fetcher] : [],
  );

  const refetch = useCallback((...args: TArgs) => {
    controller.current?.abort();
    controller.current = new AbortController();
    return fetcherFn(true, ...args);
  }, [fetcherFn]);

  const abort = useCallback((reason?: any) => {
    controller.current?.abort(reason);
  }, []);

  useEffect(() => {
    if (!controller.current) {
      controller.current = new AbortController();
    }
    // Abort on unmount even when the last fetch-effect run was skipped
    // (skip / skipFirstRun), so a pending manual refetch can't leak.
    return () => {
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    if (skip) {
      return;
    }
    fetcherFn(false, ...deps);

    return () => {
      controller.current?.abort();
      controller.current = new AbortController();
    };
    // onCompleted and onError are intentionally ommited, as we don't want to
    // retrigger the fetching, if someone forgot to memoize it
  }, [...deps, skip, fetcherFn]);

  const actions = useMemo(
    () => ({ mutate, refetch, abort }),
    [mutate, refetch, abort],
  );

  return [resource, actions];
};

const isAbortError = (e: any): e is { name: "AbortError" } => {
  // We can't really check if it's an instanceof DOMException as it doesn't
  // exist in older node version, and we can't check if it's an instanceof
  // Error, as jsdom implementation of DOMException isn't an instance of it.
  return e != null && e.name === "AbortError";
};

const isThenable = <T,>(v: T | Promise<T>): v is Promise<T> => {
  // instanceof Promise misses cross-realm promises and custom thenables,
  // which await would still unwrap.
  return v != null && typeof (v as any).then === "function";
};