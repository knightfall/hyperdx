import { renderHook } from '@testing-library/react';

import {
  subscribeToViewport,
  useTimelineViewportEffects,
} from '@/components/TimelineChart/useTimelineViewportEffects';

it('unsubscribes the original listener after other listeners are added', () => {
  const listeners = new Set<() => void>();
  const first = jest.fn();
  const second = jest.fn();
  const unsubscribeFirst = subscribeToViewport(listeners, first);
  const unsubscribeSecond = subscribeToViewport(listeners, second);
  unsubscribeFirst();
  listeners.forEach(listener => listener());
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
  unsubscribeSecond();
  expect(listeners.size).toBe(0);
});

it('preserves native listeners across renders and removes listeners and frames on unmount', () => {
  const element = document.createElement('div');
  const elementRef = { current: element };
  const notify = jest.fn();
  const wheel = jest.fn();
  const notifyFrame = { current: 101 as number | null };
  const wheelState = { current: { rafId: 102 as number | null } };
  const cancel = jest.spyOn(window, 'cancelAnimationFrame');
  const { rerender, unmount } = renderHook(() =>
    useTimelineViewportEffects(
      elementRef,
      notify,
      notifyFrame,
      wheel,
      wheelState,
    ),
  );
  rerender();
  element.dispatchEvent(new Event('scroll'));
  element.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true }));
  expect(notify).toHaveBeenCalledTimes(1);
  expect(wheel).toHaveBeenCalledTimes(1);
  unmount();
  expect(cancel).toHaveBeenCalledWith(101);
  expect(cancel).toHaveBeenCalledWith(102);
  expect(notifyFrame.current).toBeNull();
  expect(wheelState.current.rafId).toBeNull();
  element.dispatchEvent(new Event('scroll'));
  element.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true }));
  expect(notify).toHaveBeenCalledTimes(1);
  expect(wheel).toHaveBeenCalledTimes(1);
  cancel.mockRestore();
});
