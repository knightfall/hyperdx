import { type RefObject, useLayoutEffect, useMemo, useRef } from 'react';

// The returned callback must close over only the ref. Creating it in the hook's
// scope also retains that render's original callback and its captured data.
function createCallback<T extends (...args: any[]) => any>(
  callbackRef: RefObject<T>,
): T {
  // Preserve the caller's generic/overloaded signature, as useStableCallback did.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return ((...args: Parameters<T>) => callbackRef.current(...args)) as T;
}

export const useStableCallback = <T extends (...args: any[]) => any>(
  callback: T,
) => {
  const callbackRef = useRef<T>(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });
  // The factory only captures the ref; it reads current when the wrapper is called.
  // eslint-disable-next-line react-hooks/refs
  return useMemo(() => createCallback(callbackRef), [callbackRef]);
};
