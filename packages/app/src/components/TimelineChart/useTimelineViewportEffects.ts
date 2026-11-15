import {
  type MutableRefObject,
  type RefObject,
  useEffect,
  useLayoutEffect,
} from 'react';

// These long-lived effects and subscription cleanups must not share the chart's
// render scope, which includes the complete timeline rows.
export function subscribeToViewport(
  subscribers: Set<() => void>,
  cb: () => void,
) {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function useTimelineHeight(
  elementRef: RefObject<HTMLDivElement | null>,
  heightRef: MutableRefObject<number>,
  axisRef: RefObject<{ recompute: () => void } | null>,
  cursorRef: RefObject<{ recompute: () => void } | null>,
) {
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (element == null) return;
    heightRef.current = element.getBoundingClientRect().height;
    axisRef.current?.recompute();
    cursorRef.current?.recompute();
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry == null) return;
      heightRef.current = entry.contentRect.height;
      axisRef.current?.recompute();
      cursorRef.current?.recompute();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [elementRef, heightRef, axisRef, cursorRef]);
}

export function useTimelineViewportEffects(
  elementRef: RefObject<HTMLDivElement | null>,
  notifyViewport: () => void,
  notifyRafRef: MutableRefObject<number | null>,
  onWheel: (event: WheelEvent) => void,
  wheelStateRef: RefObject<{ rafId: number | null }>,
) {
  useEffect(() => {
    const element = elementRef.current;
    if (element == null) return;
    element.addEventListener('scroll', notifyViewport, { passive: true });
    return () => element.removeEventListener('scroll', notifyViewport);
  }, [elementRef, notifyViewport]);

  useEffect(
    () => () => {
      if (notifyRafRef.current != null) {
        cancelAnimationFrame(notifyRafRef.current);
        notifyRafRef.current = null;
      }
    },
    [notifyRafRef],
  );

  useEffect(() => {
    const element = elementRef.current;
    if (element == null) return;
    // Suppress page scroll when zooming with cmd/ctrl + wheel.
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [elementRef, onWheel]);

  useEffect(() => {
    const state = wheelStateRef.current;
    return () => {
      if (state.rafId != null) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }
    };
  }, [wheelStateRef]);
}
